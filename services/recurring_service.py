"""
Recurring charge detection.

Follows the approach most aggregators (Plaid, Monarch, Copilot) use:

1. Normalize the merchant string (strip store numbers, phone numbers, reference
   codes, card suffixes, processor prefixes, trailing state codes) and group
   outflows by that merchant key, across all accounts.
2. Within a merchant, cluster by amount (relative tolerance) so two different
   subscriptions from one biller stay separate while small price drift is fine.
3. Within a cluster, find the longest chain of charges spaced on a known
   cadence (calendar-aware for monthly and longer), tolerating date jitter and
   an occasional missed period. Reject chains buried in lots of same-merchant
   noise (e.g. a grocery store visited every few days).
4. Predict the next date and flag series that have stopped.

A series is keyed by (merchant key, amount anchor in cents). Saved user state
(confirmed/ignored/category mapping) is matched to detected series by merchant
key plus amount tolerance, so a small price change does not orphan it.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from datetime import date, timedelta
from datetime import date as Date
from typing import Any, cast

from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.models import Account, Category, RecurringSeries, Subcategory, Transaction
from services.zbb_service import recalc_activity_for_months


# Pre-merchant-aware rows were keyed on amount alone under this sentinel.
LEGACY_ANY_MERCHANT = "__any__"
LEGACY_AMOUNT_TOLERANCE_CENTS = 3

# Amounts join a cluster while each step stays within max(20%, $0.50).
AMOUNT_CLUSTER_REL_TOL = 0.20
AMOUNT_CLUSTER_ABS_TOL_CENTS = 50
# Quarterly and longer plans are fixed-price, so their charges must match closely.
FIXED_AMOUNT_REL_TOL = 0.05
# A chain may bridge this many missed periods between consecutive charges.
MAX_SKIPPED_PERIODS = 1


@dataclass(frozen=True)
class _Cadence:
    label: str
    months: int  # calendar-month step; 0 for day-based cadences
    days: int  # nominal period in days
    tol_days: int
    min_occurrences: int
    fixed_amount: bool


_CADENCES: tuple[_Cadence, ...] = (
    _Cadence("weekly", 0, 7, 1, 4, False),
    _Cadence("biweekly", 0, 14, 2, 3, False),
    _Cadence("monthly", 1, 30, 4, 3, False),
    _Cadence("quarterly", 3, 91, 7, 3, True),
    _Cadence("semiannual", 6, 182, 10, 2, True),
    _Cadence("annual", 12, 365, 14, 2, True),
)
_CADENCE_BY_LABEL = {c.label: c for c in _CADENCES}


class RecurringSeriesFingerprint(BaseModel):
    merchant_norm: str
    amount_anchor_cents: int


class RecurringSeriesActionIn(RecurringSeriesFingerprint):
    pass


class RecurringOccurrenceOut(BaseModel):
    transaction_id: int
    date: Date
    amount: float
    merchant: str
    category_id: int | None = None
    category_name: str | None = None
    subcategory_id: int | None = None
    subcategory_name: str | None = None


class RecurringSeriesCardOut(BaseModel):
    merchant_norm: str
    display_name: str | None = None
    amount_anchor_cents: int
    amount_anchor: float
    status: str
    cadence_type: str | None = None
    cadence_days: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    occurrence_count: int = 0
    last_date: Date | None = None
    next_expected_date: Date | None = None
    is_active: bool = False
    occurrences: list[RecurringOccurrenceOut] = []


# --- Merchant normalization -------------------------------------------------

_CARD_SUFFIX_RE = re.compile(r"APPLE PAY ENDING IN.*$", re.IGNORECASE)
_LEADING_PHRASE_RE = re.compile(
    r"^(withdrawal (from|to)|zelle (money sent to|payment to)|payment to|purchase at|pos purchase|debit card purchase)\s+",
    re.IGNORECASE,
)
# Payment processors that prefix the real merchant, e.g. "SQ *CUPPA", "TST* JO'S COFFEE".
_PROCESSOR_PREFIX_RE = re.compile(
    r"^(SQ|TST|PY|PP|PAYPAL|BPS|FSP|EB|SP|DD|GOOGLE|WPY|IC)\s*\*\s*", re.IGNORECASE
)
_REGION_CODES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM "
    "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS ON PE QC SK".split()
)


def _clean_merchant(merchant: str) -> str:
    """Human-readable merchant with per-transaction noise removed."""
    raw = (merchant or "").strip()
    s = _CARD_SUFFIX_RE.sub("", raw)
    s = _LEADING_PHRASE_RE.sub("", s.strip())
    s = _PROCESSOR_PREFIX_RE.sub("", s.strip())
    s = s.replace("*", " ")
    # Tokens with 2+ digits are store numbers, phone numbers, or reference codes.
    tokens = [t for t in s.split() if sum(ch.isdigit() for ch in t) < 2]
    if len(tokens) > 1 and tokens[-1].upper() in _REGION_CODES:
        tokens.pop()
    cleaned = " ".join(tokens).strip()
    return cleaned or raw


def _merchant_key(merchant: str) -> str:
    s = _clean_merchant(merchant).lower().replace("'", "").replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


# --- Small helpers ----------------------------------------------------------


def _to_cents(amount: float) -> int:
    # Round to nearest cent (bank exports are typically 2dp already)
    return int(round(float(amount) * 100.0))


def _cents_to_amount(cents: int) -> float:
    return float(cents) / 100.0


def _add_months(d: date, months: int) -> date:
    """Add calendar months, clamping the day for month length (e.g. Jan 31 -> Feb 28/29)."""
    idx = d.month - 1 + months
    year, month = d.year + idx // 12, idx % 12 + 1
    next_first = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    last_day = (next_first - timedelta(days=1)).day
    return date(year, month, min(d.day, last_day))


def _step(d: date, cadence: _Cadence, periods: int = 1) -> date:
    if cadence.months:
        return _add_months(d, cadence.months * periods)
    return d + timedelta(days=cadence.days * periods)


def _amounts_close(a_cents: int, b_cents: int) -> bool:
    a, b = abs(a_cents), abs(b_cents)
    return abs(a - b) <= max(AMOUNT_CLUSTER_REL_TOL * max(a, b), AMOUNT_CLUSTER_ABS_TOL_CENTS)


def _median(values: list[int]) -> int:
    s = sorted(values)
    return int(s[len(s) // 2])


# --- Detection --------------------------------------------------------------


@dataclass(frozen=True)
class _Item:
    date: date
    cents: int
    id: int


@dataclass(frozen=True)
class _DetectedSeries:
    merchant_norm: str
    display_name: str
    amount_anchor_cents: int
    transaction_ids: tuple[int, ...]
    cadence: _Cadence
    last_date: date


def _cluster_by_amount(items: list[_Item]) -> list[list[_Item]]:
    """Single-linkage clustering on |amount| with a relative tolerance."""
    ordered = sorted(items, key=lambda it: abs(it.cents))
    clusters: list[list[_Item]] = []
    for it in ordered:
        if clusters and _amounts_close(clusters[-1][-1].cents, it.cents):
            clusters[-1].append(it)
        else:
            clusters.append([it])
    return clusters


def _best_chain(items: list[_Item], cadence: _Cadence) -> list[_Item]:
    """Longest chain of items (sorted by date) spaced on `cadence`, allowing skipped periods."""
    dates = [it.date for it in items]
    best: list[_Item] = []
    for start_idx in range(len(items)):
        chain = [items[start_idx]]
        last_idx = start_idx
        while True:
            last = items[last_idx]
            nxt_idx: int | None = None
            for periods in range(1, MAX_SKIPPED_PERIODS + 2):
                expected = _step(last.date, cadence, periods)
                lo = bisect.bisect_left(dates, expected - timedelta(days=cadence.tol_days), last_idx + 1)
                hi = bisect.bisect_right(dates, expected + timedelta(days=cadence.tol_days), last_idx + 1)
                if lo < hi:
                    nxt_idx = min(
                        range(lo, hi),
                        key=lambda i: (abs((items[i].date - expected).days), abs(items[i].cents - last.cents)),
                    )
                    break
            if nxt_idx is None:
                break
            chain.append(items[nxt_idx])
            last_idx = nxt_idx
        if len(chain) > len(best):
            best = chain
    return best


def _chain_is_plausible(chain: list[_Item], cluster: list[_Item], cadence: _Cadence) -> bool:
    if len(chain) < cadence.min_occurrences:
        return False
    if cadence.fixed_amount:
        amounts = [abs(it.cents) for it in chain]
        if max(amounts) - min(amounts) > FIXED_AMOUNT_REL_TOL * max(amounts):
            return False
    # Reject chains that are just a sample of frequent visits: within the chain's
    # span, same-merchant/same-amount noise must not outnumber the chain itself.
    chain_ids = {it.id for it in chain}
    start, end = chain[0].date, chain[-1].date
    noise = sum(1 for it in cluster if start <= it.date <= end and it.id not in chain_ids)
    return noise <= len(chain)


def _detect_in_cluster(cluster: list[_Item]) -> list[tuple[list[_Item], _Cadence]]:
    remaining = sorted(cluster, key=lambda it: (it.date, it.id))
    found: list[tuple[list[_Item], _Cadence]] = []
    while len(remaining) >= 2:
        best: tuple[list[_Item], _Cadence] | None = None
        for cadence in _CADENCES:
            chain = _best_chain(remaining, cadence)
            if not _chain_is_plausible(chain, remaining, cadence):
                continue
            # Prefer the chain covering the most charges; on ties, the longer period.
            if best is None or (len(chain), cadence.days) > (len(best[0]), best[1].days):
                best = (chain, cadence)
        if best is None:
            break
        found.append(best)
        used = {it.id for it in best[0]}
        remaining = [it for it in remaining if it.id not in used]
    return found


def _detect_series(candidates: list[Transaction]) -> list[_DetectedSeries]:
    by_merchant: dict[str, list[Transaction]] = {}
    for t in candidates:
        key = _merchant_key(str(getattr(cast(Any, t), "merchant", "") or ""))
        if key:
            by_merchant.setdefault(key, []).append(t)

    detected: list[_DetectedSeries] = []
    for key, txns in by_merchant.items():
        if len(txns) < 2:
            continue
        txn_by_id = {int(cast(Any, t).id): t for t in txns}
        items = [_Item(date=t.date, cents=_to_cents(float(cast(Any, t).amount)), id=int(cast(Any, t).id)) for t in txns]
        for cluster in _cluster_by_amount(items):
            for chain, cadence in _detect_in_cluster(cluster):
                latest = txn_by_id[chain[-1].id]
                detected.append(
                    _DetectedSeries(
                        merchant_norm=key,
                        display_name=_clean_merchant(str(cast(Any, latest).merchant)),
                        # Anchor on the current price rather than the lifetime median.
                        amount_anchor_cents=_median([it.cents for it in chain[-3:]]),
                        transaction_ids=tuple(sorted(it.id for it in chain)),
                        cadence=cadence,
                        last_date=chain[-1].date,
                    )
                )
    return detected


def _next_expected(last: date, cadence: _Cadence, today: date) -> tuple[date, bool]:
    """Next predicted charge date and whether the series still looks active."""
    stale_after = _step(last, cadence, MAX_SKIPPED_PERIODS + 1) + timedelta(days=cadence.tol_days)
    return _step(last, cadence), today <= stale_after


# --- Saved-state matching ---------------------------------------------------


def _is_legacy(row: RecurringSeries) -> bool:
    return str(cast(Any, row).merchant_norm) == LEGACY_ANY_MERCHANT


def _find_saved_row(
    rows: list[RecurringSeries], merchant_norm: str, amount_anchor_cents: int
) -> RecurringSeries | None:
    """Saved row for this merchant whose anchor is within amount tolerance (closest wins)."""
    matches = [
        r
        for r in rows
        if not _is_legacy(r)
        and _merchant_key(str(cast(Any, r).merchant_norm)) == merchant_norm
        and _amounts_close(int(cast(Any, r).amount_anchor_cents), amount_anchor_cents)
    ]
    if not matches:
        return None
    return min(matches, key=lambda r: abs(int(cast(Any, r).amount_anchor_cents) - amount_anchor_cents))


def _find_legacy_row(rows: list[RecurringSeries], amount_anchor_cents: int) -> RecurringSeries | None:
    """Carry over decisions made under the old amount-only detector until the user acts again."""
    matches = [
        r
        for r in rows
        if _is_legacy(r)
        and abs(int(cast(Any, r).amount_anchor_cents) - amount_anchor_cents) <= LEGACY_AMOUNT_TOLERANCE_CENTS
    ]
    if not matches:
        return None
    return min(matches, key=lambda r: abs(int(cast(Any, r).amount_anchor_cents) - amount_anchor_cents))


def _detected_series(session: Session) -> tuple[list[_DetectedSeries], dict[int, Transaction], list[RecurringSeries]]:
    saved = session.query(RecurringSeries).order_by(RecurringSeries.id.asc()).all()

    # Negative amount = cash-flow outflow (see docs/AMOUNT_CONVENTION.md), including
    # card charges and bank fees on any account. Join Account without filtering type so
    # checking, savings, cash, credit, investment, and any future types are included.
    candidates = (
        session.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.amount < 0)
        .order_by(Transaction.date.asc(), Transaction.id.asc())
        .all()
    )

    txn_by_id: dict[int, Transaction] = {int(getattr(cast(Any, t), "id")): t for t in candidates}
    return _detect_series(candidates), txn_by_id, saved


def _matching_series(detected: list[_DetectedSeries], merchant_norm: str, amount_anchor_cents: int) -> list[_DetectedSeries]:
    key = _merchant_key(merchant_norm)
    return [
        s for s in detected if s.merchant_norm == key and _amounts_close(s.amount_anchor_cents, amount_anchor_cents)
    ]


# --- Public API -------------------------------------------------------------


def _upsert_saved_row(session: Session, payload: RecurringSeriesActionIn) -> RecurringSeries:
    merchant_norm = _merchant_key(payload.merchant_norm)
    if not merchant_norm or payload.merchant_norm == LEGACY_ANY_MERCHANT:
        raise ValueError("merchant_norm is required")
    amount_anchor_cents = int(payload.amount_anchor_cents)
    rows = session.query(RecurringSeries).all()
    existing = _find_saved_row(rows, merchant_norm, amount_anchor_cents)
    if existing is None:
        existing = RecurringSeries(
            merchant_norm=merchant_norm,
            amount_anchor_cents=amount_anchor_cents,
            status="suggested",
        )
        session.add(existing)
    return existing


def apply_series_action(session: Session, payload: RecurringSeriesActionIn, *, status_value: str) -> None:
    if status_value not in {"suggested", "confirmed", "ignored", "removed"}:
        raise ValueError(f"Invalid status: {status_value}")

    existing = _upsert_saved_row(session, payload)
    existing_any = cast(Any, existing)
    existing_any.status = status_value

    # When confirming, remember the cadence and auto-persist mapping if all occurrences share one pair.
    if status_value == "confirmed":
        detected, _, _ = _detected_series(session)
        matches = _matching_series(detected, payload.merchant_norm, int(payload.amount_anchor_cents))
        if matches:
            existing_any.cadence_type = matches[0].cadence.label
            existing_any.cadence_days = matches[0].cadence.days
        occs = list_series_occurrences(session, payload)
        mapped_pairs = {
            (
                int(getattr(cast(Any, t), "category_id")),
                int(getattr(cast(Any, t), "subcategory_id")),
            )
            for t in occs
            if getattr(cast(Any, t), "category_id", None) is not None
            and getattr(cast(Any, t), "subcategory_id", None) is not None
        }
        if len(mapped_pairs) == 1:
            cid, sid = next(iter(mapped_pairs))
            existing_any.category_id = int(cid)
            existing_any.subcategory_id = int(sid)

    session.commit()


def list_series_occurrences(session: Session, payload: RecurringSeriesActionIn) -> list[Transaction]:
    detected, txn_by_id, _ = _detected_series(session)
    ids: set[int] = set()
    for series in _matching_series(detected, payload.merchant_norm, int(payload.amount_anchor_cents)):
        ids.update(series.transaction_ids)
    txns = [txn_by_id[tid] for tid in ids if tid in txn_by_id]
    txns.sort(key=lambda t: (t.date, t.id), reverse=True)
    return txns


def series_occurrences_by_fingerprint(
    session: Session,
    *,
    merchant_norm: str,
    amount_anchor_cents: int,
) -> list[Transaction]:
    return list_series_occurrences(
        session,
        RecurringSeriesActionIn(
            merchant_norm=merchant_norm,
            amount_anchor_cents=int(amount_anchor_cents),
        ),
    )


def bulk_update_series_category(
    session: Session,
    payload: RecurringSeriesActionIn,
    *,
    category_id: int,
    subcategory_id: int,
) -> int:
    category = session.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise ValueError(f"Category with id {category_id} does not exist")
    subcategory = session.query(Subcategory).filter(Subcategory.id == subcategory_id).first()
    if not subcategory:
        raise ValueError(f"Subcategory with id {subcategory_id} does not exist")
    if int(getattr(cast(Any, subcategory), "category_id")) != int(category_id):
        raise ValueError("Subcategory does not belong to category")

    txns = list_series_occurrences(session, payload)
    if not txns:
        raise ValueError("No recurring occurrences found for this series")

    updated = 0
    for txn in txns:
        txn_any = cast(Any, txn)
        txn_any.category_id = int(category_id)
        txn_any.subcategory_id = int(subcategory_id)
        updated += 1
    # Budget activity is cached per month by category; refresh the affected months.
    session.flush()
    recalc_activity_for_months(session, {(t.date.year, t.date.month) for t in txns})

    existing_any = cast(Any, _upsert_saved_row(session, payload))
    existing_any.category_id = int(category_id)
    existing_any.subcategory_id = int(subcategory_id)

    session.commit()
    return updated


def list_recurring_suggestions(session: Session, *, today: date | None = None) -> list[RecurringSeriesCardOut]:
    today = today or date.today()
    detected, txn_by_id, saved = _detected_series(session)

    cards_by_fp: dict[tuple[str, int], RecurringSeriesCardOut] = {}
    used_saved_ids: set[int] = set()

    # Most recent series first so they claim saved rows before stale look-alikes.
    for s in sorted(detected, key=lambda s: s.last_date, reverse=True):
        saved_row = _find_saved_row(saved, s.merchant_norm, s.amount_anchor_cents)
        state_row = cast(Any, saved_row or _find_legacy_row(saved, s.amount_anchor_cents))
        status_value = str(state_row.status) if state_row is not None else "suggested"
        if status_value in {"ignored", "removed"}:
            continue
        next_date, is_active = _next_expected(s.last_date, s.cadence, today)
        # Only suggest series that are still charging; confirmed ones stay visible regardless.
        if status_value != "confirmed" and not is_active:
            continue
        if saved_row is not None:
            used_saved_ids.add(int(cast(Any, saved_row).id))

        # Key on the saved anchor so user actions keep hitting the same row as prices drift.
        anchor = int(cast(Any, saved_row).amount_anchor_cents) if saved_row is not None else s.amount_anchor_cents
        fp = (s.merchant_norm, anchor)

        occs: list[RecurringOccurrenceOut] = []
        for tid in s.transaction_ids:
            t_any = cast(Any, txn_by_id.get(int(tid)))
            if t_any is None:
                continue
            occs.append(
                RecurringOccurrenceOut(
                    transaction_id=int(t_any.id),
                    date=t_any.date,
                    amount=float(t_any.amount),
                    merchant=str(t_any.merchant),
                )
            )

        card = cards_by_fp.get(fp)
        if card is not None:
            # Two detected chains for one saved series (e.g. same subscription on two cards).
            card.occurrences.extend(occs)
            card.occurrences.sort(key=lambda o: (o.date, o.transaction_id), reverse=True)
            card.occurrence_count = len(card.occurrences)
            card.is_active = card.is_active or is_active
            continue

        occs.sort(key=lambda o: (o.date, o.transaction_id), reverse=True)
        cards_by_fp[fp] = RecurringSeriesCardOut(
            merchant_norm=s.merchant_norm,
            display_name=s.display_name,
            amount_anchor_cents=anchor,
            amount_anchor=_cents_to_amount(s.amount_anchor_cents),
            status=status_value,
            cadence_type=s.cadence.label,
            cadence_days=s.cadence.days,
            category_id=getattr(state_row, "category_id", None) if state_row is not None else None,
            subcategory_id=getattr(state_row, "subcategory_id", None) if state_row is not None else None,
            occurrence_count=len(occs),
            last_date=s.last_date,
            next_expected_date=next_date,
            is_active=is_active,
            occurrences=occs,
        )

    # Confirmed series stay visible even when detection no longer finds them.
    for r in saved:
        r_any = cast(Any, r)
        if _is_legacy(r) or int(r_any.id) in used_saved_ids or str(r_any.status) != "confirmed":
            continue
        fp = (_merchant_key(str(r_any.merchant_norm)), int(r_any.amount_anchor_cents))
        if fp in cards_by_fp:
            continue
        cadence = _CADENCE_BY_LABEL.get(str(r_any.cadence_type or ""))
        cards_by_fp[fp] = RecurringSeriesCardOut(
            merchant_norm=fp[0],
            display_name=None,
            amount_anchor_cents=fp[1],
            amount_anchor=_cents_to_amount(fp[1]),
            status="confirmed",
            cadence_type=cadence.label if cadence else None,
            cadence_days=cadence.days if cadence else None,
            category_id=r_any.category_id,
            subcategory_id=r_any.subcategory_id,
            is_active=False,
            occurrences=[],
        )

    return sorted(
        cards_by_fp.values(),
        key=lambda c: (c.status != "confirmed", not c.is_active, (c.display_name or c.merchant_norm).lower()),
    )
