"""
Temporary script: clear transactions and import from data/edited.xlsx.

Excel columns: id, Date, Merchant, Amount, Category, Subcategory, Tags, Notes, Acct, Delete
- Only rows with Delete == False (or FALSE) are imported.
- Category, Subcategory, Tags, Acct are names; accounts/categories/subcategories/tags
  are created if missing.

Run from project root with venv active:
  source .venv/bin/activate   # or: .venv\\Scripts\\activate on Windows
  pip install openpyxl
  python scripts/import_edited_xlsx.py

Or: .venv/bin/python scripts/import_edited_xlsx.py
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from sqlalchemy import delete

from db.database import close_session, get_session, init_db
from db.models import Transaction, transaction_tags
from services.import_service import ensure_account, ensure_category, ensure_subcategory, ensure_tag


XLSX_PATH = PROJECT_ROOT / "data" / "edited.xlsx"


def _is_false(val) -> bool:
    """True if value represents FALSE (keep row for import)."""
    if val is None:
        return True
    if isinstance(val, bool):
        return not val
    s = str(val).strip().upper()
    return s in ("FALSE", "F", "0", "NO", "")


def clear_transactions(session):
    """Remove all transactions and their tag links."""
    session.execute(delete(transaction_tags))
    session.execute(delete(Transaction.__table__))
    session.commit()
    print("Cleared all transactions and transaction_tags.")


def main():
    if not XLSX_PATH.exists():
        print(f"Error: {XLSX_PATH} not found.")
        sys.exit(1)

    init_db()
    session = get_session()

    try:
        clear_transactions(session)

        df = pd.read_excel(XLSX_PATH, engine="openpyxl")
        # Normalize column names (strip whitespace)
        df.columns = [str(c).strip() for c in df.columns]

        required = {"Date", "Merchant", "Amount", "Category", "Subcategory", "Tags", "Notes", "Acct", "Delete"}
        missing = required - set(df.columns)
        if missing:
            print(f"Error: Excel missing columns: {missing}")
            sys.exit(1)

        # Keep rows where Delete is FALSE
        to_import = df[df["Delete"].apply(_is_false)].copy()
        print(f"Importing {len(to_import)} rows (skipping {len(df) - len(to_import)} with Delete=TRUE).")

        for idx, row in to_import.iterrows():
            try:
                # Date
                date_val = row["Date"]
                if hasattr(date_val, "date"):
                    date_val = date_val.date()
                else:
                    date_val = pd.to_datetime(date_val).date()

                amount = float(row["Amount"])
                merchant = str(row["Merchant"]).strip() or "(no merchant)"
                notes = str(row["Notes"]).strip() if pd.notna(row["Notes"]) else None
                if notes == "nan" or not notes:
                    notes = None

                # Resolve account (create if missing)
                acct_name = str(row["Acct"]).strip() or "Default"
                account = ensure_account(session, acct_name)
                # Resolve category / subcategory (create if missing)
                cat_name = str(row["Category"]).strip() or "Other"
                subcat_name = str(row["Subcategory"]).strip() or "Uncategorized"
                category = ensure_category(session, cat_name)
                subcategory = ensure_subcategory(session, subcat_name, category.id)

                # Tags: comma-separated names
                tags_cell = row["Tags"]
                if pd.isna(tags_cell):
                    tag_objs = []
                else:
                    tag_names = [t.strip() for t in str(tags_cell).split(",") if t.strip()]
                    tag_objs = [ensure_tag(session, name) for name in tag_names]

                txn = Transaction(
                    date=date_val,
                    amount=amount,
                    merchant=merchant,
                    account_id=account.id,
                    category_id=category.id,
                    subcategory_id=subcategory.id,
                    notes=notes,
                )
                session.add(txn)
                session.flush()
                if tag_objs:
                    txn.tags = tag_objs
                session.commit()
            except Exception as e:
                session.rollback()
                print(f"Row (1-based {int(idx) + 2}): {e}")
                raise

        print(f"Done. Imported {len(to_import)} transactions.")
    finally:
        close_session(session)


if __name__ == "__main__":
    main()
