"""
Account-level helpers (balances, lookups).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from db.models import Account, Category, Subcategory, Transaction, TransferGroup

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
