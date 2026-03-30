from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import Session

from db.models import Account, NetWorthSnapshot
from services.account_service import account_display_balance


def capture_net_worth_snapshot(
    session: Session,
    *,
    captured_at: datetime,
    simplefin_sync_run_id: int | None = None,
) -> NetWorthSnapshot:
    accounts = session.query(Account).all()
    balances: list[tuple[float, str]] = []
    for account in accounts:
        display_balance, _ = account_display_balance(session, account)
        balances.append((float(display_balance), str(account.currency or "USD")))

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


def net_worth_history(
    session: Session,
    *,
    start: date,
    end: date,
) -> list[dict[str, object]]:
    start_dt = datetime.combine(start, time.min)
    end_dt = datetime.combine(end + timedelta(days=1), time.min)
    rows = (
        session.query(NetWorthSnapshot)
        .filter(NetWorthSnapshot.captured_at >= start_dt, NetWorthSnapshot.captured_at < end_dt)
        .order_by(NetWorthSnapshot.captured_at.asc())
        .all()
    )
    return [
        {
            "captured_at": row.captured_at.isoformat(),
            "total_value": float(row.total_value),
            "currency": str(row.currency or "USD"),
            "mixed_currencies": bool(row.mixed_currencies),
            "accounts_count": int(row.accounts_count or 0),
        }
        for row in rows
    ]
