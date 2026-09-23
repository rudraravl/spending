"""
Account-level helpers (balances, lookups).
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from db.models import (
    Account,
    BudgetCategory,
    Category,
    CategoryBudget,
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


def display_balances_by_account(session: Session) -> dict[int, float]:
    """account_display_balance()'s display value for every account, in two queries."""
    ledger = {
        int(aid): float(total or 0.0)
        for aid, total in session.query(Transaction.account_id, func.sum(Transaction.amount))
        .group_by(Transaction.account_id)
        .all()
    }
    return {
        int(acct.id): (
            float(acct.reported_balance) if acct.reported_balance is not None else ledger.get(int(acct.id), 0.0)
        )
        for acct in session.query(Account).all()
    }


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


def get_other_uncategorized_ids(session: Session) -> tuple[int, int]:
    """(category_id, subcategory_id) of Other / Uncategorized, the fallback for unlinked legs."""
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


def delete_empty_transfer_groups(session: Session, group_ids: set[int]) -> None:
    """
    Delete TransferGroups that no longer have any legs.

    TransferGroup.transactions cascades deletes, and without a flush the
    collection loads from the DB where legs unlinked in this session still point
    at the group, so deleting it would also delete those legs. Flush the unlinks
    first and reload the collection before deleting.
    """
    if not group_ids:
        return
    session.flush()
    for group in session.query(TransferGroup).filter(TransferGroup.id.in_(group_ids)).all():
        session.expire(group, ["transactions"])
        if not group.transactions:
            session.delete(group)


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

    other_cat_id, unc_sub_id = get_other_uncategorized_ids(session)

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

        delete_empty_transfer_groups(session, group_ids)

    touched_months = {
        (d.year, d.month)
        for (d,) in session.query(Transaction.date).filter(Transaction.account_id == account_id).distinct()
    }
    # The account's credit-card payment envelope (and its monthly rows) goes with it.
    envelope_ids = session.query(BudgetCategory.id).filter(BudgetCategory.linked_account_id == account_id)
    session.query(CategoryBudget).filter(CategoryBudget.budget_category_id.in_(envelope_ids)).delete(
        synchronize_session=False
    )
    session.query(BudgetCategory).filter(BudgetCategory.linked_account_id == account_id).delete(
        synchronize_session=False
    )
    session.delete(account)
    if touched_months:
        # Local import: zbb_service imports this module.
        from services.zbb_service import recalc_activity_for_months

        session.flush()
        recalc_activity_for_months(session, touched_months)
    session.commit()
