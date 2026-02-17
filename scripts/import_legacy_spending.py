from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from db.database import close_session, get_session, init_db
from db.models import Account, Category, Subcategory, Tag, Transaction
from services.import_service import ensure_subcategory, ensure_tag


# Trip tag names (always tags, never category/subcategory)
TRIP_TAGS = {"wolf creek", "vancouver", "boston", "portland", "death valley", "houston"}

# Category/subcategory mappings
CATEGORY_SUBCATEGORY_MAP = {
    "grocery": ("Food", "Grocery"),
    "eating out": ("Food", "Eating Out"),
    "drinks": ("Food", "Drinks"),
    "rent": ("Bills", "Rent"),
    "payments": ("Bills", "Payments"),
    "leisure": ("Leisure", "Leisure"),
    "other": ("Other", "Uncategorized"),
    "trips": ("Travel", "Transportation"),  # Default when Trips is alone
}


@dataclass
class ImportStats:
    inserted: int = 0
    skipped_rows: int = 0
    rows_total: int = 0
    skipped_details: List[Tuple[int, str]] = field(default_factory=list)
    overlaps: List[str] = field(default_factory=list)


def _normalize_name(value: str) -> str:
    return " ".join(value.strip().split()).lower()


def _parse_amount(raw_value: str) -> float:
    value = raw_value.strip()
    if not value:
        raise ValueError("amount is empty")

    negative = False
    if value.startswith("(") and value.endswith(")"):
        negative = True
        value = value[1:-1].strip()

    if value.startswith("-"):
        negative = True
        value = value[1:].strip()
    elif value.startswith("+"):
        value = value[1:].strip()

    value = value.replace("$", "").replace(",", "")

    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(f"invalid amount '{raw_value}'") from exc

    if negative:
        amount = -amount

    return float(amount)


def _parse_date(raw_value: str):
    value = raw_value.strip()
    if not value:
        raise ValueError("date is empty")
    return datetime.strptime(value, "%m/%d/%Y").date()


def _split_tags(raw_value: str) -> List[str]:
    if not raw_value:
        return []
    parts = [part.strip() for part in raw_value.split(",")]
    return [part for part in parts if part]


def _resolve_account(
    account_raw: str,
    account_lookup: Dict[str, Account],
    session,
    create_missing_accounts: bool,
) -> Account:
    normalized = _normalize_name(account_raw)
    account = account_lookup.get(normalized)
    if account:
        return account

    if not create_missing_accounts:
        raise ValueError(f"account '{account_raw}' does not exist")

    account = Account(name=account_raw.strip(), type="credit_card")
    session.add(account)
    session.flush()
    account_lookup[normalized] = account
    return account


def _is_trip_tag(tag_name: str) -> bool:
    """Check if a tag is a trip location tag."""
    return _normalize_name(tag_name) in TRIP_TAGS


def _resolve_category_subcategory(
    raw_tags: List[str],
    category_lookup: Dict[str, Category],
    subcategory_lookup: Dict[tuple, Subcategory],
    session,
) -> Tuple[Optional[Category], Optional[Subcategory], List[str], List[str]]:
    """
    Resolve category and subcategory from tags.
    
    Returns:
        (category, subcategory, context_tags, overlaps)
        - category: Category object or None
        - subcategory: Subcategory object or None
        - context_tags: List of tag names to assign (trip tags, etc.)
        - overlaps: List of overlap messages for reporting
    """
    normalized_tags = [_normalize_name(tag) for tag in raw_tags]
    
    # Separate trip tags from other tags
    trip_tags = [tag for tag in raw_tags if _is_trip_tag(tag)]
    non_trip_tags = [tag for tag in normalized_tags if not _is_trip_tag(tag)]
    
    overlaps = []
    category = None
    subcategory = None
    
    # Special case: Trips + Eating Out → Food, Eating Out, tag with trip
    if "trips" in non_trip_tags and "eating out" in non_trip_tags:
        category = category_lookup.get("food")
        if category:
            subcategory = subcategory_lookup.get(("Food", "Eating Out"))
            if not subcategory:
                subcategory = ensure_subcategory(session, "Eating Out", category.id)
                subcategory_lookup[("Food", "Eating Out")] = subcategory
        return category, subcategory, trip_tags, overlaps
    
    # Find category/subcategory from non-trip tags (excluding Leisure)
    non_leisure_tags = [tag for tag in non_trip_tags if tag != "leisure"]
    
    if non_leisure_tags:
        # Try to find category/subcategory mapping
        for tag in non_leisure_tags:
            if tag in CATEGORY_SUBCATEGORY_MAP:
                cat_name, subcat_name = CATEGORY_SUBCATEGORY_MAP[tag]
                cat = category_lookup.get(cat_name.lower())
                if cat:
                    if category and category.id != cat.id:
                        overlaps.append(f"Multiple categories found: {category.name} and {cat_name}")
                    category = cat
                    subcategory = subcategory_lookup.get((cat_name, subcat_name))
                    if not subcategory:
                        subcategory = ensure_subcategory(session, subcat_name, cat.id)
                        subcategory_lookup[(cat_name, subcat_name)] = subcategory
                    break  # Use first match
    
    # If no category found, check for Leisure (lowest priority)
    if not category and "leisure" in non_trip_tags:
        category = category_lookup.get("leisure")
        if category:
            subcategory = subcategory_lookup.get(("Leisure", "Leisure"))
            if not subcategory:
                subcategory = ensure_subcategory(session, "Leisure", category.id)
                subcategory_lookup[("Leisure", "Leisure")] = subcategory
    
    # If still no category and has "trips", use Travel → Transportation
    if not category and "trips" in non_trip_tags:
        category = category_lookup.get("travel")
        if category:
            subcategory = subcategory_lookup.get(("Travel", "Transportation"))
            if not subcategory:
                subcategory = ensure_subcategory(session, "Transportation", category.id)
                subcategory_lookup[("Travel", "Transportation")] = subcategory
    
    # Default to Other → Uncategorized if nothing found
    if not category:
        category = category_lookup.get("other")
        if category:
            subcategory = subcategory_lookup.get(("Other", "Uncategorized"))
            if not subcategory:
                subcategory = ensure_subcategory(session, "Uncategorized", category.id)
                subcategory_lookup[("Other", "Uncategorized")] = subcategory
    
    return category, subcategory, trip_tags, overlaps


def import_legacy_csv(
    csv_path: Path,
    unknown_tags_path: Path,
    skipped_rows_path: Path,
    create_missing_accounts: bool,
) -> Tuple[ImportStats, Set[str]]:
    session = get_session()

    try:
        # Build lookups
        category_lookup = {
            _normalize_name(category.name): category
            for category in session.query(Category).all()
        }
        
        # Build subcategory lookup: (category_name, subcategory_name) -> Subcategory
        subcategory_lookup = {}
        for subcat in session.query(Subcategory).all():
            cat_name = subcat.category.name
            subcategory_lookup[(cat_name, subcat.name)] = subcat
        
        # Build tag lookup (flat tags, no category)
        tag_lookup = {
            _normalize_name(tag.name): tag
            for tag in session.query(Tag).all()
        }
        
        account_lookup = {
            _normalize_name(account.name): account
            for account in session.query(Account).all()
        }

        stats = ImportStats()
        unknown_tags: Set[str] = set()

        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            required = {"Date", "Amount", "Charge", "Tags", "Notes", "Account"}
            if reader.fieldnames is None:
                raise ValueError("CSV has no header")
            missing = required - set(reader.fieldnames)
            if missing:
                missing_text = ", ".join(sorted(missing))
                raise ValueError(f"CSV missing required columns: {missing_text}")

            for row_number, row in enumerate(reader, start=2):
                stats.rows_total += 1
                try:
                    date_value = _parse_date(row["Date"])
                    amount_value = _parse_amount(row["Amount"])
                    merchant = (row.get("Charge") or "").strip()
                    if not merchant:
                        raise ValueError("charge/merchant is empty")

                    notes = (row.get("Notes") or "").strip() or None
                    account = _resolve_account(
                        row.get("Account") or "",
                        account_lookup,
                        session,
                        create_missing_accounts,
                    )

                    raw_tags = _split_tags(row.get("Tags") or "")
                    
                    if not raw_tags:
                        raise ValueError("No tags found - all transactions must have tags")

                    # Resolve category and subcategory from tags
                    category, subcategory, trip_tag_names, overlaps = _resolve_category_subcategory(
                        raw_tags,
                        category_lookup,
                        subcategory_lookup,
                        session,
                    )
                    
                    if overlaps:
                        stats.overlaps.extend([f"Row {row_number}: {overlap}" for overlap in overlaps])
                    
                    if not category or not subcategory:
                        raise ValueError(
                            f"Could not resolve category/subcategory from tags: {', '.join(raw_tags)}"
                        )

                    # Legacy CSV used opposite sign convention: negate all amounts
                    amount_value = -float(amount_value)

                    # Resolve context tags (trip tags)
                    context_tag_objects = []
                    for trip_tag_name in trip_tag_names:
                        normalized_trip = _normalize_name(trip_tag_name)
                        tag_obj = tag_lookup.get(normalized_trip)
                        if not tag_obj:
                            # Create tag if it doesn't exist
                            # Use title case for consistent formatting (e.g., "Wolf Creek" not "wolf creek")
                            tag_display_name = trip_tag_name.strip().title()
                            tag_obj = ensure_tag(session, tag_display_name)
                            tag_lookup[normalized_trip] = tag_obj
                        context_tag_objects.append(tag_obj)

                    # Create transaction with required category and subcategory
                    transaction = Transaction(
                        date=date_value,
                        amount=amount_value,
                        merchant=merchant,
                        account_id=account.id,
                        category_id=category.id,
                        subcategory_id=subcategory.id,
                        notes=notes,
                    )
                    
                    # Assign context tags
                    if context_tag_objects:
                        transaction.tags = context_tag_objects

                    session.add(transaction)
                    stats.inserted += 1

                except Exception as exc:
                    stats.skipped_rows += 1
                    stats.skipped_details.append((row_number, str(exc)))

        session.commit()

        unknown_tags_path.parent.mkdir(parents=True, exist_ok=True)
        with unknown_tags_path.open("w", encoding="utf-8") as handle:
            for tag_name in sorted(unknown_tags, key=lambda x: x.lower()):
                handle.write(f"{tag_name}\n")

        skipped_rows_path.parent.mkdir(parents=True, exist_ok=True)
        with skipped_rows_path.open("w", encoding="utf-8") as handle:
            for row_number, reason in stats.skipped_details:
                handle.write(f"row {row_number}: {reason}\n")
        
        # Write overlaps report
        if stats.overlaps:
            overlaps_path = skipped_rows_path.parent / "overlaps.txt"
            with overlaps_path.open("w", encoding="utf-8") as handle:
                for overlap in stats.overlaps:
                    handle.write(f"{overlap}\n")

        return stats, unknown_tags

    except Exception:
        session.rollback()
        raise
    finally:
        close_session(session)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import legacy Google Sheet CSV into budget database."
    )
    parser.add_argument(
        "--csv",
        default="data/Spending - Spending.csv",
        help="Path to legacy CSV file",
    )
    parser.add_argument(
        "--unknown-tags-out",
        default="data/set.txt",
        help="Path to write unknown tags set",
    )
    parser.add_argument(
        "--skipped-rows-out",
        default="data/skipped_rows.txt",
        help="Path to write skipped CSV row numbers and reasons",
    )
    parser.add_argument(
        "--no-create-accounts",
        action="store_true",
        help="Fail rows if account in CSV does not exist in DB",
    )

    args = parser.parse_args()

    init_db()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    unknown_tags_path = Path(args.unknown_tags_out)
    skipped_rows_path = Path(args.skipped_rows_out)

    stats, unknown_tags = import_legacy_csv(
        csv_path=csv_path,
        unknown_tags_path=unknown_tags_path,
        skipped_rows_path=skipped_rows_path,
        create_missing_accounts=not args.no_create_accounts,
    )

    print(f"Imported {stats.inserted}/{stats.rows_total} rows")
    print(f"Skipped rows: {stats.skipped_rows}")
    if stats.skipped_details:
        skipped_row_numbers = ", ".join(str(row_number) for row_number, _ in stats.skipped_details)
        print(f"Skipped row numbers: {skipped_row_numbers}")
    print(f"Skipped row log written to: {skipped_rows_path}")
    print(f"Unknown tags written to: {unknown_tags_path}")
    print(f"Unknown tag count: {len(unknown_tags)}")
    if stats.overlaps:
        print(f"\n⚠️  Found {len(stats.overlaps)} overlap(s) - see {skipped_rows_path.parent / 'overlaps.txt'}")
        for overlap in stats.overlaps[:5]:  # Show first 5
            print(f"  - {overlap}")
        if len(stats.overlaps) > 5:
            print(f"  ... and {len(stats.overlaps) - 5} more")


if __name__ == "__main__":
    main()
