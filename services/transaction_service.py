"""
Transaction Service - CRUD operations for transactions.

Provides:
- Create new transactions
- Update transaction fields
- Assign tags to transactions
- Query transactions with filters
- Delete transactions
"""

from datetime import date, datetime, timezone
from typing import Iterable, List, Literal, Optional, cast
from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session, aliased, joinedload, selectinload
from db.models import Transaction, Tag, Account, Category, Subcategory, TransferGroup, TransactionSplit
from services.account_service import delete_empty_transfer_groups, get_other_uncategorized_ids
from services.transfer_matching_service import CARD_PAYMENT_AMOUNT_TOLERANCE
from services.zbb_service import recalc_activity_for_months
from utils.filters import TransactionFilter, apply_transaction_filters


SPLIT_TOLERANCE = .01
LINK_AMOUNT_TOLERANCE = CARD_PAYMENT_AMOUNT_TOLERANCE
# Appended to each leg's notes on link and removed again on unlink.
TRANSFER_LINK_NOTE = "Linked as transfer."


def _add_link_note(notes: str | None) -> str:
    lines = (notes or "").splitlines()
    if TRANSFER_LINK_NOTE in lines:
        return notes or TRANSFER_LINK_NOTE
    return f"{notes}\n{TRANSFER_LINK_NOTE}" if notes else TRANSFER_LINK_NOTE


def _remove_link_note(notes: str | None) -> str | None:
    if not notes:
        return notes
    kept = [line for line in notes.splitlines() if line != TRANSFER_LINK_NOTE]
    return "\n".join(kept) or None


_UNSET = object()


def _set_tags(transaction: Transaction, tags: Iterable[Tag]) -> None:
    """Replace a transaction's tags, stamping newly added ones as just used."""
    tags = list(tags)
    previous = {t.id for t in transaction.tags}
    now = datetime.now(timezone.utc)
    for tag in tags:
        if tag.id not in previous:
            tag.last_used_at = now
    transaction.tags = tags


def _month_key(d: date | None) -> tuple[int, int] | None:
    if d is None:
        return None
    return int(d.year), int(d.month)


def _recalc_zbb_months(session: Session, months: list[tuple[int, int] | None]) -> None:
    normalized = [(y, m) for ym in months if ym is not None for (y, m) in [ym]]
    if normalized:
        recalc_activity_for_months(session, normalized)


def create_transaction(
    session: Session,
    date_: date,
    amount: float,
    merchant: str,
    account_id: int,
    category_id: int,
    subcategory_id: int,
    notes: Optional[str] = None,
    tag_ids: Optional[List[int]] = None,
    source: str = "manual",
    external_id: Optional[str] = None,
) -> Transaction:
    """
    Create a new transaction.
    
    Args:
        session: Database session
        date_: Transaction date
        amount: Signed amount (cash-flow: positive = inflow, negative = outflow)
        merchant: Merchant name
        account_id: ID of the account
        category_id: REQUIRED category ID
        subcategory_id: REQUIRED subcategory ID (must belong to category_id)
        notes: Optional notes
        tag_ids: Optional list of tag IDs to assign
        
    Returns:
        Created Transaction object
        
    Raises:
        ValueError: If account, category, or subcategory doesn't exist, or if subcategory doesn't belong to category
    """
    # Verify account exists
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError(f"Account with id {account_id} does not exist")

    # Verify category exists
    category = session.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise ValueError(f"Category with id {category_id} does not exist")
    
    # Verify subcategory exists and belongs to category
    subcategory = session.query(Subcategory).filter(Subcategory.id == subcategory_id).first()
    if not subcategory:
        raise ValueError(f"Subcategory with id {subcategory_id} does not exist")
    
    if subcategory.category_id != category_id:
        raise ValueError(
            f"Subcategory '{subcategory.name}' (id={subcategory_id}) does not belong to "
            f"category '{category.name}' (id={category_id})"
        )
    
    transaction = Transaction(
        date=date_,
        amount=amount,
        merchant=merchant,
        account_id=account_id,
        category_id=category_id,
        subcategory_id=subcategory_id,
        notes=notes,
        source=source,
        external_id=external_id,
    )
    
    # Add tags if provided
    if tag_ids:
        tags = session.query(Tag).filter(Tag.id.in_(tag_ids)).all()
        if len(tags) != len(tag_ids):
            existing_ids = {tag.id for tag in tags}
            missing_ids = set(tag_ids) - existing_ids
            raise ValueError(f"Tags with ids {missing_ids} do not exist")
        _set_tags(transaction, tags)
    
    session.add(transaction)
    _recalc_zbb_months(session, [_month_key(date_)])
    session.commit()
    
    return transaction


def update_transaction(
    session: Session,
    transaction_id: int,
    *,
    date_: Optional[date] = None,
    amount: Optional[float] = None,
    merchant: Optional[str] = None,
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    subcategory_id: Optional[int] = None,
    notes: str | None | object = _UNSET,
    tag_ids: Optional[List[int]] = None,
) -> Transaction:
    """
    Update one or more fields of a transaction, with full validation.

    For normal spending transactions:
    - Every transaction has exactly one account, category, and subcategory.
    - Subcategory must belong to category.
    Tags are replaced atomically when provided.
    """
    transaction = (
        session.query(Transaction).filter(Transaction.id == transaction_id).first()
    )
    if not transaction:
        raise ValueError(f"Transaction with id {transaction_id} does not exist")

    old_month = _month_key(transaction.date)
    # Resolve target values (fall back to current)
    new_date = date_ if date_ is not None else transaction.date
    new_amount = amount if amount is not None else transaction.amount
    new_merchant = merchant if merchant is not None else transaction.merchant

    new_account_id = account_id if account_id is not None else transaction.account_id
    new_category_id = (
        category_id if category_id is not None else transaction.category_id
    )
    new_subcategory_id = (
        subcategory_id if subcategory_id is not None else transaction.subcategory_id
    )

    # `notes` needs to support explicit clearing (notes=None) vs "field omitted".
    new_notes = transaction.notes if notes is _UNSET else notes

    # A linked leg must keep mirroring its peer; changing its amount or account
    # would leave a "transfer" that no longer nets to zero across two accounts.
    if transaction.transfer_group_id is not None:
        if abs(float(new_amount) - float(transaction.amount)) > 0.005:
            raise ValueError(
                f"Transaction {transaction_id} is part of a linked transfer; "
                "unlink it before changing its amount"
            )
        if new_account_id != transaction.account_id:
            raise ValueError(
                f"Transaction {transaction_id} is part of a linked transfer; "
                "unlink it before moving it to another account"
            )

    # Validate account
    account = session.query(Account).filter(Account.id == new_account_id).first()
    if not account:
        raise ValueError(f"Account with id {new_account_id} does not exist")

    # Validate category + subcategory for non-transfer transactions only
    if not transaction.is_transfer:
        category = session.query(Category).filter(Category.id == new_category_id).first()
        if not category:
            raise ValueError(f"Category with id {new_category_id} does not exist")

        subcategory = (
            session.query(Subcategory)
            .filter(Subcategory.id == new_subcategory_id)
            .first()
        )
        if not subcategory:
            raise ValueError(f"Subcategory with id {new_subcategory_id} does not exist")
        if subcategory.category_id != new_category_id:
            raise ValueError(
                f"Subcategory '{subcategory.name}' (id={new_subcategory_id}) does not belong to "
                f"category '{category.name}' (id={new_category_id})"
            )

    # Apply scalar updates
    transaction.date = new_date
    transaction.amount = new_amount
    transaction.merchant = new_merchant
    transaction.account_id = new_account_id
    transaction.category_id = new_category_id
    transaction.subcategory_id = new_subcategory_id
    transaction.notes = new_notes

    # Update tags if explicitly provided
    if tag_ids is not None:
        tags = session.query(Tag).filter(Tag.id.in_(tag_ids)).all()
        if len(tags) != len(tag_ids):
            existing_ids = {tag.id for tag in tags}
            missing_ids = set(tag_ids) - existing_ids
            raise ValueError(f"Tags with ids {missing_ids} do not exist")
        _set_tags(transaction, tags)

    _recalc_zbb_months(session, [old_month, _month_key(new_date)])
    session.commit()

    return transaction


def assign_tags(
    session: Session,
    transaction_id: int,
    tag_ids: List[int],
) -> Transaction:
    """
    Assign tags to a transaction (replaces existing tags).
    
    Args:
        session: Database session
        transaction_id: ID of the transaction
        tag_ids: List of tag IDs to assign
        
    Returns:
        Updated Transaction object
    """
    transaction = session.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise ValueError(f"Transaction with id {transaction_id} does not exist")
    
    # Get tags
    tags = session.query(Tag).filter(Tag.id.in_(tag_ids)).all()
    
    # Verify all tags exist
    if len(tags) != len(tag_ids):
        existing_ids = {tag.id for tag in tags}
        missing_ids = set(tag_ids) - existing_ids
        raise ValueError(f"Tags with ids {missing_ids} do not exist")
    
    _set_tags(transaction, tags)
    session.commit()
    
    return transaction


TransactionSortField = Literal["date", "amount", "merchant", "account", "category", "subcategory"]


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered_transactions_query(
    session: Session,
    filters: Optional[TransactionFilter],
    include_transfers: bool,
    search: Optional[str],
) -> Query:
    query = session.query(Transaction)
    if not include_transfers:
        query = query.filter(Transaction.is_transfer.is_(False))
    query = apply_transaction_filters(query, filters)

    needle = (search or "").strip()
    if needle:
        pattern = f"%{_escape_like(needle)}%"
        query = query.filter(
            or_(
                Transaction.merchant.ilike(pattern, escape="\\"),
                Transaction.notes.ilike(pattern, escape="\\"),
            )
        )
    return query


def _apply_transaction_sort(query: Query, sort_by: TransactionSortField, descending: bool) -> Query:
    if sort_by == "amount":
        key = Transaction.amount
    elif sort_by == "merchant":
        key = func.lower(Transaction.merchant)
    elif sort_by == "account":
        # Aliased so it can't collide with the Account join used by filters.
        account = aliased(Account)
        query = query.outerjoin(account, Transaction.account_id == account.id)
        key = func.lower(account.name)
    elif sort_by == "category":
        category = aliased(Category)
        query = query.outerjoin(category, Transaction.category_id == category.id)
        key = func.lower(category.name)
    elif sort_by == "subcategory":
        subcategory = aliased(Subcategory)
        query = query.outerjoin(subcategory, Transaction.subcategory_id == subcategory.id)
        key = func.lower(subcategory.name)
    else:
        key = Transaction.date
    # Newest-first tiebreakers keep the order stable, so offset pages never
    # skip or repeat rows that share a sort value.
    return query.order_by(
        key.desc() if descending else key.asc(),
        Transaction.date.desc(),
        Transaction.id.desc(),
    )


def get_transactions(
    session: Session,
    filters: Optional[TransactionFilter] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    include_transfers: bool = True,
    search: Optional[str] = None,
    sort_by: TransactionSortField = "date",
    sort_desc: bool = True,
) -> List[Transaction]:
    """
    Get transactions matching the given filters.
    
    Args:
        session: Database session
        filters: TransactionFilter object (if None, returns all transactions)
        limit: Maximum number of results
        offset: Number of results to skip
        search: Case-insensitive substring match on merchant or notes
        sort_by / sort_desc: Ordering (default newest first)
        
    Returns:
        List of Transaction objects
    """
    query = _filtered_transactions_query(session, filters, include_transfers, search)
    query = _apply_transaction_sort(query, sort_by, sort_desc)
    # Callers serialize account/category/subcategory names, tags and has-splits for
    # every row; load them up front instead of lazily per row.
    query = query.options(
        joinedload(Transaction.account),
        joinedload(Transaction.category),
        joinedload(Transaction.subcategory),
        selectinload(Transaction.tags),
        selectinload(Transaction.splits),
    )

    # Apply limit and offset
    if limit:
        query = query.limit(limit)
    query = query.offset(offset)
    
    return query.all()


def count_transactions(
    session: Session,
    filters: Optional[TransactionFilter] = None,
    include_transfers: bool = True,
    search: Optional[str] = None,
) -> int:
    """Number of transactions get_transactions would return without limit/offset."""
    return _filtered_transactions_query(session, filters, include_transfers, search).count()


def get_transaction_by_id(
    session: Session,
    transaction_id: int,
) -> Optional[Transaction]:
    """
    Get a single transaction by ID.
    
    Args:
        session: Database session
        transaction_id: ID of the transaction
        
    Returns:
        Transaction object or None
    """
    return session.query(Transaction).filter(Transaction.id == transaction_id).first()


def delete_transaction(
    session: Session,
    transaction_id: int,
) -> bool:
    """
    Delete a transaction.

    If it is linked as a transfer, peer legs are unlinked (not deleted) and set to
    Other / Uncategorized; only the selected row and the empty TransferGroup are removed.

    Args:
        session: Database session
        transaction_id: ID of the transaction

    Returns:
        True if successful, False if transaction not found
    """
    transaction = session.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        return False
    month = _month_key(transaction.date)

    group_id = transaction.transfer_group_id
    if group_id is not None:
        month_keys = [month]
        other_cat_id, unc_sub_id = get_other_uncategorized_ids(session)
        peers = (
            session.query(Transaction)
            .filter(Transaction.transfer_group_id == group_id, Transaction.id != transaction_id)
            .all()
        )
        for peer in peers:
            peer.is_transfer = False
            peer.transfer_group_id = None
            peer.category_id = other_cat_id
            peer.subcategory_id = unc_sub_id
            peer.notes = _remove_link_note(peer.notes)
            month_keys.append(_month_key(peer.date))

        session.delete(transaction)
        delete_empty_transfer_groups(session, {int(group_id)})
        _recalc_zbb_months(session, month_keys)
        session.commit()
        return True

    session.delete(transaction)
    _recalc_zbb_months(session, [month])
    session.commit()

    return True


def create_transfer(
    session: Session,
    from_account_id: int,
    to_account_id: int,
    amount: float,
    date_: date,
    notes: Optional[str] = None,
) -> TransferGroup:
    """
    Create a transfer between two accounts as a pair of linked transactions.

    A transfer is represented as:
    - One negative amount on the source account
    - One positive amount on the destination account
    Both rows share a transfer_group_id and are flagged as transfers.
    """
    if from_account_id == to_account_id:
        raise ValueError("from_account and to_account must be different")
    if amount <= 0:
        raise ValueError("amount must be greater than zero")

    from_acct = session.query(Account).filter(Account.id == from_account_id).first()
    to_acct = session.query(Account).filter(Account.id == to_account_id).first()
    if not from_acct or not to_acct:
        raise ValueError("Both from_account and to_account must exist")

    group = TransferGroup(notes=notes)
    session.add(group)
    session.flush()  # ensure group.id is available

    debit_txn = Transaction(
        date=date_,
        amount=-amount,
        merchant=f"Transfer to {to_acct.name}",
        account_id=from_account_id,
        category_id=None,
        subcategory_id=None,
        notes=notes,
        is_transfer=True,
        transfer_group=group,
        source="manual",
        external_id=None,
    )

    credit_txn = Transaction(
        date=date_,
        amount=amount,
        merchant=f"Transfer from {from_acct.name}",
        account_id=to_account_id,
        category_id=None,
        subcategory_id=None,
        notes=notes,
        is_transfer=True,
        transfer_group=group,
        source="manual",
        external_id=None,
    )

    session.add(debit_txn)
    session.add(credit_txn)
    _recalc_zbb_months(session, [_month_key(date_)])
    session.commit()

    return group


def link_transactions_as_transfer(
    session: Session,
    transaction_id_a: int,
    transaction_id_b: int,
    *,
    canonical_amount: float | None = None,
    notes: str | None = None,
) -> TransferGroup:
    """
    Convert two existing transactions into one transfer pair.

    Works for any two different accounts (e.g. checking -> investment, checking -> credit).
    One leg must be an outflow and the other an inflow so direction is unambiguous.

    Original transaction dates are preserved (e.g. bank post vs brokerage settle).
    """
    if transaction_id_a == transaction_id_b:
        raise ValueError("Cannot link a transaction to itself")

    t_a = session.query(Transaction).filter(Transaction.id == transaction_id_a).first()
    t_b = session.query(Transaction).filter(Transaction.id == transaction_id_b).first()
    if not t_a:
        raise ValueError(f"Transaction with id {transaction_id_a} does not exist")
    if not t_b:
        raise ValueError(f"Transaction with id {transaction_id_b} does not exist")

    for t in (t_a, t_b):
        if t.is_transfer or t.transfer_group_id is not None:
            raise ValueError(f"Transaction {t.id} is already a transfer")
        if t.splits:
            raise ValueError(
                f"Transaction {t.id} has splits; clear splits before linking as a transfer"
            )

    acct_a = session.query(Account).filter(Account.id == t_a.account_id).first()
    acct_b = session.query(Account).filter(Account.id == t_b.account_id).first()
    if not acct_a or not acct_b:
        raise ValueError("Account missing for one of the transactions")
    if t_a.account_id == t_b.account_id:
        raise ValueError("Both transactions are on the same account")

    # Infer transfer direction by signs: source(outflow) is negative, destination(inflow) positive.
    if float(t_a.amount) < 0 and float(t_b.amount) > 0:
        source_txn, destination_txn = t_a, t_b
    elif float(t_b.amount) < 0 and float(t_a.amount) > 0:
        source_txn, destination_txn = t_b, t_a
    else:
        raise ValueError(
            "Need one outflow and one inflow to link as transfer; "
            "update signs first if needed"
        )

    mag_source = abs(float(source_txn.amount))
    mag_destination = abs(float(destination_txn.amount))
    if canonical_amount is None:
        if abs(mag_source - mag_destination) > LINK_AMOUNT_TOLERANCE:
            raise ValueError(
                "Amounts differ by more than "
                f"{LINK_AMOUNT_TOLERANCE}; provide canonical_amount explicitly"
            )
        canonical = max(mag_source, mag_destination)
    else:
        canonical = float(canonical_amount)
        if canonical <= 0:
            raise ValueError("canonical_amount must be positive")
        if abs(mag_source - canonical) > LINK_AMOUNT_TOLERANCE or abs(
            mag_destination - canonical
        ) > LINK_AMOUNT_TOLERANCE:
            raise ValueError(
                "canonical_amount does not match both transactions within tolerance"
            )

    group = TransferGroup(notes=notes)
    session.add(group)
    session.flush()

    source_txn.amount = -canonical
    destination_txn.amount = canonical
    source_txn.is_transfer = True
    destination_txn.is_transfer = True
    source_txn.transfer_group_id = group.id
    destination_txn.transfer_group_id = group.id
    source_txn.category_id = None
    source_txn.subcategory_id = None
    destination_txn.category_id = None
    destination_txn.subcategory_id = None
    for t in (source_txn, destination_txn):
        t.notes = _add_link_note(t.notes)

    _recalc_zbb_months(session, [_month_key(t_a.date), _month_key(t_b.date)])
    session.commit()
    return group


def unlink_transfer_pair(
    session: Session,
    transaction_id_a: int,
    transaction_id_b: int,
) -> int:
    """
    Unlink two transactions that are currently linked as a transfer pair.

    After unlinking, both transactions become normal rows and are recategorized to
    Other -> Uncategorized so they remain valid non-transfer transactions.
    Returns the unlinked transfer_group_id.
    """
    if transaction_id_a == transaction_id_b:
        raise ValueError("Cannot unlink a transaction from itself")

    t_a = session.query(Transaction).filter(Transaction.id == transaction_id_a).first()
    t_b = session.query(Transaction).filter(Transaction.id == transaction_id_b).first()
    if not t_a:
        raise ValueError(f"Transaction with id {transaction_id_a} does not exist")
    if not t_b:
        raise ValueError(f"Transaction with id {transaction_id_b} does not exist")

    if not t_a.is_transfer or t_a.transfer_group_id is None:
        raise ValueError(f"Transaction {t_a.id} is not linked as a transfer")
    if not t_b.is_transfer or t_b.transfer_group_id is None:
        raise ValueError(f"Transaction {t_b.id} is not linked as a transfer")
    if t_a.transfer_group_id != t_b.transfer_group_id:
        raise ValueError("Selected transactions are not linked to the same transfer group")

    group_id = int(t_a.transfer_group_id)
    other_cat_id, unc_sub_id = get_other_uncategorized_ids(session)

    for t in (t_a, t_b):
        t.is_transfer = False
        t.transfer_group_id = None
        t.notes = _remove_link_note(t.notes)
        if t.category_id is None:
            t.category_id = other_cat_id
        if t.subcategory_id is None:
            t.subcategory_id = unc_sub_id

    delete_empty_transfer_groups(session, {group_id})

    _recalc_zbb_months(session, [_month_key(t_a.date), _month_key(t_b.date)])
    session.commit()
    return group_id


def _validate_split_row(
    session: Session,
    category_id: int,
    subcategory_id: int,
) -> None:
    """
    Validate a split row.
    
    Args:
        session: Database session
        category_id: Category ID
        subcategory_id: Subcategory ID
    """
    category = session.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise ValueError(f"Category with id {category_id} does not exist")
    
    subcategory = (
        session.query(Subcategory)
        .filter(
            Subcategory.id == subcategory_id,
            Subcategory.category_id == category_id,
        )
        .first()
    )
    if not subcategory:
        raise ValueError(
            f"Subcategory with id {subcategory_id} either does not exist or does not "
            f"belong to category '{category.name}' (id={category_id})"
        )


def set_transaction_splits(
    session: Session,
    transaction_id: int,
    splits: list[dict],
) -> list[TransactionSplit]:
    """
    Replace all splits for a transaction.

    splits: list of {"category_id": int, "subcategory_id": int, "amount": float, "notes": Optional[str]}
    """

    txn = (session.query(Transaction).filter(Transaction.id == transaction_id).first())
    if not txn:
        raise ValueError(f"Transaction with id {transaction_id} does not exist")

    if not splits:
        # clear splits, revert to using parent transaction
        txn.splits.clear()
        _recalc_zbb_months(session, [_month_key(txn.date)])
        session.commit()
        return []

    total_split = 0.0
    new_splits: list[TransactionSplit] = []
    for row in splits:
        category_id = row["category_id"]
        subcategory_id = row["subcategory_id"]
        amount = float(row["amount"])
        notes = row.get("notes")

        _validate_split_row(session, category_id, subcategory_id)
        total_split += amount

        new_splits.append(
            TransactionSplit(
                category_id=category_id,
                subcategory_id=subcategory_id,
                amount=amount,
                notes=notes,
            )
        )

    txn_amount = cast(float, txn.amount)
    if abs(total_split - txn_amount) >= SPLIT_TOLERANCE:
        raise ValueError(
            f"Total split amount {total_split} does not match transaction amount {txn_amount}"
        )

    # Replace existing splits atomically after validation
    txn.splits.clear()
    for s in new_splits:
        txn.splits.append(s)

    _recalc_zbb_months(session, [_month_key(txn.date)])
    session.commit()
    return list(txn.splits)
