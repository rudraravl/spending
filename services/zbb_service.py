"""
Zero-based (envelope) budgeting, modelled on Actual Budget's envelope budget and YNAB.

Core identity, which always holds for the RTA horizon month:

    Ready to Assign = Cash on budget − Σ Available(envelope)

* **Cash on budget** is the sum of current balances of every account flagged as a Budget account.
  Credit cards flagged as budget accounts count with their (negative) balance, so card debt is
  already "paid for" out of cash: a charge lowers the card balance *and* the envelope it was
  categorized to, leaving Ready to Assign untouched, and a card payment is just a transfer between
  two budget accounts. No separate card-payment envelopes are needed.
* **Available** = carried-over balance + Assigned + Activity, where Activity is the signed net of
  transactions mapped to the envelope (spending negative, refunds positive).
* Income (the Income category) is not an envelope: it raises cash, and therefore Ready to Assign.
* Spending in categories that have no envelope ("unbudgeted") lowers cash without lowering any
  envelope, so it comes straight out of Ready to Assign.
* Overspending: in ``strict`` mode a negative Available carries into the next month's envelope; in
  ``flexible`` mode (YNAB's default) the envelope resets to $0 next month and the identity
  automatically takes the overspent amount out of Ready to Assign.

Ready to Assign is a single, budget-wide number evaluated at the horizon month: the latest of the
current calendar month and the last month with any assignment. That way assigning into a future
month reduces it immediately, and past overspending is reflected exactly once.

Activity is computed live from transactions on every request, so it is never stale.
"""

from __future__ import annotations

from collections import defaultdict
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
    Subcategory,
    Transaction,
    TransactionSplit,
)
from services.account_service import display_balances_by_account
from services.summary_service import INCOME_CATEGORY_NAME

VALID_ROLLOVER_MODES = {"strict", "flexible"}
QUICK_ASSIGN_STRATEGIES = {"targets", "last_month", "avg_spent", "clear"}
AVG_SPENT_MONTHS = 3
_EPS = 0.005

YM = tuple[int, int]


# --- Month helpers -----------------------------------------------------------------------------


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    if month < 1 or month > 12:
        raise ValueError("month must be 1..12")
    ny, nm = _next_month(year, month)
    return date(year, month, 1), date.fromordinal(date(ny, nm, 1).toordinal() - 1)


def _prev_month(year: int, month: int) -> YM:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _next_month(year: int, month: int) -> YM:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _months_between(start: YM, end: YM) -> list[YM]:
    out: list[YM] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur = _next_month(*cur)
    return out


def _shift_months(ym: YM, n: int) -> YM:
    idx = ym[0] * 12 + (ym[1] - 1) + n
    return (idx // 12, idx % 12 + 1)


def _today() -> date:
    return date.today()


# --- Settings ----------------------------------------------------------------------------------


def _settings_row(session: Session) -> BudgetSetting:
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row:
        row = BudgetSetting(id=1, rollover_mode="strict")
        session.add(row)
        session.flush()
    return row


def get_budget_start_month(session: Session) -> YM | None:
    """First month that participates in the budget; None = not chosen yet."""
    row = session.query(BudgetSetting).order_by(BudgetSetting.id.asc()).first()
    if not row or row.budget_start_year is None or row.budget_start_month is None:
        return None
    yi, mi = int(row.budget_start_year), int(row.budget_start_month)
    if mi < 1 or mi > 12:
        return None
    return (yi, mi)


def set_budget_start_month(session: Session, year: int | None, month: int | None) -> YM | None:
    """Set or clear the first budget month. Both None clears; both must be int together otherwise."""
    if (year is None) != (month is None):
        raise ValueError("budget_start_year and budget_start_month must both be set or both omitted")
    if month is not None and (int(month) < 1 or int(month) > 12):
        raise ValueError("budget_start_month must be 1..12")
    row = _settings_row(session)
    row.budget_start_year = None if year is None else int(year)
    row.budget_start_month = None if month is None else int(month)
    session.flush()
    return get_budget_start_month(session)


def get_rollover_mode(session: Session) -> str:
    row = _settings_row(session)
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
    _settings_row(session).rollover_mode = normalized
    session.flush()
    return normalized


# --- Envelopes (budget categories) -------------------------------------------------------------


def _income_category_id(session: Session) -> int | None:
    cid = session.query(Category.id).filter(Category.name == INCOME_CATEGORY_NAME).scalar()
    return int(cid) if cid is not None else None


def _is_envelope(bc: BudgetCategory, income_cid: int | None) -> bool:
    """Visible, assignable envelope: not a legacy system row and not mapped to Income."""
    if bc.is_system:
        return False
    return income_cid is None or bc.txn_category_id is None or int(bc.txn_category_id) != income_cid


def _envelopes(session: Session) -> list[BudgetCategory]:
    income_cid = _income_category_id(session)
    return [
        bc
        for bc in session.query(BudgetCategory).order_by(BudgetCategory.name.asc()).all()
        if _is_envelope(bc, income_cid)
    ]


def _ensure_seeded_envelopes(session: Session) -> None:
    """First run only: one envelope per (non-Income) transaction category. Never re-creates deleted ones."""
    if session.query(BudgetCategory).filter(BudgetCategory.is_system.is_(False)).count() > 0:
        return
    income_cid = _income_category_id(session)
    for c in session.query(Category).order_by(Category.id.asc()).all():
        if income_cid is not None and int(c.id) == income_cid:
            continue
        session.add(BudgetCategory(name=str(c.name), txn_category_id=int(c.id)))
    session.flush()


def _envelope_out(bc: BudgetCategory, names: dict[str, dict[int, str]]) -> dict[str, object]:
    tcid = int(bc.txn_category_id) if bc.txn_category_id is not None else None
    tsid = int(bc.txn_subcategory_id) if bc.txn_subcategory_id is not None else None
    return {
        "id": int(bc.id),
        "name": str(bc.name),
        "is_system": bool(bc.is_system),
        "system_kind": str(bc.system_kind) if bc.system_kind else None,
        "linked_account_id": int(bc.linked_account_id) if bc.linked_account_id is not None else None,
        "txn_category_id": tcid,
        "txn_subcategory_id": tsid,
        "txn_category_name": names["cat"].get(tcid) if tcid is not None else None,
        "txn_subcategory_name": names["sub"].get(tsid) if tsid is not None else None,
        "monthly_target": float(bc.monthly_target) if bc.monthly_target is not None else None,
    }


def _category_names(session: Session) -> dict[str, dict[int, str]]:
    return {
        "cat": {int(i): str(n) for i, n in session.query(Category.id, Category.name).all()},
        "sub": {int(i): str(n) for i, n in session.query(Subcategory.id, Subcategory.name).all()},
    }


def list_budget_categories(session: Session) -> list[dict[str, object]]:
    _ensure_seeded_envelopes(session)
    names = _category_names(session)
    return [_envelope_out(bc, names) for bc in _envelopes(session)]


def _get_budget_category_out(session: Session, budget_category_id: int) -> dict[str, object]:
    bc = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not bc:
        raise ValueError("Budget category not found")
    return _envelope_out(bc, _category_names(session))


def _validate_mapping(
    session: Session,
    *,
    txn_category_id: int | None,
    txn_subcategory_id: int | None,
    exclude_id: int | None = None,
) -> None:
    if txn_subcategory_id is not None and txn_category_id is None:
        raise ValueError("Pick a transaction category before a subcategory")
    if txn_category_id is not None:
        if txn_category_id == _income_category_id(session):
            raise ValueError("Income is not an envelope; it flows into Ready to Assign automatically")
        if session.query(Category.id).filter(Category.id == int(txn_category_id)).scalar() is None:
            raise ValueError("Transaction category not found")
    if txn_subcategory_id is not None:
        parent = session.query(Subcategory.category_id).filter(Subcategory.id == int(txn_subcategory_id)).scalar()
        if parent is None or int(parent) != int(txn_category_id or -1):
            raise ValueError("Subcategory does not belong to that category")
    if txn_category_id is None:
        return
    # Two envelopes tracking the exact same transactions would double count spending.
    clash = session.query(BudgetCategory).filter(
        BudgetCategory.is_system.is_(False),
        BudgetCategory.txn_category_id == int(txn_category_id),
        BudgetCategory.txn_subcategory_id.is_(None)
        if txn_subcategory_id is None
        else BudgetCategory.txn_subcategory_id == int(txn_subcategory_id),
    )
    if exclude_id is not None:
        clash = clash.filter(BudgetCategory.id != int(exclude_id))
    other = clash.first()
    if other is not None:
        raise ValueError(f"'{other.name}' already tracks those transactions")


def _clean_target(target: float | None) -> float | None:
    if target is None:
        return None
    t = round(float(target), 2)
    if t < 0:
        raise ValueError("Monthly target cannot be negative")
    return t or None


def create_budget_category(
    session: Session,
    *,
    name: str,
    txn_category_id: int | None = None,
    txn_subcategory_id: int | None = None,
    monthly_target: float | None = None,
) -> dict[str, object]:
    _ensure_seeded_envelopes(session)  # otherwise this envelope would suppress first-run seeding
    clean = name.strip()
    if not clean:
        raise ValueError("name is required")
    if session.query(BudgetCategory).filter(func.lower(BudgetCategory.name) == clean.lower()).first():
        raise ValueError("A budget category with that name already exists")
    _validate_mapping(session, txn_category_id=txn_category_id, txn_subcategory_id=txn_subcategory_id)
    row = BudgetCategory(
        name=clean,
        is_system=False,
        system_kind=None,
        txn_category_id=txn_category_id,
        txn_subcategory_id=txn_subcategory_id,
        monthly_target=_clean_target(monthly_target),
    )
    session.add(row)
    session.flush()
    return _get_budget_category_out(session, int(row.id))


_UNSET = object()


def update_budget_category(
    session: Session,
    budget_category_id: int,
    *,
    name: str | None = None,
    txn_category_id: int | None | object = _UNSET,
    txn_subcategory_id: int | None | object = _UNSET,
    monthly_target: float | None | object = _UNSET,
) -> dict[str, object]:
    """Only fields that are passed change (pass None explicitly to clear a mapping or target)."""
    row = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not row:
        raise ValueError("Budget category not found")
    if row.is_system:
        raise ValueError("System budget categories cannot be edited")
    if name is not None:
        clean = name.strip()
        if not clean:
            raise ValueError("name cannot be empty")
        dup = (
            session.query(BudgetCategory)
            .filter(func.lower(BudgetCategory.name) == clean.lower(), BudgetCategory.id != row.id)
            .first()
        )
        if dup:
            raise ValueError("A budget category with that name already exists")
        row.name = clean
    if txn_category_id is not _UNSET or txn_subcategory_id is not _UNSET:
        new_cat = row.txn_category_id if txn_category_id is _UNSET else txn_category_id
        new_sub = row.txn_subcategory_id if txn_subcategory_id is _UNSET else txn_subcategory_id
        if txn_category_id is not _UNSET and txn_subcategory_id is _UNSET and new_cat != row.txn_category_id:
            new_sub = None  # A subcategory of the previous category would be a mismatched pair.
        _validate_mapping(session, txn_category_id=new_cat, txn_subcategory_id=new_sub, exclude_id=int(row.id))  # type: ignore[arg-type]
        row.txn_category_id = new_cat
        row.txn_subcategory_id = new_sub
    if monthly_target is not _UNSET:
        row.monthly_target = _clean_target(monthly_target)  # type: ignore[arg-type]
    session.flush()
    return _get_budget_category_out(session, int(row.id))


def delete_budget_category(session: Session, budget_category_id: int) -> None:
    row = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not row:
        raise ValueError("Budget category not found")
    if row.is_system:
        raise ValueError("System budget categories cannot be deleted")
    session.query(CategoryBudget).filter(CategoryBudget.budget_category_id == int(row.id)).delete(
        synchronize_session=False
    )
    session.delete(row)
    session.flush()


# --- Ledger inputs -----------------------------------------------------------------------------


def _budget_accounts(session: Session) -> list[Account]:
    return session.query(Account).filter(Account.is_budget_account.is_(True)).order_by(Account.name.asc()).all()


def _txn_rows(
    session: Session, account_ids: list[int], start: date, end: date
) -> list[tuple[date, int | None, int | None, float]]:
    """(date, category, subcategory, amount) for every non-transfer leg on budget accounts, split-aware."""
    if not account_ids:
        return []
    split_q = (
        session.query(
            Transaction.date.label("date"),
            TransactionSplit.category_id.label("category_id"),
            TransactionSplit.subcategory_id.label("subcategory_id"),
            TransactionSplit.amount.label("amount"),
        )
        .select_from(TransactionSplit)
        .join(TransactionSplit.transaction)
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.account_id.in_(account_ids))
        .filter(Transaction.date >= start, Transaction.date <= end)
    )
    base_q = (
        session.query(
            Transaction.date.label("date"),
            Transaction.category_id.label("category_id"),
            Transaction.subcategory_id.label("subcategory_id"),
            Transaction.amount.label("amount"),
        )
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.account_id.in_(account_ids))
        .filter(Transaction.date >= start, Transaction.date <= end)
        .filter(~Transaction.splits.any())
    )
    combined = union_all(split_q, base_q).subquery("zbb_txn_rows")
    return [
        (
            d if isinstance(d, date) else date.fromisoformat(str(d)[:10]),
            int(c) if c is not None else None,
            int(s) if s is not None else None,
            float(a or 0.0),
        )
        for d, c, s, a in session.query(
            combined.c.date, combined.c.category_id, combined.c.subcategory_id, combined.c.amount
        ).all()
    ]


@dataclass
class _MonthLedger:
    activity: dict[int, float]
    income: float = 0.0
    unbudgeted: dict[int | None, float] | None = None
    uncategorized_count: int = 0


def _ledger_by_month(
    session: Session, envelopes: list[BudgetCategory], account_ids: list[int], start: YM, end: YM
) -> dict[YM, _MonthLedger]:
    by_sub: dict[tuple[int, int], int] = {}
    by_cat: dict[int, int] = {}
    for bc in sorted(envelopes, key=lambda b: int(b.id)):
        if bc.txn_category_id is None:
            continue
        cid = int(bc.txn_category_id)
        if bc.txn_subcategory_id is not None:
            by_sub.setdefault((cid, int(bc.txn_subcategory_id)), int(bc.id))
        else:
            by_cat.setdefault(cid, int(bc.id))
    income_cid = _income_category_id(session)
    other_cid = session.query(Category.id).filter(Category.name == "Other").scalar()
    uncategorized_sid = (
        session.query(Subcategory.id)
        .filter(Subcategory.category_id == other_cid, Subcategory.name == "Uncategorized")
        .scalar()
        if other_cid is not None
        else None
    )

    out: dict[YM, _MonthLedger] = defaultdict(lambda: _MonthLedger(activity=defaultdict(float), unbudgeted=defaultdict(float)))
    for d, cid, sid, amount in _txn_rows(session, account_ids, _month_bounds(*start)[0], _month_bounds(*end)[1]):
        led = out[(d.year, d.month)]
        if cid is None or (sid is not None and sid == uncategorized_sid):
            led.uncategorized_count += 1
        if cid is not None and cid == income_cid:
            led.income += amount
            continue
        env = by_sub.get((cid, sid)) if cid is not None and sid is not None else None
        if env is None and cid is not None:
            env = by_cat.get(cid)
        if env is None:
            led.unbudgeted[cid] += amount  # type: ignore[index]
        else:
            led.activity[env] += amount
    return out


def _assigned_by_month(session: Session, start: YM, end: YM) -> dict[YM, dict[int, float]]:
    rows = (
        session.query(BudgetPeriod.year, BudgetPeriod.month, CategoryBudget.budget_category_id, CategoryBudget.assigned)
        .join(CategoryBudget, CategoryBudget.budget_period_id == BudgetPeriod.id)
        .filter(CategoryBudget.budget_category_id.isnot(None))
        .all()
    )
    out: dict[YM, dict[int, float]] = defaultdict(dict)
    for y, m, bcid, assigned in rows:
        ym = (int(y), int(m))
        if start <= ym <= end:
            out[ym][int(bcid)] = float(assigned or 0.0)
    return out


def _last_assigned_month(session: Session) -> YM | None:
    row = (
        session.query(BudgetPeriod.year, BudgetPeriod.month)
        .join(CategoryBudget, CategoryBudget.budget_period_id == BudgetPeriod.id)
        .filter(func.abs(CategoryBudget.assigned) > _EPS)
        .order_by(BudgetPeriod.year.desc(), BudgetPeriod.month.desc())
        .first()
    )
    return (int(row[0]), int(row[1])) if row else None


def _first_assigned_month(session: Session) -> YM | None:
    row = (
        session.query(BudgetPeriod.year, BudgetPeriod.month)
        .join(CategoryBudget, CategoryBudget.budget_period_id == BudgetPeriod.id)
        .filter(func.abs(CategoryBudget.assigned) > _EPS)
        .order_by(BudgetPeriod.year.asc(), BudgetPeriod.month.asc())
        .first()
    )
    return (int(row[0]), int(row[1])) if row else None


def _effective_start(session: Session, today: YM) -> tuple[YM, bool]:
    """(start month, whether the user explicitly chose it)."""
    chosen = get_budget_start_month(session)
    if chosen is not None:
        return chosen, True
    return min(_first_assigned_month(session) or today, today), False


# --- Month overview ----------------------------------------------------------------------------


def get_month_overview(session: Session, year: int, month: int) -> dict[str, object]:
    _month_bounds(year, month)  # validates month
    _ensure_seeded_envelopes(session)
    today = _today()
    today_ym: YM = (today.year, today.month)
    view: YM = (year, month)
    mode = get_rollover_mode(session)
    start, start_chosen = _effective_start(session, today_ym)
    before_start = view < start

    envelopes = _envelopes(session)
    env_ids = [int(b.id) for b in envelopes]
    accounts = _budget_accounts(session)
    balances = display_balances_by_account(session)
    account_ids = [int(a.id) for a in accounts]
    cash_on_budget = sum(float(balances.get(int(a.id), 0.0)) for a in accounts)

    # RTA horizon: the latest month whose assignments or spending count today.
    horizon = max(today_ym, _last_assigned_month(session) or start, start)
    compute_end = max(horizon, view)
    history_start = min(start, _shift_months(view, -AVG_SPENT_MONTHS))
    ledger = _ledger_by_month(session, envelopes, account_ids, history_start, compute_end)
    assigned = _assigned_by_month(session, start, compute_end)

    # Walk months from the start, carrying each envelope's Available forward.
    per_month: dict[YM, dict[int, dict[str, float]]] = {}
    reset_overspending: dict[YM, float] = {}
    prev_available = {bcid: 0.0 for bcid in env_ids}
    for ym in _months_between(start, compute_end):
        led = ledger.get(ym)
        rows: dict[int, dict[str, float]] = {}
        reset = 0.0
        for bcid in env_ids:
            carry = prev_available[bcid]
            if mode == "flexible" and carry < 0:
                reset += -carry
                carry = 0.0
            a = assigned.get(ym, {}).get(bcid, 0.0)
            act = float(led.activity.get(bcid, 0.0)) if led else 0.0
            rows[bcid] = {"rollover": carry, "assigned": a, "activity": act, "available": carry + a + act}
            prev_available[bcid] = carry + a + act
        per_month[ym] = rows
        reset_overspending[ym] = reset

    rta = cash_on_budget - sum(r["available"] for r in per_month.get(horizon, {}).values())

    names = _category_names(session)
    view_rows = per_month.get(view, {})
    prev_assigned = assigned.get(_prev_month(*view), {}) if not before_start else {}
    out_rows: list[dict[str, object]] = []
    for bc in envelopes:
        bcid = int(bc.id)
        r = view_rows.get(bcid, {"rollover": 0.0, "assigned": 0.0, "activity": 0.0, "available": 0.0})
        spent_hist = [
            -float(ledger[ym].activity.get(bcid, 0.0)) if ym in ledger else 0.0
            for ym in (_shift_months(view, -k) for k in range(1, AVG_SPENT_MONTHS + 1))
        ]
        target = float(bc.monthly_target) if bc.monthly_target is not None else None
        out_rows.append(
            {
                **_envelope_out(bc, names),
                "category_id": bcid,
                "category_name": str(bc.name),
                "rollover": r["rollover"],
                "assigned": r["assigned"],
                "activity": r["activity"],
                "available": r["available"],
                "target": target,
                "underfunded": max(0.0, (target or 0.0) - r["assigned"]) if not before_start else 0.0,
                "last_month_assigned": float(prev_assigned.get(bcid, 0.0)),
                "avg_spent": max(0.0, sum(spent_hist) / AVG_SPENT_MONTHS),
            }
        )

    led = ledger.get(view)
    unbudgeted = [
        {
            "txn_category_id": cid,
            "txn_category_name": names["cat"].get(cid, "Uncategorized") if cid is not None else "Uncategorized",
            "amount": amt,
        }
        for cid, amt in sorted((led.unbudgeted or {}).items(), key=lambda kv: kv[1])
        if abs(amt) > _EPS
    ] if led and not before_start else []
    overspent = [r for r in out_rows if float(r["available"]) < -_EPS]  # type: ignore[arg-type]

    return {
        "year": year,
        "month": month,
        "rollover_mode": mode,
        "budget_start_year": start[0],
        "budget_start_month": start[1],
        "budget_start_is_set": start_chosen,
        "is_before_budget_start": before_start,
        "horizon_year": horizon[0],
        "horizon_month": horizon[1],
        "ready_to_assign": rta,
        "cash_on_budget": cash_on_budget,
        "accounts": [
            {"id": int(a.id), "name": str(a.name), "type": str(a.type), "balance": float(balances.get(int(a.id), 0.0))}
            for a in accounts
        ],
        "totals": {
            "assigned": sum(float(r["assigned"]) for r in out_rows),  # type: ignore[arg-type]
            "activity": sum(float(r["activity"]) for r in out_rows),  # type: ignore[arg-type]
            "available": sum(float(r["available"]) for r in out_rows),  # type: ignore[arg-type]
            "income": float(led.income) if led and not before_start else 0.0,
            "unbudgeted": sum(float(u["amount"]) for u in unbudgeted),  # type: ignore[arg-type]
            "overspent": sum(-float(r["available"]) for r in overspent),  # type: ignore[arg-type]
            "overspent_count": len(overspent),
            "underfunded": sum(float(r["underfunded"]) for r in out_rows),  # type: ignore[arg-type]
            "reset_overspending": reset_overspending.get(view, 0.0),
            "uncategorized_count": led.uncategorized_count if led and not before_start else 0,
        },
        "unbudgeted": unbudgeted,
        "rows": out_rows,
    }


# --- Mutations ---------------------------------------------------------------------------------


def _assert_budget_month_active(session: Session, year: int, month: int) -> None:
    _month_bounds(year, month)
    today = _today()
    start, _ = _effective_start(session, (today.year, today.month))
    if (year, month) < start:
        raise ValueError("This month is before your budget start month.")


def _get_or_create_row(session: Session, year: int, month: int, budget_category_id: int) -> CategoryBudget:
    bc = session.query(BudgetCategory).filter(BudgetCategory.id == int(budget_category_id)).first()
    if not bc or not _is_envelope(bc, _income_category_id(session)):
        raise ValueError("Budget category not found")
    period = session.query(BudgetPeriod).filter(BudgetPeriod.year == year, BudgetPeriod.month == month).first()
    if not period:
        period = BudgetPeriod(year=year, month=month, rta_snapshot=0.0)
        session.add(period)
        session.flush()
    row = (
        session.query(CategoryBudget)
        .filter(CategoryBudget.budget_period_id == period.id, CategoryBudget.budget_category_id == int(bc.id))
        .first()
    )
    if not row:
        # category_id is a legacy NOT NULL column; any valid category id satisfies it.
        legacy_cid = bc.txn_category_id or session.query(Category.id).order_by(Category.id.asc()).scalar()
        if legacy_cid is None:
            raise ValueError("At least one transaction category is required")
        row = CategoryBudget(
            category_id=int(legacy_cid),
            budget_category_id=int(bc.id),
            budget_period_id=int(period.id),
            assigned=0.0,
            activity=0.0,
        )
        session.add(row)
        session.flush()
    return row


def assign_amount(session: Session, year: int, month: int, category_id: int, assigned: float) -> dict[str, object]:
    """Set Assigned for one envelope. Over-assigning is allowed; Ready to Assign just goes negative (shown red)."""
    _assert_budget_month_active(session, year, month)
    row = _get_or_create_row(session, year, month, category_id)
    row.assigned = round(float(assigned), 2)
    session.flush()
    return get_month_overview(session, year, month)


def move_money(
    session: Session,
    year: int,
    month: int,
    *,
    from_category_id: int | None,
    to_category_id: int | None,
    amount: float,
) -> dict[str, object]:
    """Move Assigned between envelopes; None on either side means Ready to Assign."""
    _assert_budget_month_active(session, year, month)
    if from_category_id is None and to_category_id is None:
        raise ValueError("Pick at least one category")
    if from_category_id == to_category_id:
        raise ValueError("Pick two different places to move money between")
    amt = round(float(amount), 2)
    if amt <= 0:
        raise ValueError("Amount must be positive")
    if from_category_id is not None:
        src = _get_or_create_row(session, year, month, from_category_id)
        src.assigned = round(float(src.assigned) - amt, 2)
    if to_category_id is not None:
        dst = _get_or_create_row(session, year, month, to_category_id)
        dst.assigned = round(float(dst.assigned) + amt, 2)
    session.flush()
    return get_month_overview(session, year, month)


def quick_assign(
    session: Session,
    year: int,
    month: int,
    *,
    strategy: str,
    category_ids: Iterable[int] | None = None,
) -> dict[str, object]:
    """
    Bulk-set Assigned for the month (YNAB's "Auto-Assign"):

    * ``targets``   — raise Assigned up to each envelope's monthly target
    * ``last_month`` — copy last month's Assigned
    * ``avg_spent`` — assign the average of the last three months' spending
    * ``clear``     — reset Assigned to $0

    Increases are funded in name order and stop when Ready to Assign runs out; decreases always apply.
    """
    if strategy not in QUICK_ASSIGN_STRATEGIES:
        raise ValueError(f"strategy must be one of {sorted(QUICK_ASSIGN_STRATEGIES)}")
    _assert_budget_month_active(session, year, month)
    overview = get_month_overview(session, year, month)
    only = {int(c) for c in category_ids} if category_ids is not None else None
    budget_left = max(0.0, float(overview["ready_to_assign"]))  # type: ignore[arg-type]
    for r in overview["rows"]:  # type: ignore[union-attr]
        bcid = int(r["category_id"])
        if only is not None and bcid not in only:
            continue
        current = float(r["assigned"])
        if strategy == "targets":
            if r["target"] is None:
                continue
            desired = max(current, float(r["target"]))
        elif strategy == "last_month":
            desired = float(r["last_month_assigned"])
        elif strategy == "avg_spent":
            desired = round(float(r["avg_spent"]), 2)
        else:
            desired = 0.0
        delta = round(desired - current, 2)
        if delta > 0:
            delta = round(min(delta, budget_left), 2)
            budget_left -= delta
        else:
            budget_left -= delta  # freeing money makes it available to later envelopes
        if abs(delta) < _EPS:
            continue
        row = _get_or_create_row(session, year, month, bcid)
        row.assigned = round(current + delta, 2)
    session.flush()
    return get_month_overview(session, year, month)
