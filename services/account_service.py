"""
Account-level helpers (balances, lookups).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from db.models import (
    Account,
    Category,
    InvestmentSyncSnapshot,
    InvestmentTxnClassification,
    Subcategory,
    Transaction,
    TransferGroup,
)
from services.investment_txn_parser import reclassify_investment_transactions

# Used by transfer matching to identify asset-side accounts.
ASSET_ACCOUNT_TYPES = frozenset({"checking", "savings", "cash", "investment"})
ALLOWED_ACCOUNT_TYPES = frozenset({"checking", "savings", "credit", "cash", "investment"})


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


def reconcile_account_type_change(
    session: Session,
    account: Account,
    *,
    old_type: str,
    new_type: str,
) -> None:
    """
    Reconcile persisted derived data when an account type changes.

    - investment -> non-investment: remove investment transaction classifications.
    - non-investment -> investment:
      * backfill investment classifications for existing non-transfer rows
      * bootstrap a synthetic investment snapshot from the last reported balance,
        so historical investment views don't start empty.
    """
    if old_type == new_type:
        return

    if old_type == "investment" and new_type != "investment":
        txn_ids_subq = (
            session.query(Transaction.id)
            .filter(Transaction.account_id == account.id)
            .subquery()
        )
        (
            session.query(InvestmentTxnClassification)
            .filter(InvestmentTxnClassification.transaction_id.in_(txn_ids_subq))
            .delete(synchronize_session=False)
        )
        account.is_robinhood_crypto = False
        return

    if old_type != "investment" and new_type == "investment":
        reclassify_investment_transactions(session, account_id=account.id)
        has_snapshot = (
            session.query(InvestmentSyncSnapshot.id)
            .filter(InvestmentSyncSnapshot.account_id == account.id)
            .first()
            is not None
        )
        if not has_snapshot and account.reported_balance is not None:
            captured_at = account.reported_balance_at or datetime.now(timezone.utc)
            session.add(
                InvestmentSyncSnapshot(
                    account_id=account.id,
                    captured_at=captured_at,
                    simplefin_sync_run_id=None,
                    reported_balance=float(account.reported_balance),
                    positions_value=0.0,
                    cash_balance=float(account.reported_balance),
                    currency=str(account.currency or "USD"),
                )
            )


def _get_other_uncategorized_ids(session: Session) -> tuple[int, int]:
    other = session.query(Category).filter(Category.name == "Other").first()
    if not other:
        raise ValueError("Required category 'Other' not found")
    uncategorized = (
        session.query(Subcategory)
        .filter(Subcategory.category_id == other.id, Subcategory.name == "Uncategorized")
        .first()
    )
    if not uncategorized:
        raise ValueError("Required subcategory 'Uncategorized' not found under 'Other'")
    return int(other.id), int(uncategorized.id)


def delete_account(session: Session, account_id: int) -> None:
    """
    Delete an account and all its transactions.

    If any deleted-account transaction is part of a transfer group, the transfer link is
    removed first. The deleted account's legs are then removed with the account cascade,
    while surviving legs on other accounts remain as normal (non-transfer) transactions.
    """
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError("Account not found")

    other_cat_id, unc_sub_id = _get_other_uncategorized_ids(session)

    transfer_txns = (
        session.query(Transaction)
        .filter(
            Transaction.account_id == account_id,
            Transaction.is_transfer.is_(True),
            Transaction.transfer_group_id.isnot(None),
        )
        .all()
    )
    group_ids = {int(t.transfer_group_id) for t in transfer_txns if t.transfer_group_id is not None}
    if group_ids:
        related_txns = (
            session.query(Transaction)
            .filter(Transaction.transfer_group_id.in_(group_ids))
            .all()
        )
        for txn in related_txns:
            # Unlink all legs in impacted groups first; account rows are deleted below,
            # while non-deleted-account rows remain and become regular transactions.
            txn.is_transfer = False
            txn.transfer_group_id = None
            if txn.account_id != account_id:
                if txn.category_id is None:
                    txn.category_id = other_cat_id
                if txn.subcategory_id is None:
                    txn.subcategory_id = unc_sub_id

        for group_id in group_ids:
            group = session.query(TransferGroup).filter(TransferGroup.id == group_id).first()
            if group is not None:
                session.delete(group)

    session.delete(account)
    session.commit()
