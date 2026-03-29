"""
Persist custodian holdings and portfolio value snapshots after SimpleFIN sync.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from db.models import InvestmentHoldingSnapshot, InvestmentSyncSnapshot

if TYPE_CHECKING:
    from db.models import Account
    from services.simplefin_client import SFINHolding


def _safe_float(s: str) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def record_investment_snapshot(
    session: Session,
    account: Account,
    holdings: list[SFINHolding],
    *,
    reported_balance: float,
    currency: str,
    sync_run_id: int | None,
    captured_at: datetime,
) -> InvestmentSyncSnapshot:
    """
    Insert one InvestmentSyncSnapshot and child holding rows.

    Cash is estimated as reported_balance - sum(holding market_value), assuming
    balance is total account equity (common for brokerages).
    """
    positions_value = sum(_safe_float(h.market_value) for h in holdings)
    cash_balance = reported_balance - positions_value

    snap = InvestmentSyncSnapshot(
        account_id=account.id,
        captured_at=captured_at,
        simplefin_sync_run_id=sync_run_id,
        reported_balance=reported_balance,
        positions_value=positions_value,
        cash_balance=cash_balance,
        currency=currency or "USD",
    )
    session.add(snap)
    session.flush()

    for h in holdings:
        session.add(
            InvestmentHoldingSnapshot(
                snapshot_id=snap.id,
                external_holding_id=h.id,
                symbol=h.symbol,
                description=h.description or None,
                shares=_safe_float(h.shares),
                market_value=_safe_float(h.market_value),
                cost_basis=_safe_float(h.cost_basis) if h.cost_basis is not None else None,
                purchase_price=_safe_float(h.purchase_price) if h.purchase_price is not None else None,
                currency=h.currency or currency or "USD",
            )
        )

    return snap
