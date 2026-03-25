from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

from sqlalchemy import func, union_all
from sqlalchemy.orm import Session

from db.models import (
    BudgetLimit,
    BudgetMonth,
    Category,
    RecurringSeries,
    Subcategory,
    Transaction,
    TransactionSplit,
)
from services.recurring_service import series_occurrences_by_fingerprint


def normalize_month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def month_range(month_start: date) -> tuple[date, date]:
    ms = normalize_month_start(month_start)
    last_day = calendar.monthrange(ms.year, ms.month)[1]
    return ms, date(ms.year, ms.month, last_day)


def get_or_create_budget_month(session: Session, month_start: date) -> BudgetMonth:
    ms = normalize_month_start(month_start)
    existing = session.query(BudgetMonth).filter(BudgetMonth.month_start == ms).first()
    if existing:
        return existing
    bm = BudgetMonth(month_start=ms)
    session.add(bm)
    session.flush()
    return bm


def list_limits_for_month(session: Session, month_start: date) -> tuple[BudgetMonth, list[BudgetLimit]]:
    bm = get_or_create_budget_month(session, month_start)
    limits = (
        session.query(BudgetLimit)
        .filter(BudgetLimit.budget_month_id == bm.id)
        .order_by(BudgetLimit.category_id.asc(), BudgetLimit.subcategory_id.asc().nullsfirst())
        .all()
    )
    return bm, limits


@dataclass(frozen=True)
class _SpentRow:
    category_id: int
    subcategory_id: int
    total: float


def _spent_rows_for_range(session: Session, start: date, end: date) -> list[_SpentRow]:
    """
    Return split-aware net totals per (category_id, subcategory_id) for a date range.

    Totals are the signed sum under the app cash-flow convention (negative = outflow).
    Transfers are excluded.
    """

    split_q = (
        session.query(
            TransactionSplit.category_id.label("category_id"),
            TransactionSplit.subcategory_id.label("subcategory_id"),
            TransactionSplit.amount.label("amount"),
        )
        .select_from(TransactionSplit)
        .join(TransactionSplit.transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start)
        .filter(Transaction.date <= end)
    )

    base_q = (
        session.query(
            Transaction.category_id.label("category_id"),
            Transaction.subcategory_id.label("subcategory_id"),
            Transaction.amount.label("amount"),
        )
        .select_from(Transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start)
        .filter(Transaction.date <= end)
        .filter(~Transaction.splits.any())
    )

    combined = union_all(split_q, base_q).subquery("budget_spend_rows")
    agg = (
        session.query(
            combined.c.category_id,
            combined.c.subcategory_id,
            func.coalesce(func.sum(combined.c.amount), 0.0).label("total"),
        )
        .group_by(combined.c.category_id, combined.c.subcategory_id)
        .all()
    )
    out: list[_SpentRow] = []
    for r in agg:
        if r.category_id is None or r.subcategory_id is None:
            continue
        out.append(_SpentRow(int(r.category_id), int(r.subcategory_id), float(r.total or 0.0)))
    return out


def _spent_maps_for_month(session: Session, month_start: date) -> tuple[dict[int, float], dict[tuple[int, int], float]]:
    start, end = month_range(month_start)
    rows = _spent_rows_for_range(session, start, end)
    by_sub: dict[tuple[int, int], float] = {}
    by_cat: dict[int, float] = {}
    for r in rows:
        by_sub[(r.category_id, r.subcategory_id)] = float(r.total)
        by_cat[r.category_id] = by_cat.get(r.category_id, 0.0) + float(r.total)
    return by_cat, by_sub


def _net_to_spent_amount(net_total: float) -> float:
    # net_total is signed under cash-flow convention; spending is outflow magnitude.
    spent = -float(net_total)
    return spent if spent > 0 else 0.0


def _infer_cadence_days_from_occurrences(occurrence_dates: list[date]) -> int | None:
    uniq = sorted(set(occurrence_dates))
    if len(uniq) < 2:
        return None
    deltas = [(b - a).days for a, b in zip(uniq, uniq[1:]) if (b - a).days > 0]
    if not deltas:
        return None
    deltas.sort()
    return int(deltas[len(deltas) // 2])


def _projected_recurring_for_month(
    session: Session,
    month_start: date,
) -> tuple[dict[int, float], dict[tuple[int, int], float]]:
    """
    Project remaining recurring spend for this month from confirmed series.

    Requires each confirmed series to have a single mapped category/subcategory.
    """
    start, end = month_range(month_start)
    days_in_month = (end - start).days + 1

    confirmed = (
        session.query(RecurringSeries)
        .filter(RecurringSeries.status == "confirmed")
        .order_by(RecurringSeries.id.asc())
        .all()
    )

    missing_mapping: list[str] = []
    projected_cat: dict[int, float] = {}
    projected_sub: dict[tuple[int, int], float] = {}

    for series in confirmed:
        series_any = cast(Any, series)
        cid = int(getattr(series_any, "category_id")) if getattr(series_any, "category_id", None) is not None else None
        sid = int(getattr(series_any, "subcategory_id")) if getattr(series_any, "subcategory_id", None) is not None else None

        occs = series_occurrences_by_fingerprint(
            session,
            merchant_norm=str(getattr(series_any, "merchant_norm")),
            amount_anchor_cents=int(getattr(series_any, "amount_anchor_cents")),
        )

        # Backward-compatible fallback: infer canonical mapping from occurrences when
        # RecurringSeries mapping is missing but all detected rows agree.
        if cid is None or sid is None:
            mapped = [
                (int(getattr(cast(Any, o), "category_id")), int(getattr(cast(Any, o), "subcategory_id")))
                for o in occs
                if getattr(cast(Any, o), "category_id", None) is not None
                and getattr(cast(Any, o), "subcategory_id", None) is not None
            ]
            unique_pairs = set(mapped)
            if len(unique_pairs) == 1:
                cid, sid = next(iter(unique_pairs))
            else:
                missing_mapping.append(f"{series.merchant_norm}:{int(series.amount_anchor_cents)}")
                continue

        # Validate mapped subcategory belongs to mapped category.
        sub = session.query(Subcategory).filter(Subcategory.id == sid).first()
        if sub is None or int(getattr(cast(Any, sub), "category_id")) != int(cid):
            raise ValueError(
                f"Recurring series {series.merchant_norm}:{int(series.amount_anchor_cents)} has invalid category/subcategory mapping"
            )

        amount_per_occurrence = abs(float(series.amount_anchor_cents)) / 100.0
        if amount_per_occurrence <= 0:
            continue

        occ_in_month = [o for o in occs if start <= o.date <= end]

        cadence_days = int(getattr(series_any, "cadence_days")) if getattr(series_any, "cadence_days", None) is not None else None
        if cadence_days is None or cadence_days <= 0:
            inferred = _infer_cadence_days_from_occurrences([o.date for o in occs])
            cadence_days = inferred if inferred is not None and inferred > 0 else 30

        expected_occurrences = max(1, int(round(days_in_month / float(cadence_days))))
        projected_remaining_count = max(0, expected_occurrences - len(occ_in_month))
        projected_amount = float(projected_remaining_count) * amount_per_occurrence
        if projected_amount <= 0:
            continue

        projected_cat[cid] = projected_cat.get(cid, 0.0) + projected_amount
        projected_sub[(cid, sid)] = projected_sub.get((cid, sid), 0.0) + projected_amount

    if missing_mapping:
        sample = ", ".join(missing_mapping[:3])
        more = "" if len(missing_mapping) <= 3 else f" (+{len(missing_mapping) - 3} more)"
        raise ValueError(
            "Confirmed recurring series must be mapped to a single category/subcategory before projected recurring can be enabled. "
            f"Missing mapping: {sample}{more}"
        )

    return projected_cat, projected_sub


def upsert_limits(
    session: Session,
    month_start: date,
    *,
    items: list[dict[str, object]] | None = None,
) -> tuple[BudgetMonth, list[BudgetLimit]]:
    """
    Bulk upsert limits and enforce allocation math:
    - Category cap exists (subcategory_id NULL) when subcategory allocations exist.
    - If sum(subcategory allocations) > category cap, category cap auto-increases to that sum.
    - Category cap may exceed allocated sum (unallocated remainder allowed).
    """

    bm = get_or_create_budget_month(session, month_start)
    items = items or []

    # Load lookup for subcategory -> category validation
    subcat_to_cat: dict[int, int] = {
        int(s.id): int(s.category_id) for s in session.query(Subcategory.id, Subcategory.category_id).all()
    }

    desired_caps: dict[int, float] = {}  # category_id -> cap
    desired_allocs: dict[tuple[int, int], float] = {}  # (category_id, subcategory_id) -> amount

    for raw in items:
        category_id = int(raw["category_id"])
        subcategory_id = raw.get("subcategory_id", None)
        limit_amount = float(raw["limit_amount"])
        if subcategory_id is None:
            desired_caps[category_id] = limit_amount
        else:
            sub_id = int(subcategory_id)
            if sub_id not in subcat_to_cat:
                raise ValueError(f"Unknown subcategory_id={sub_id}")
            if subcat_to_cat[sub_id] != category_id:
                raise ValueError("subcategory_id does not belong to category_id")
            desired_allocs[(category_id, sub_id)] = limit_amount

    # Apply subcategory allocations first.
    for (cat_id, sub_id), amt in desired_allocs.items():
        row = (
            session.query(BudgetLimit)
            .filter(BudgetLimit.budget_month_id == bm.id)
            .filter(BudgetLimit.category_id == cat_id)
            .filter(BudgetLimit.subcategory_id == sub_id)
            .first()
        )
        if row:
            row.limit_amount = amt
        else:
            session.add(
                BudgetLimit(
                    budget_month_id=bm.id,
                    category_id=cat_id,
                    subcategory_id=sub_id,
                    limit_amount=amt,
                )
            )

    # Apply category caps and enforce "caps >= allocated sum".
    # Start from any explicitly provided category caps.
    for cat_id, cap in desired_caps.items():
        row = (
            session.query(BudgetLimit)
            .filter(BudgetLimit.budget_month_id == bm.id)
            .filter(BudgetLimit.category_id == cat_id)
            .filter(BudgetLimit.subcategory_id.is_(None))
            .first()
        )
        if row:
            row.limit_amount = cap
        else:
            session.add(
                BudgetLimit(
                    budget_month_id=bm.id,
                    category_id=cat_id,
                    subcategory_id=None,
                    limit_amount=cap,
                )
            )

    session.flush()

    # Now compute allocated sums per category and ensure a category row exists and is >= that sum.
    alloc_sums: dict[int, float] = {}
    for (cat_id, _sub_id), amt in desired_allocs.items():
        alloc_sums[cat_id] = alloc_sums.get(cat_id, 0.0) + float(amt)

    for cat_id, alloc_sum in alloc_sums.items():
        cap_row = (
            session.query(BudgetLimit)
            .filter(BudgetLimit.budget_month_id == bm.id)
            .filter(BudgetLimit.category_id == cat_id)
            .filter(BudgetLimit.subcategory_id.is_(None))
            .first()
        )
        if not cap_row:
            session.add(
                BudgetLimit(
                    budget_month_id=bm.id,
                    category_id=cat_id,
                    subcategory_id=None,
                    limit_amount=float(alloc_sum),
                )
            )
        else:
            if float(cap_row.limit_amount) < float(alloc_sum):
                cap_row.limit_amount = float(alloc_sum)

    session.flush()
    return list_limits_for_month(session, month_start)


def delete_budget_category(
    session: Session,
    month_start: date,
    *,
    category_id: int,
) -> tuple[BudgetMonth, list[BudgetLimit]]:
    bm = get_or_create_budget_month(session, month_start)
    (
        session.query(BudgetLimit)
        .filter(BudgetLimit.budget_month_id == bm.id)
        .filter(BudgetLimit.category_id == int(category_id))
        .delete(synchronize_session=False)
    )
    session.flush()
    return list_limits_for_month(session, month_start)


def budget_progress_for_month(
    session: Session,
    month_start: date,
    *,
    include_projected: bool = False,
) -> dict[str, object]:
    bm, limits = list_limits_for_month(session, month_start)

    cat_names: dict[int, str] = {
        int(r.id): str(r.name) for r in session.query(Category.id, Category.name).all()
    }
    sub_names: dict[int, str] = {
        int(r.id): str(r.name) for r in session.query(Subcategory.id, Subcategory.name).all()
    }

    cat_net_by_id, sub_net_by_id = _spent_maps_for_month(session, bm.month_start)
    projected_cat_by_id: dict[int, float] = {}
    projected_sub_by_id: dict[tuple[int, int], float] = {}
    if include_projected:
        projected_cat_by_id, projected_sub_by_id = _projected_recurring_for_month(session, bm.month_start)

    # Group limits.
    cat_caps: dict[int, float] = {}
    sub_allocs: dict[int, list[BudgetLimit]] = {}
    for l in limits:
        cid = int(l.category_id)
        if l.subcategory_id is None:
            cat_caps[cid] = float(l.limit_amount)
        else:
            sub_allocs.setdefault(cid, []).append(l)

    categories_out: list[dict[str, object]] = []
    cat_ids = sorted(set(cat_caps.keys()) | set(sub_allocs.keys()))

    for cid in cat_ids:
        cap = float(cat_caps.get(cid, 0.0))
        subs = sub_allocs.get(cid, [])
        allocated = float(sum(float(s.limit_amount) for s in subs))
        unallocated = cap - allocated
        if unallocated < 0:
            unallocated = 0.0

        spent_cat_actual = _net_to_spent_amount(cat_net_by_id.get(cid, 0.0))
        projected_cat = float(projected_cat_by_id.get(cid, 0.0)) if include_projected else 0.0
        spent_cat = spent_cat_actual + projected_cat
        remaining_cat = cap - spent_cat
        percent_cat = (spent_cat / cap * 100.0) if cap > 0 else 0.0

        sub_out: list[dict[str, object]] = []
        for s in sorted(subs, key=lambda x: int(x.subcategory_id or 0)):
            sid = int(s.subcategory_id or 0)
            s_cap = float(s.limit_amount)
            s_spent_actual = _net_to_spent_amount(sub_net_by_id.get((cid, sid), 0.0))
            s_projected = (
                float(projected_sub_by_id.get((cid, sid), 0.0))
                if include_projected
                else 0.0
            )
            s_spent = s_spent_actual + s_projected
            s_remaining = s_cap - s_spent
            s_percent = (s_spent / s_cap * 100.0) if s_cap > 0 else 0.0
            sub_out.append(
                {
                    "category_id": cid,
                    "subcategory_id": sid,
                    "subcategory_name": sub_names.get(sid, ""),
                    "limit_amount": s_cap,
                    "spent_amount": s_spent,
                    "remaining_amount": s_remaining,
                    "percent_used": s_percent,
                    "projected_spent_amount": s_projected,
                }
            )

        categories_out.append(
            {
                "category_id": cid,
                "category_name": cat_names.get(cid, ""),
                "limit_amount": cap,
                "allocated_to_subcategories": allocated,
                "unallocated_amount": unallocated,
                "spent_amount": spent_cat,
                "remaining_amount": remaining_cat,
                "percent_used": percent_cat,
                "projected_spent_amount": projected_cat,
                "subcategories": sub_out,
            }
        )

    return {
        "month_start": bm.month_start,
        "include_projected": bool(include_projected),
        "categories": categories_out,
    }

