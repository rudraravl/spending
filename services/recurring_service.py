from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, cast

from sqlalchemy.orm import Session

from backend.app.schemas import RecurringSeriesActionIn, RecurringSeriesCardOut, RecurringOccurrenceOut
from db.models import Account, Category, RecurringSeries, Subcategory, Transaction


AMOUNT_TOLERANCE_CENTS_DEFAULT = 3
DAY_OF_MONTH_TOLERANCE_DEFAULT = 2
ANY_MERCHANT_FINGERPRINT = "__any__"


def _merchant_norm(merchant: str) -> str:
    return (merchant or "").strip().lower()


def _build_display_name(occ_merchants: list[str]) -> str | None:
    cleaned = [m.strip() for m in occ_merchants if (m or "").strip()]
    if not cleaned:
        return None
    counts: dict[str, int] = {}
    for m in cleaned:
        counts[m] = counts.get(m, 0) + 1
    # Most common merchant; annotate if multiple distinct merchants are present.
    best = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))[0][0]
    if len(counts) > 1:
        return f"{best} (varies)"
    return best


def _to_cents(amount: float) -> int:
    # Round to nearest cent (bank exports are typically 2dp already)
    return int(round(float(amount) * 100.0))


def _cents_to_amount(cents: int) -> float:
    return float(cents) / 100.0


def _add_month_clamped(d: date) -> date:
    """Add one calendar month, clamping day for month length (e.g. Jan 31 -> Feb 28/29)."""
    year = d.year
    month = d.month + 1
    if month == 13:
        month = 1
        year += 1

    # Find last day of target month by moving to the first of the next month and subtracting one day.
    if month == 12:
        next_first = date(year + 1, 1, 1)
    else:
        next_first = date(year, month + 1, 1)
    last_day = (next_first - __import__("datetime").timedelta(days=1)).day
    return date(year, month, min(d.day, last_day))


@dataclass(frozen=True)
class _DetectedSeries:
    merchant_norm: str
    amount_anchor_cents: int
    transaction_ids: tuple[int, ...]
    cadence_type: str | None = None
    cadence_days: int | None = None


def _cluster_amounts_cents(values: list[int], *, tol_cents: int) -> list[list[int]]:
    """Cluster sorted cent values into buckets where each bucket span stays within tol."""
    if not values:
        return []
    values_sorted = sorted(values)
    buckets: list[list[int]] = []
    current: list[int] = [values_sorted[0]]
    lo = values_sorted[0]
    hi = values_sorted[0]
    for v in values_sorted[1:]:
        new_lo = lo
        new_hi = max(hi, v)
        if new_hi - new_lo <= tol_cents:
            current.append(v)
            hi = new_hi
            continue
        buckets.append(current)
        current = [v]
        lo = v
        hi = v
    buckets.append(current)
    return buckets


def _anchor_cents_from_txns(txns: list[Transaction]) -> int:
    cents: list[int] = []
    for t in txns:
        t_any = cast(Any, t)
        cents.append(_to_cents(float(getattr(t_any, "amount"))))
    cents.sort()
    return int(cents[len(cents) // 2])


def _detect_fixed_interval_series(
    txns: Iterable[Transaction],
    *,
    tol_cents: int,
    cadence_type: str,
    cadence_days: int,
    tol_days: int,
    min_occurrences: int,
) -> list[_DetectedSeries]:
    """
    Detect recurring charges based on an approximate fixed day interval.

    For weekly/biweekly/etc. we accept a small date tolerance window and require
    multiple consecutive occurrences to keep false positives low.
    """
    detected: list[_DetectedSeries] = []
    txns_list = list(txns)
    cents_values: list[int] = []
    for t in txns_list:
        t_any = cast(Any, t)
        cents_values.append(_to_cents(float(getattr(t_any, "amount"))))
    buckets = _cluster_amounts_cents(cents_values, tol_cents=tol_cents)
    if not buckets:
        return []

    cents_to_txns: dict[int, list[Transaction]] = {}
    for t in txns_list:
        t_any = cast(Any, t)
        cents_to_txns.setdefault(_to_cents(float(getattr(t_any, "amount"))), []).append(t)

    for bucket in buckets:
        bucket_txns: list[Transaction] = []
        for cents in set(bucket):
            bucket_txns.extend(cents_to_txns.get(cents, []))
        if len(bucket_txns) < min_occurrences:
            continue
        bucket_txns.sort(key=lambda t: (t.date, t.id))

        used: set[int] = set()
        for start_idx, start in enumerate(bucket_txns):
            start_any = cast(Any, start)
            start_id = int(getattr(start_any, "id"))
            if start_id in used:
                continue

            chain: list[Transaction] = [start]
            last = start
            for nxt in bucket_txns[start_idx + 1 :]:
                last_any = cast(Any, last)
                nxt_any = cast(Any, nxt)
                dd = (nxt.date - last.date).days
                if dd < cadence_days - tol_days:
                    continue
                if dd > cadence_days + tol_days:
                    break
                if (
                    abs(
                        _to_cents(float(getattr(nxt_any, "amount")))
                        - _to_cents(float(getattr(last_any, "amount")))
                    )
                    > tol_cents
                ):
                    continue
                chain.append(nxt)
                last = nxt

            if len(chain) >= min_occurrences:
                for t in chain:
                    t_any = cast(Any, t)
                    used.add(int(getattr(t_any, "id")))
                detected.append(
                    _DetectedSeries(
                        merchant_norm=ANY_MERCHANT_FINGERPRINT,
                        amount_anchor_cents=_anchor_cents_from_txns(chain),
                        transaction_ids=tuple(sorted([int(getattr(cast(Any, t), "id")) for t in chain])),
                        cadence_type=cadence_type,
                        cadence_days=int(cadence_days),
                    )
                )

    return detected


def _detect_monthly_series(
    txns: Iterable[Transaction],
    *,
    tol_cents: int,
    tol_dom_days: int,
) -> list[_DetectedSeries]:
    """
    Detect monthly recurring charges:
    - amount within tol_cents
    - date within ±tol_dom_days of the "same day next month" (with clamping)
    """
    detected: list[_DetectedSeries] = []
    txns_list = list(txns)
    cents_values: list[int] = []
    for t in txns_list:
        t_any = cast(Any, t)
        cents_values.append(_to_cents(float(getattr(t_any, "amount"))))
    buckets = _cluster_amounts_cents(cents_values, tol_cents=tol_cents)
    if not buckets:
        return []

    cents_to_txns: dict[int, list[Transaction]] = {}
    for t in txns_list:
        t_any = cast(Any, t)
        cents_to_txns.setdefault(_to_cents(float(getattr(t_any, "amount"))), []).append(t)

    for bucket in buckets:
        bucket_txns: list[Transaction] = []
        for cents in set(bucket):
            bucket_txns.extend(cents_to_txns.get(cents, []))
        # Without merchant matching, require more evidence to reduce collisions.
        if len(bucket_txns) < 3:
            continue
        bucket_txns.sort(key=lambda t: (t.date, t.id))

        matched_ids: set[int] = set()
        for i, a in enumerate(bucket_txns):
            a_any = cast(Any, a)
            target = _add_month_clamped(getattr(a_any, "date"))
            for b in bucket_txns[i + 1 :]:
                b_any = cast(Any, b)
                delta_days = (b.date - target).days
                if delta_days > tol_dom_days + 40:
                    break
                if abs(delta_days) > tol_dom_days:
                    continue
                if (
                    abs(
                        _to_cents(float(getattr(a_any, "amount")))
                        - _to_cents(float(getattr(b_any, "amount")))
                    )
                    > tol_cents
                ):
                    continue
                matched_ids.add(int(getattr(a_any, "id")))
                matched_ids.add(int(getattr(b_any, "id")))

        if len(matched_ids) < 3:
            continue

        matched_txns = [
            t for t in bucket_txns if int(getattr(cast(Any, t), "id")) in matched_ids
        ]
        anchor = _anchor_cents_from_txns(matched_txns)
        detected.append(
            _DetectedSeries(
                merchant_norm=ANY_MERCHANT_FINGERPRINT,
                amount_anchor_cents=int(anchor),
                transaction_ids=tuple(sorted(matched_ids)),
                cadence_type="monthly",
                cadence_days=30,
            )
        )

    return detected


@dataclass(frozen=True)
class CadenceGuess:
    cadence_type: str
    cadence_days: int
    confidence: float


def _infer_cadence(dates: list[date]) -> CadenceGuess | None:
    """
    Lightweight cadence inference scaffold.

    This is intentionally simple so we can iterate: it looks at inter-occurrence
    deltas and assigns the nearest known cadence bucket when confidence is high.
    """
    uniq = sorted({d for d in dates})
    if len(uniq) < 3:
        return None

    deltas = [(b - a).days for a, b in zip(uniq, uniq[1:]) if (b - a).days > 0]
    if len(deltas) < 2:
        return None

    deltas_sorted = sorted(deltas)
    median = deltas_sorted[len(deltas_sorted) // 2]

    # Buckets: (label, target_days, tolerance_days)
    buckets: list[tuple[str, int, int]] = [
        ("weekly", 7, 1),
        ("biweekly", 14, 2),
        ("monthly", 30, 4),  # calendar months vary; monthly detection handles alignment separately
        ("quarterly", 91, 6),
        ("semiannual", 182, 10),
        ("annual", 365, 12),
    ]

    best: tuple[str, int, int] | None = None
    best_dist = 10**9
    for label, target, tol in buckets:
        dist = abs(median - target)
        if dist < best_dist:
            best_dist = dist
            best = (label, target, tol)

    if best is None:
        return None
    label, target, tol = best
    if best_dist > tol:
        return None

    # Confidence: proportion of deltas that land near the target.
    hits = sum(1 for d in deltas if abs(d - target) <= tol)
    confidence = hits / max(1, len(deltas))
    if confidence < 0.66:
        return None

    return CadenceGuess(cadence_type=label, cadence_days=int(target), confidence=float(confidence))


def apply_series_action(session: Session, payload: RecurringSeriesActionIn, *, status_value: str) -> None:
    merchant_norm = _merchant_norm(payload.merchant_norm) or ANY_MERCHANT_FINGERPRINT
    amount_anchor_cents = int(payload.amount_anchor_cents)
    if not merchant_norm:
        raise ValueError("merchant_norm is required")
    if status_value not in {"suggested", "confirmed", "ignored", "removed"}:
        raise ValueError(f"Invalid status: {status_value}")

    existing = (
        session.query(RecurringSeries)
        .filter(
            RecurringSeries.merchant_norm == merchant_norm,
            RecurringSeries.amount_anchor_cents == amount_anchor_cents,
        )
        .first()
    )
    if existing is None:
        existing = RecurringSeries(
            merchant_norm=merchant_norm,
            amount_anchor_cents=amount_anchor_cents,
            status=status_value,
        )
        session.add(existing)
    else:
        existing_any = cast(Any, existing)
        existing_any.status = status_value

    # When confirming, auto-persist mapping if all occurrences share one pair.
    if status_value == "confirmed":
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
            existing_any = cast(Any, existing)
            existing_any.category_id = int(cid)
            existing_any.subcategory_id = int(sid)

    session.commit()


def _detected_series(session: Session) -> tuple[list[_DetectedSeries], dict[int, Transaction], dict[tuple[str, int], RecurringSeries]]:
    tol_cents = AMOUNT_TOLERANCE_CENTS_DEFAULT
    tol_dom_days = DAY_OF_MONTH_TOLERANCE_DEFAULT

    saved = (
        session.query(RecurringSeries)
        .order_by(RecurringSeries.merchant_norm.asc(), RecurringSeries.amount_anchor_cents.asc())
        .all()
    )
    saved_by_fp: dict[tuple[str, int], RecurringSeries] = {
        (str(cast(Any, r).merchant_norm), int(cast(Any, r).amount_anchor_cents)): r for r in saved
    }

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

    detected: list[_DetectedSeries] = []
    detected.extend(
        _detect_monthly_series(
            candidates,
            tol_cents=tol_cents,
            tol_dom_days=tol_dom_days,
        )
    )
    detected.extend(
        _detect_fixed_interval_series(
            candidates,
            tol_cents=tol_cents,
            cadence_type="weekly",
            cadence_days=7,
            tol_days=1,
            min_occurrences=4,
        )
    )
    detected.extend(
        _detect_fixed_interval_series(
            candidates,
            tol_cents=tol_cents,
            cadence_type="biweekly",
            cadence_days=14,
            tol_days=2,
            min_occurrences=3,
        )
    )
    detected.extend(
        _detect_fixed_interval_series(
            candidates,
            tol_cents=tol_cents,
            cadence_type="quarterly",
            cadence_days=91,
            tol_days=6,
            min_occurrences=2,
        )
    )
    detected.extend(
        _detect_fixed_interval_series(
            candidates,
            tol_cents=tol_cents,
            cadence_type="semiannual",
            cadence_days=182,
            tol_days=10,
            min_occurrences=2,
        )
    )
    detected.extend(
        _detect_fixed_interval_series(
            candidates,
            tol_cents=tol_cents,
            cadence_type="annual",
            cadence_days=365,
            tol_days=12,
            min_occurrences=2,
        )
    )

    txn_by_id: dict[int, Transaction] = {int(getattr(cast(Any, t), "id")): t for t in candidates}
    return detected, txn_by_id, saved_by_fp


def list_series_occurrences(session: Session, payload: RecurringSeriesActionIn) -> list[Transaction]:
    merchant_norm = _merchant_norm(payload.merchant_norm) or ANY_MERCHANT_FINGERPRINT
    amount_anchor_cents = int(payload.amount_anchor_cents)
    detected, txn_by_id, _ = _detected_series(session)
    for series in detected:
        if (
            series.merchant_norm == merchant_norm
            and int(series.amount_anchor_cents) == amount_anchor_cents
        ):
            txns = [txn_by_id[tid] for tid in series.transaction_ids if tid in txn_by_id]
            txns.sort(key=lambda t: (t.date, t.id), reverse=True)
            return txns
    return []


def series_occurrences_by_fingerprint(
    session: Session,
    *,
    merchant_norm: str,
    amount_anchor_cents: int,
) -> list[Transaction]:
    txns = list_series_occurrences(
        session,
        RecurringSeriesActionIn(
            merchant_norm=merchant_norm,
            amount_anchor_cents=int(amount_anchor_cents),
        ),
    )
    txns.sort(key=lambda t: (t.date, t.id), reverse=True)
    return txns


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

    merchant_norm = _merchant_norm(payload.merchant_norm) or ANY_MERCHANT_FINGERPRINT
    amount_anchor_cents = int(payload.amount_anchor_cents)
    existing = (
        session.query(RecurringSeries)
        .filter(
            RecurringSeries.merchant_norm == merchant_norm,
            RecurringSeries.amount_anchor_cents == amount_anchor_cents,
        )
        .first()
    )
    if existing is None:
        existing = RecurringSeries(
            merchant_norm=merchant_norm,
            amount_anchor_cents=amount_anchor_cents,
            status="suggested",
            category_id=int(category_id),
            subcategory_id=int(subcategory_id),
        )
        session.add(existing)
    else:
        existing_any = cast(Any, existing)
        existing_any.category_id = int(category_id)
        existing_any.subcategory_id = int(subcategory_id)

    session.commit()
    return updated


def list_recurring_suggestions(session: Session) -> list[RecurringSeriesCardOut]:
    detected, txn_by_id, saved_by_fp = _detected_series(session)

    cards_by_fp: dict[tuple[str, int], RecurringSeriesCardOut] = {}

    def upsert_card(
        *,
        merchant_norm: str,
        amount_anchor_cents: int,
        status: str,
        display_name: str | None = None,
        cadence_type: str | None = None,
        cadence_days: int | None = None,
        category_id: int | None = None,
        subcategory_id: int | None = None,
        occurrences: list[RecurringOccurrenceOut] | None = None,
    ) -> None:
        fp = (merchant_norm, int(amount_anchor_cents))
        existing = cards_by_fp.get(fp)
        if existing is None:
            cards_by_fp[fp] = RecurringSeriesCardOut(
                merchant_norm=merchant_norm,
                display_name=display_name,
                amount_anchor_cents=int(amount_anchor_cents),
                amount_anchor=_cents_to_amount(int(amount_anchor_cents)),
                status=status,
                cadence_type=cadence_type,
                cadence_days=cadence_days,
                category_id=category_id,
                subcategory_id=subcategory_id,
                occurrences=occurrences or [],
            )
            return

        # Merge: prefer non-empty occurrences and keep persisted cadence when present.
        if occurrences:
            existing.occurrences = occurrences
        if existing.cadence_type is None and cadence_type is not None:
            existing.cadence_type = cadence_type
        if existing.cadence_days is None and cadence_days is not None:
            existing.cadence_days = cadence_days
        if existing.display_name is None and display_name is not None:
            existing.display_name = display_name
        existing.status = status
        if category_id is not None:
            existing.category_id = int(category_id)
        if subcategory_id is not None:
            existing.subcategory_id = int(subcategory_id)

    # First, add detected series as suggested/confirmed depending on saved state.
    for s in detected:
        fp = (s.merchant_norm, int(s.amount_anchor_cents))
        saved_row = saved_by_fp.get(fp)
        saved_status = str(cast(Any, saved_row).status) if saved_row is not None else "suggested"
        if saved_status in {"ignored", "removed"}:
            continue

        occs: list[RecurringOccurrenceOut] = []
        occ_merchants: list[str] = []
        for tid in sorted(s.transaction_ids, reverse=True)[:8]:
            t = txn_by_id.get(int(tid))
            if t is None:
                continue
            t_any = cast(Any, t)
            occ_merchants.append(str(getattr(t_any, "merchant", "") or ""))
            occs.append(
                RecurringOccurrenceOut(
                    transaction_id=int(getattr(t_any, "id")),
                    date=getattr(t_any, "date"),
                    amount=float(getattr(t_any, "amount")),
                    merchant=str(getattr(t_any, "merchant")),
                )
            )
        occs.sort(key=lambda o: (o.date, o.transaction_id), reverse=True)

        guess = _infer_cadence([o.date for o in occs]) if occs else None
        saved_any = cast(Any, saved_row) if saved_row is not None else None
        upsert_card(
            merchant_norm=s.merchant_norm,
            amount_anchor_cents=int(s.amount_anchor_cents),
            status=saved_status,
            display_name=_build_display_name(occ_merchants),
            cadence_type=(
                getattr(saved_any, "cadence_type", None)
                if saved_any is not None and getattr(saved_any, "cadence_type", None)
                else (s.cadence_type or (guess.cadence_type if guess else None))
            ),
            cadence_days=(
                getattr(saved_any, "cadence_days", None)
                if saved_any is not None and getattr(saved_any, "cadence_days", None) is not None
                else (s.cadence_days or (guess.cadence_days if guess else None))
            ),
            category_id=(
                int(getattr(saved_any, "category_id"))
                if saved_any is not None and getattr(saved_any, "category_id", None) is not None
                else None
            ),
            subcategory_id=(
                int(getattr(saved_any, "subcategory_id"))
                if saved_any is not None and getattr(saved_any, "subcategory_id", None) is not None
                else None
            ),
            occurrences=occs,
        )

    # Then, ensure confirmed series always show even if we didn't detect them in current window.
    for r in saved_by_fp.values():
        r_any = cast(Any, r)
        status_value = str(getattr(r_any, "status"))
        if status_value in {"ignored", "removed"}:
            continue
        fp = (str(getattr(r_any, "merchant_norm")), int(getattr(r_any, "amount_anchor_cents")))
        if fp in cards_by_fp:
            continue
        upsert_card(
            merchant_norm=str(getattr(r_any, "merchant_norm")),
            amount_anchor_cents=int(getattr(r_any, "amount_anchor_cents")),
            status=status_value,
            display_name=None,
            cadence_type=getattr(r_any, "cadence_type", None),
            cadence_days=getattr(r_any, "cadence_days", None),
            category_id=getattr(r_any, "category_id", None),
            subcategory_id=getattr(r_any, "subcategory_id", None),
            occurrences=[],
        )

    # Stable ordering.
    return sorted(
        list(cards_by_fp.values()),
        key=lambda c: (c.status != "confirmed", c.merchant_norm, abs(int(c.amount_anchor_cents))),
    )

