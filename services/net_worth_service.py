from __future__ import annotations

import bisect
import hashlib
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import (
    Account,
    InvestmentSyncSnapshot,
    InvestmentTxnClassification,
    NetWorthDaily,
    NetWorthSnapshot,
    Transaction,
)
from services.account_service import display_balances_by_account
from utils.timestamps import local_date

# Investment-account activity that moves money into or out of the account. Buys,
# sells, dividends etc. only reshuffle value that the market snapshots already show.
_EXTERNAL_FLOW_KINDS = ("deposit", "withdrawal")


def capture_net_worth_snapshot(
    session: Session,
    *,
    captured_at: datetime,
    simplefin_sync_run_id: int | None = None,
) -> NetWorthSnapshot:
    accounts = session.query(Account).all()
    display_balances = display_balances_by_account(session)
    balances: list[tuple[float, str]] = [
        (display_balances.get(int(account.id), 0.0), str(account.currency or "USD"))
        for account in accounts
    ]

    currencies = {currency for _, currency in balances}
    mixed_currencies = len(currencies) > 1
    total_value = sum(amount for amount, _currency in balances)
    snapshot = NetWorthSnapshot(
        captured_at=captured_at,
        simplefin_sync_run_id=simplefin_sync_run_id,
        total_value=float(total_value),
        currency=(next(iter(currencies)) if currencies else "USD"),
        mixed_currencies=mixed_currencies,
        accounts_count=len(balances),
    )
    session.add(snapshot)
    return snapshot


class _Cumulative:
    """Running total of dated amounts, queryable as "sum of everything on or before day"."""

    def __init__(self, dated_amounts: list[tuple[date, float]]) -> None:
        dated_amounts.sort(key=lambda r: r[0])
        self._days: list[date] = []
        self._totals: list[float] = []
        running = 0.0
        for day, amount in dated_amounts:
            running += amount
            if self._days and self._days[-1] == day:
                self._totals[-1] = running
            else:
                self._days.append(day)
                self._totals.append(running)

    def through(self, day: date) -> float:
        i = bisect.bisect_right(self._days, day)
        return self._totals[i - 1] if i else 0.0


@dataclass
class _AccountModel:
    """
    Balance on any day = anchor value + (cumulative flows through day - cumulative flows through anchor day).

    Cash and credit accounts anchor on the bank-reported balance (or start from zero
    when there is none) and move with every transaction. Investment accounts anchor
    on the latest market snapshot at or before the day (the earliest one for days
    before any) and move only with money transferred in or out, since their value is
    driven by prices rather than by the ledger.
    """

    currency: str
    flows: _Cumulative
    anchors: list[tuple[date, float]]  # sorted by day; empty => balance is the running sum of flows
    # From the latest anchor on, report it unchanged. Matches how the app shows a
    # reported balance as the current balance (see display_balances_by_account).
    hold_latest_anchor: bool = False

    def balance_on(self, day: date) -> float:
        if not self.anchors:
            return self.flows.through(day)
        if self.hold_latest_anchor and day >= self.anchors[-1][0]:
            return self.anchors[-1][1]
        i = bisect.bisect_right(self.anchors, day, key=lambda a: a[0]) - 1
        anchor_day, anchor_value = self.anchors[max(i, 0)]
        return anchor_value + self.flows.through(day) - self.flows.through(anchor_day)


def _build_account_models(session: Session) -> list[_AccountModel]:
    accounts = session.query(Account).all()
    investment_ids = {int(a.id) for a in accounts if a.type == "investment"}

    txns_by_account: dict[int, list[tuple[date, float]]] = defaultdict(list)
    rows = (
        session.query(
            Transaction.account_id,
            Transaction.date,
            Transaction.amount,
            Transaction.is_transfer,
            Transaction.transfer_group_id,
            InvestmentTxnClassification.kind,
        )
        .outerjoin(InvestmentTxnClassification, InvestmentTxnClassification.transaction_id == Transaction.id)
        .all()
    )
    # Money in transit between the user's own accounts is still theirs: date every
    # leg of a linked transfer on its earliest leg so the pair nets to zero each day.
    transfer_start: dict[int, date] = {}
    for _aid, day, _amt, _is_transfer, group_id, _kind in rows:
        if group_id is not None:
            transfer_start[group_id] = min(day, transfer_start.get(group_id, day))
    for account_id, day, amount, is_transfer, group_id, kind in rows:
        account_id = int(account_id)
        if account_id in investment_ids and not (is_transfer or kind in _EXTERNAL_FLOW_KINDS):
            continue
        txns_by_account[account_id].append((transfer_start.get(group_id, day), float(amount)))

    snapshots_by_account: dict[int, dict[date, float]] = defaultdict(dict)
    for account_id, captured_at, value in (
        session.query(
            InvestmentSyncSnapshot.account_id,
            InvestmentSyncSnapshot.captured_at,
            InvestmentSyncSnapshot.reported_balance,
        )
        .order_by(InvestmentSyncSnapshot.captured_at.asc())
        .all()
    ):
        # Later snapshots on the same day overwrite earlier ones.
        snapshots_by_account[int(account_id)][local_date(captured_at)] = float(value)

    models: list[_AccountModel] = []
    for account in accounts:
        account_id = int(account.id)
        anchors: dict[date, float] = {}
        if account_id in investment_ids:
            anchors.update(snapshots_by_account.get(account_id, {}))
        if account.reported_balance is not None:
            reported_day = local_date(account.reported_balance_at) if account.reported_balance_at else date.today()
            if not anchors or reported_day >= max(anchors):
                anchors[reported_day] = float(account.reported_balance)
        models.append(
            _AccountModel(
                currency=str(account.currency or "USD"),
                flows=_Cumulative(txns_by_account.get(account_id, [])),
                anchors=sorted(anchors.items()),
                hold_latest_anchor=account_id not in investment_ids,
            )
        )
    return models


def _source_signature(session: Session, today: date) -> str:
    """
    Fingerprint of everything daily net worth is derived from. Any change to
    transactions, balances, snapshots or investment classifications (or a new day)
    changes it, which invalidates stored rows.
    """
    txn = session.query(
        func.count(Transaction.id),
        func.max(Transaction.id),
        func.total(Transaction.amount),
        func.total(Transaction.amount * func.julianday(Transaction.date)),
        func.total(Transaction.amount * Transaction.account_id),
        func.total(Transaction.amount * Transaction.is_transfer),
        func.total(Transaction.amount * Transaction.transfer_group_id),
    ).one()
    snaps = session.query(
        func.count(InvestmentSyncSnapshot.id),
        func.max(InvestmentSyncSnapshot.id),
        func.total(InvestmentSyncSnapshot.reported_balance),
    ).one()
    flows = (
        session.query(func.count(InvestmentTxnClassification.id), func.total(InvestmentTxnClassification.transaction_id))
        .filter(InvestmentTxnClassification.kind.in_(_EXTERNAL_FLOW_KINDS))
        .one()
    )
    accounts = session.query(
        Account.id, Account.type, Account.currency, Account.reported_balance, Account.reported_balance_at
    ).order_by(Account.id).all()
    parts = [today.isoformat(), repr(tuple(txn)), repr(tuple(snaps)), repr(tuple(flows)), repr([tuple(a) for a in accounts])]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def _earliest_data_day(session: Session) -> date | None:
    first_txn = session.query(func.min(Transaction.date)).scalar()
    first_snap = session.query(func.min(InvestmentSyncSnapshot.captured_at)).scalar()
    candidates = [d for d in (first_txn, local_date(first_snap) if first_snap else None) if d is not None]
    return min(candidates) if candidates else None


def compute_daily_net_worth(session: Session, start: date, end: date) -> list[NetWorthDaily]:
    """Unsaved NetWorthDaily rows for every day in [start, end]."""
    models = _build_account_models(session)
    currencies = {m.currency for m in models}
    currency = next(iter(currencies)) if len(currencies) == 1 else "USD"
    rows: list[NetWorthDaily] = []
    day = start
    while day <= end:
        rows.append(
            NetWorthDaily(
                day=day,
                total_value=round(sum(m.balance_on(day) for m in models), 2),
                currency=currency,
                mixed_currencies=len(currencies) > 1,
                accounts_count=len(models),
            )
        )
        day += timedelta(days=1)
    return rows


def net_worth_history(
    session: Session,
    *,
    start: date,
    end: date,
) -> list[dict[str, object]]:
    """
    One net worth point per day in [start, end], clamped to today and to the first day
    with any data. Stored rows are reused while their source data is unchanged; otherwise
    the range is recomputed and staged for storage (the caller commits).
    """
    today = date.today()
    earliest = _earliest_data_day(session)
    if earliest is None:
        return []
    start = max(start, earliest)
    end = min(end, today)
    if start > end:
        return []

    signature = _source_signature(session, today)
    stored = (
        session.query(NetWorthDaily)
        .filter(NetWorthDaily.day >= start, NetWorthDaily.day <= end)
        .order_by(NetWorthDaily.day.asc())
        .all()
    )
    expected_days = (end - start).days + 1
    if len(stored) != expected_days or any(r.source_signature != signature for r in stored):
        session.query(NetWorthDaily).filter(NetWorthDaily.day >= start, NetWorthDaily.day <= end).delete(
            synchronize_session=False
        )
        stored = compute_daily_net_worth(session, start, end)
        for row in stored:
            row.source_signature = signature
        session.add_all(stored)
        session.flush()

    return [
        {
            "date": row.day.isoformat(),
            "total_value": float(row.total_value),
            "currency": str(row.currency or "USD"),
            "mixed_currencies": bool(row.mixed_currencies),
            "accounts_count": int(row.accounts_count or 0),
        }
        for row in stored
    ]
