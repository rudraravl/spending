"""
Account-level helpers (balances, lookups).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import Account, Transaction

# Used by transfer matching to identify asset-side accounts.
ASSET_ACCOUNT_TYPES = frozenset({"checking", "savings", "cash", "investment"})


def account_ledger_balance(session: Session, account_id: int) -> float:
    """
    Net balance for the account: sum of all transaction amounts, including transfer legs.

    Transfers are stored as paired rows (negative on source, positive on destination), so
    the running sum matches each account's actual ledger.
    """
    total = (
        session.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(Transaction.account_id == account_id)
        .scalar()
    )
    return float(total) if total is not None else 0.0


def account_display_balance(session: Session, account: Account) -> tuple[float, float]:
    """
    Returns (display_balance, ledger_balance).

    If reported_balance is set (e.g. bank/provider sync), display_balance is that
    value; otherwise both match the ledger sum.
    """
    ledger = account_ledger_balance(session, account.id)
    if account.reported_balance is not None:
        return (float(account.reported_balance), ledger)
    return (ledger, ledger)
