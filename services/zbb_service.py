from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable

from sqlalchemy import func, union_all
from sqlalchemy.orm import Session

from db.models import (
    Account,
    BudgetCategory,
    BudgetPeriod,
    BudgetSetting,
    Category,
    CategoryBudget,
    Transaction,
    TransactionSplit,
)
from services.account_service import account_display_balance

VALID_ROLLOVER_MODES = {"strict", "flexible"}


@dataclass(frozen=True)
class ZbbCategoryRow:
    category_id: int
    category_name: str
    assigned: float
    activity: float
    rollover: float
    available: float
    is_system: bool
    system_kind: str | None
    linked_account_id: int | None = None
    cc_balance_target: float | None = None
    cc_balance_mismatch: bool = False


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    if month < 1 or month > 12:
        raise ValueError("month must be 1..12")
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1).fromordinal(date(year + 1, 1, 1).toordinal() - 1)
    else:
        end = date(year, month + 1, 1).fromordinal(date(year, month + 1, 1).toordinal() - 1)
    return start, end


def _prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _ym_before(year: int, month: int, start_year: int, start_month: int) -> bool:
    """True if (year, month) is strictly before the genesis (start) month."""
    return year < start_year or (year == start_year and month < start_month)


def get_budget_start_month(session: Session) -> tuple[int, int] | None:
    """First month that participates in ZBB; None = legacy (all history affects rollover)."""
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row:
        return None
    y, m = row.budget_start_year, row.budget_start_month
    if y is None or m is None:
        return None
    yi, mi = int(y), int(m)
    if mi < 1 or mi > 12:
        return None
    return (yi, mi)


def set_budget_start_month(session: Session, year: int | None, month: int | None) -> tuple[int, int] | None:
    """Set or clear the first ZBB month. Both None clears; both must be int together otherwise."""
    if (year is None) != (month is None):
        raise ValueError("budget_start_year and budget_start_month must both be set or both omitted")
    if month is not None and (int(month) < 1 or int(month) > 12):
        raise ValueError("budget_start_month must be 1..12")
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row:
        row = BudgetSetting(id=1, rollover_mode="strict")
        session.add(row)
    if year is None:
        row.budget_start_year = None
        row.budget_start_month = None
    else:
        row.budget_start_year = int(year)
        row.budget_start_month = int(month)
    session.flush()
    return get_budget_start_month(session)


def get_rollover_mode(session: Session) -> str:
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row:
        row = BudgetSetting(id=1, rollover_mode="strict")
        session.add(row)
        session.flush()
    mode = str(row.rollover_mode or "strict").lower()
    if mode not in VALID_ROLLOVER_MODES:
        row.rollover_mode = "strict"
        session.flush()
        return "strict"
    return mode


def set_rollover_mode(session: Session, mode: str) -> str:
    normalized = str(mode).lower().strip()
    if normalized not in VALID_ROLLOVER_MODES:
        raise ValueError("rollover_mode must be strict or flexible")
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row:
        row = BudgetSetting(id=1, rollover_mode=normalized)
        session.add(row)
    else:
        row.rollover_mode = normalized
    session.flush()
    return normalized


def list_budget_categories(session: Session) -> list[dict[str, object]]:
    rows = session.query(BudgetCategory).order_by(BudgetCategory.name.asc()).all()
    return [
        {
            "id": int(r.id),
            "name": str(r.name),
            "is_system": bool(r.is_system),
            "system_kind": str(r.system_kind) if r.system_kind else None,
            "linked_account_id": int(r.linked_account_id) if r.linked_account_id is not None else None,
            "txn_category_id": int(r.txn_category_id) if r.txn_category_id is not None else None,
            "txn_subcategory_id": int(r.txn_subcategory_id) if r.txn_subcategory_id is not None else None,
        }
        for r in rows
    ]


def create_budget_category(
    session: Session,
    *,
    name: str,
    txn_category_id: int | None = None,
    txn_subcategory_id: int | None = None,
) -> dict[str, object]:
    clean = name.strip()
    if not clean:
        raise ValueError("name is required")
    exists = session.query(BudgetCategory).filter(func.lower(BudgetCategory.name) == clean.lower()).first()
    if exists:
        raise ValueError("A budget category with that name already exists")
    row = BudgetCategory(
        name=clean,
        is_system=False,
        system_kind=None,
        txn_category_id=txn_category_id,
        txn_subcategory_id=txn_subcategory_id,
    )
    session.add(row)
    session.flush()
    return {"id": int(row.id), "name": clean}


def update_budget_category(
    session: Session,
    budget_category_id: int,
    *,
    name: str | None = None,
    txn_category_id: int | None = None,
    txn_subcategory_id: int | None = None,
) -> dict[str, object]:
    row = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not row:
        raise ValueError("Budget category not found")
    if row.is_system:
        raise ValueError("System budget categories cannot be edited")
    if name is not None:
        clean = name.strip()
        if not clean:
            raise ValueError("name cannot be empty")
        row.name = clean
    row.txn_category_id = txn_category_id
    row.txn_subcategory_id = txn_subcategory_id
    session.flush()
    return {"id": int(row.id), "name": str(row.name)}


def delete_budget_category(session: Session, budget_category_id: int) -> None:
    row = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not row:
        raise ValueError("Budget category not found")
    if row.is_system:
        raise ValueError("System budget categories cannot be deleted")
    session.query(CategoryBudget).filter(CategoryBudget.budget_category_id == int(row.id)).delete(synchronize_session=False)
    session.delete(row)
    session.flush()


def _ensure_budget_categories(session: Session) -> None:
    # Backfill from transaction category mappings if table has legacy-only state.
    existing_txn_mapped = {
        int(r.txn_category_id)
        for r in session.query(BudgetCategory.txn_category_id).filter(BudgetCategory.txn_category_id.isnot(None)).all()
    }
    for c in session.query(Category).order_by(Category.id.asc()).all():
        cid = int(c.id)
        if cid in existing_txn_mapped:
            continue
        session.add(BudgetCategory(name=str(c.name), txn_category_id=cid))
    # Ensure CC payment categories.
    credit_accounts = session.query(Account).filter(func.lower(Account.type) == "credit").all()
    for acct in credit_accounts:
        has_row = (
            session.query(BudgetCategory)
            .filter(
                BudgetCategory.is_system.is_(True),
                BudgetCategory.system_kind == "cc_payment",
                BudgetCategory.linked_account_id == acct.id,
            )
            .first()
        )
        if has_row:
            continue
        session.add(
            BudgetCategory(
                name=f"{acct.name} Payment",
                is_system=True,
                system_kind="cc_payment",
                linked_account_id=acct.id,
            )
        )
    session.flush()


def ensure_period(session: Session, year: int, month: int) -> BudgetPeriod:
    row = session.query(BudgetPeriod).filter(BudgetPeriod.year == year, BudgetPeriod.month == month).first()
    if not row:
        row = BudgetPeriod(year=year, month=month, rta_snapshot=0.0)
        session.add(row)
        session.flush()
    _ensure_budget_categories(session)
    _ensure_category_budgets(session, int(row.id))
    return row


def _ensure_category_budgets(session: Session, budget_period_id: int) -> None:
    fallback_category_id = (
        session.query(Category.id)
        .filter(Category.name == "Other")
        .order_by(Category.id.asc())
        .scalar()
    )
    if fallback_category_id is None:
        fallback_category_id = session.query(Category.id).order_by(Category.id.asc()).scalar()
    if fallback_category_id is None:
        raise ValueError("At least one transaction category is required to initialize budget rows")

    existing = {
        int(cid)
        for (cid,) in session.query(CategoryBudget.budget_category_id)
        .filter(CategoryBudget.budget_period_id == budget_period_id)
        .filter(CategoryBudget.budget_category_id.isnot(None))
        .all()
    }
    for bc in session.query(BudgetCategory).all():
        bcid = int(bc.id)
        if bcid in existing:
            continue
        session.add(
            CategoryBudget(
                category_id=int(bc.txn_category_id) if bc.txn_category_id is not None else int(fallback_category_id),
                budget_category_id=bcid,
                budget_period_id=budget_period_id,
                assigned=0.0,
                activity=0.0,
            )
        )
    session.flush()


def ensure_current_and_next_period(session: Session, year: int, month: int) -> None:
    ensure_period(session, year, month)
    ny, nm = _next_month(year, month)
    ensure_period(session, ny, nm)


def _txn_net_rows(session: Session, start: date, end: date) -> list[tuple[int, int | None, float]]:
    split_q = (
        session.query(
            TransactionSplit.category_id.label("category_id"),
            TransactionSplit.subcategory_id.label("subcategory_id"),
            TransactionSplit.amount.label("amount"),
        )
        .select_from(TransactionSplit)
        .join(TransactionSplit.transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start, Transaction.date <= end)
    )
    base_q = (
        session.query(
            Transaction.category_id.label("category_id"),
            Transaction.subcategory_id.label("subcategory_id"),
            Transaction.amount.label("amount"),
        )
        .select_from(Transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start, Transaction.date <= end)
        .filter(~Transaction.splits.any())
    )
    combined = union_all(split_q, base_q).subquery("zbb_txn_rows")
    return [
        (int(cid), int(sid) if sid is not None else None, float(total or 0.0))
        for cid, sid, total in session.query(
            combined.c.category_id,
            combined.c.subcategory_id,
            func.coalesce(func.sum(combined.c.amount), 0.0),
        )
        .filter(combined.c.category_id.isnot(None))
        .group_by(combined.c.category_id, combined.c.subcategory_id)
        .all()
    ]


def _cc_payment_activity_delta_for_month(session: Session, start: date, end: date) -> dict[int, float]:
    """
    Per credit account: net **payments** booked on the card in the month (transfer legs with amount > 0 on the card).

    Card charges are excluded so Activity on the CC payment envelope only moves when money actually pays down the
    bank balance; spending stays on category envelopes (Food, etc.).
    """
    out: dict[int, float] = {}
    payment_transfers = (
        session.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(func.lower(Account.type) == "credit")
        .filter(Transaction.is_transfer.is_(True))
        .filter(Transaction.date >= start, Transaction.date <= end)
        .all()
    )
    for tx in payment_transfers:
        if float(tx.amount) > 0:
            out[int(tx.account_id)] = out.get(int(tx.account_id), 0.0) - float(tx.amount)
    return out


def _cc_card_charge_outflows_by_account(session: Session, start: date, end: date) -> dict[int, float]:
    """
    Per credit account: total card **charges** (non-transfer outflows) in the month.

    These amounts are added only to CC payment **Available** (not Activity) so Assigned stays “plan” while
    envelope cash power moves from category rows (via their Activity) into the card payment row.
    """
    out: dict[int, float] = {}
    txns = (
        session.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(func.lower(Account.type) == "credit")
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start, Transaction.date <= end)
        .all()
    )
    for tx in txns:
        amt = float(tx.amount)
        if amt < 0:
            aid = int(tx.account_id)
            out[aid] = out.get(aid, 0.0) + abs(amt)
    return out


def recompute_activity_for_month(session: Session, year: int, month: int) -> None:
    period = ensure_period(session, year, month)
    start_ym = get_budget_start_month(session)
    if start_ym is not None and _ym_before(year, month, start_ym[0], start_ym[1]):
        rows = session.query(CategoryBudget).filter(CategoryBudget.budget_period_id == int(period.id)).all()
        for row in rows:
            row.activity = 0.0
        session.flush()
        return

    start, end = _month_bounds(year, month)
    txn_rows = _txn_net_rows(session, start, end)
    cc_payment_delta = _cc_payment_activity_delta_for_month(session, start, end)

    rows = session.query(CategoryBudget).filter(CategoryBudget.budget_period_id == int(period.id)).all()
    bc_map = {int(b.id): b for b in session.query(BudgetCategory).all()}
    by_cat_sub: dict[tuple[int, int | None], float] = {}
    by_cat: dict[int, float] = {}
    for cid, sid, total in txn_rows:
        by_cat_sub[(cid, sid)] = by_cat_sub.get((cid, sid), 0.0) + total
        by_cat[cid] = by_cat.get(cid, 0.0) + total

    for row in rows:
        bcid = int(row.budget_category_id) if row.budget_category_id is not None else None
        if bcid is None:
            row.activity = 0.0
            continue
        bc = bc_map.get(bcid)
        if not bc:
            row.activity = 0.0
            continue
        if bc.is_system and bc.system_kind == "cc_payment":
            linked = int(bc.linked_account_id) if bc.linked_account_id is not None else None
            row.activity = -float(cc_payment_delta.get(linked, 0.0)) if linked is not None else 0.0
            continue
        tcid = int(bc.txn_category_id) if bc.txn_category_id is not None else None
        tsid = int(bc.txn_subcategory_id) if bc.txn_subcategory_id is not None else None
        if tcid is None:
            row.activity = 0.0
        elif tsid is None:
            row.activity = max(0.0, -float(by_cat.get(tcid, 0.0)))
        else:
            row.activity = max(0.0, -float(by_cat_sub.get((tcid, tsid), 0.0)))
    session.flush()


def _liquid_budget_pool(session: Session) -> float:
    """
    Net cash for ZBB: sum of budget (cash-side) accounts plus every credit card's display balance.

    Credit balances are typically negative (debt), so they reduce the pool without requiring cards to be budget accounts.
    """
    total = 0.0
    for acct in session.query(Account).filter(Account.is_budget_account.is_(True)).all():
        if str(acct.type).lower() == "credit":
            continue
        display_balance, _ = account_display_balance(session, acct)
        total += float(display_balance)
    for acct in session.query(Account).filter(func.lower(Account.type) == "credit").all():
        display_balance, _ = account_display_balance(session, acct)
        total += float(display_balance)
    return total


def _rows_for_period(session: Session, period_id: int) -> list[CategoryBudget]:
    return (
        session.query(CategoryBudget)
        .filter(CategoryBudget.budget_period_id == period_id)
        .order_by(CategoryBudget.id.asc())
        .all()
    )


def _period_rollovers_recursive(
    session: Session,
    year: int,
    month: int,
    mode: str,
    memo: dict[tuple[int, int], tuple[dict[int, float], float]],
    budget_start: tuple[int, int] | None,
) -> tuple[dict[int, float], float]:
    key = (year, month)
    if key in memo:
        return memo[key]
    py, pm = _prev_month(year, month)
    if budget_start is not None and _ym_before(py, pm, budget_start[0], budget_start[1]):
        base = ({int(b.id): 0.0 for b in session.query(BudgetCategory).all()}, 0.0)
        memo[key] = base
        return base
    prev = session.query(BudgetPeriod).filter(BudgetPeriod.year == py, BudgetPeriod.month == pm).first()
    if not prev:
        base = ({int(b.id): 0.0 for b in session.query(BudgetCategory).all()}, 0.0)
        memo[key] = base
        return base
    prev_rollovers, inherited_deficit = _period_rollovers_recursive(session, py, pm, mode, memo, budget_start)
    prev_rows = _rows_for_period(session, int(prev.id))
    roll: dict[int, float] = {int(b.id): 0.0 for b in session.query(BudgetCategory).all()}
    p_start, p_end = _month_bounds(int(prev.year), int(prev.month))
    cc_charges_prev = _cc_card_charge_outflows_by_account(session, p_start, p_end)
    bc_by_id = {int(b.id): b for b in session.query(BudgetCategory).all()}
    # Flexible mode: overspend from earlier months is carried forward so RTA is not understated.
    deficit = float(inherited_deficit)
    for row in prev_rows:
        bcid = int(row.budget_category_id) if row.budget_category_id is not None else None
        if bcid is None:
            continue
        base_avail = float(prev_rollovers.get(bcid, 0.0)) + float(row.assigned) - float(row.activity)
        bc_prev = bc_by_id.get(bcid)
        if (
            bc_prev is not None
            and bc_prev.is_system
            and bc_prev.system_kind == "cc_payment"
            and bc_prev.linked_account_id is not None
        ):
            la = int(bc_prev.linked_account_id)
            prev_available = base_avail + float(cc_charges_prev.get(la, 0.0))
        else:
            prev_available = base_avail
        if mode == "strict":
            roll[bcid] = prev_available
        else:
            if prev_available < 0:
                deficit += abs(prev_available)
                roll[bcid] = 0.0
            else:
                roll[bcid] = prev_available
    memo[key] = (roll, deficit)
    return memo[key]


def _period_rollovers(session: Session, *, year: int, month: int, mode: str) -> tuple[dict[int, float], float]:
    """
    Rollover **into** (year, month): end-of-previous-month envelope balances, plus cumulative flexible
    overspend (deficit) applied to this month's RTA.

    The recursive key must be the month being **viewed**, not the calendar month before it: otherwise
    we'd use the prior month's *starting* rollover and skip that month's assigned/activity entirely.
    """
    _ = ensure_period(session, year, month)
    return _period_rollovers_recursive(session, year, month, mode, {}, get_budget_start_month(session))


def get_month_overview(session: Session, year: int, month: int) -> dict[str, object]:
    ensure_current_and_next_period(session, year, month)
    recompute_activity_for_month(session, year, month)
    period = ensure_period(session, year, month)
    mode = get_rollover_mode(session)
    start_ym = get_budget_start_month(session)
    before_budget = start_ym is not None and _ym_before(year, month, start_ym[0], start_ym[1])
    rollovers, prior_deficit = _period_rollovers(session, year=year, month=month, mode=mode)
    rows = _rows_for_period(session, int(period.id))
    bc_map = {int(b.id): b for b in session.query(BudgetCategory).all()}
    m_start, m_end = _month_bounds(year, month)
    cc_charge_by_acct = _cc_card_charge_outflows_by_account(session, m_start, m_end)

    out_rows: list[ZbbCategoryRow] = []
    total_available_non_negative = 0.0
    total_overspent = 0.0
    total_assigned = 0.0
    for row in rows:
        bcid = int(row.budget_category_id) if row.budget_category_id is not None else None
        if bcid is None:
            continue
        bc = bc_map.get(bcid)
        if not bc:
            continue
        rollover = float(rollovers.get(bcid, 0.0))
        assigned = float(row.assigned or 0.0)
        if before_budget:
            assigned = 0.0
        activity = float(row.activity or 0.0)
        linked_aid = int(bc.linked_account_id) if bc.linked_account_id is not None else None
        cc_system_shift = 0.0
        if (
            not before_budget
            and bc.is_system
            and bc.system_kind == "cc_payment"
            and linked_aid is not None
        ):
            cc_system_shift = float(cc_charge_by_acct.get(linked_aid, 0.0))
        available = rollover + assigned - activity + cc_system_shift
        total_assigned += assigned
        if available >= 0:
            total_available_non_negative += available
        else:
            total_overspent += abs(available)
        cc_target: float | None = None
        cc_mismatch = False
        if bc.is_system and bc.system_kind == "cc_payment" and linked_aid is not None:
            acct = session.query(Account).filter(Account.id == linked_aid).first()
            if acct is not None:
                bal, _ = account_display_balance(session, acct)
                cc_target = abs(float(bal))
                cc_mismatch = abs(float(available) - cc_target) > 0.009
        out_rows.append(
            ZbbCategoryRow(
                category_id=bcid,
                category_name=str(bc.name),
                assigned=assigned,
                activity=activity,
                rollover=rollover,
                available=available,
                is_system=bool(bc.is_system),
                system_kind=str(bc.system_kind) if bc.system_kind else None,
                linked_account_id=linked_aid,
                cc_balance_target=cc_target,
                cc_balance_mismatch=cc_mismatch,
            )
        )
    liquid_pool = _liquid_budget_pool(session)
    rta = liquid_pool - total_available_non_negative - total_overspent - prior_deficit
    period.rta_snapshot = rta
    session.flush()
    return {
        "year": year,
        "month": month,
        "rollover_mode": mode,
        "budget_start_year": start_ym[0] if start_ym else None,
        "budget_start_month": start_ym[1] if start_ym else None,
        "is_before_budget_start": before_budget,
        "liquid_pool": liquid_pool,
        "total_assigned": total_assigned,
        "ready_to_assign": rta,
        "rows": [r.__dict__ for r in sorted(out_rows, key=lambda x: x.category_name.lower())],
    }


def _assert_budget_month_active(session: Session, year: int, month: int) -> None:
    start_ym = get_budget_start_month(session)
    if start_ym is not None and _ym_before(year, month, start_ym[0], start_ym[1]):
        raise ValueError(
            "This month is before your first budget month. Change the month selector or update Budget start in settings."
        )


def _validate_assignment_preconditions(session: Session, year: int, month: int) -> None:
    _assert_budget_month_active(session, year, month)
    budget_accounts = session.query(Account).filter(Account.is_budget_account.is_(True)).count()
    if int(budget_accounts) <= 0:
        raise ValueError("Configure at least one Budget account before assigning money.")
    start, end = _month_bounds(year, month)
    uncategorized_count = (
        session.query(Transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.date >= start, Transaction.date <= end)
        .filter((Transaction.category_id.is_(None)) | (Transaction.subcategory_id.is_(None)))
        .count()
    )
    if int(uncategorized_count) > 0:
        raise ValueError("Unmapped transactions exist for this month. Categorize them before assigning money.")


def assign_amount(session: Session, year: int, month: int, category_id: int, assigned: float) -> dict[str, object]:
    _validate_assignment_preconditions(session, year, month)
    period = ensure_period(session, year, month)
    row = (
        session.query(CategoryBudget)
        .filter(CategoryBudget.budget_period_id == period.id, CategoryBudget.budget_category_id == int(category_id))
        .first()
    )
    if not row:
        raise ValueError("Category budget row not found")
    row.assigned = float(assigned)
    session.flush()
    out = get_month_overview(session, year, month)
    if float(out["ready_to_assign"]) < 0:
        raise ValueError("Cannot assign money you do not have (Ready to Assign would be negative).")
    return out


def move_money(
    session: Session,
    year: int,
    month: int,
    *,
    from_category_id: int,
    to_category_id: int,
    amount: float,
) -> dict[str, object]:
    _assert_budget_month_active(session, year, month)
    if from_category_id == to_category_id:
        raise ValueError("from_category_id and to_category_id must differ")
    if float(amount) <= 0:
        raise ValueError("amount must be positive")
    period = ensure_period(session, year, month)
    rows = (
        session.query(CategoryBudget)
        .filter(
            CategoryBudget.budget_period_id == period.id,
            CategoryBudget.budget_category_id.in_([int(from_category_id), int(to_category_id)]),
        )
        .all()
    )
    row_map = {int(r.budget_category_id): r for r in rows if r.budget_category_id is not None}
    src = row_map.get(int(from_category_id))
    dst = row_map.get(int(to_category_id))
    if not src or not dst:
        raise ValueError("One or more categories are missing for this period")
    src.assigned = float(src.assigned) - float(amount)
    dst.assigned = float(dst.assigned) + float(amount)
    session.flush()
    return get_month_overview(session, year, month)


def recalc_activity_for_months(session: Session, months: Iterable[tuple[int, int]]) -> None:
    for y, m in sorted(set((int(y), int(m)) for y, m in months)):
        recompute_activity_for_month(session, y, m)
