"""
Transaction Service - CRUD operations for transactions.

Provides:
- Create new transactions
- Update transaction fields
- Assign tags to transactions
- Query transactions with filters
- Delete transactions
"""

from datetime import date
from typing import List, Optional, cast
from sqlalchemy.orm import Session
from db.models import Transaction, Tag, Account, Category, Subcategory, TransferGroup, TransactionSplit
from utils.filters import TransactionFilter


SPLIT_TOLERANCE = .01


_UNSET = object()


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
        transaction.tags = tags
    
    session.add(transaction)
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
        transaction.tags = tags

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
    
    transaction.tags = tags
    session.commit()
    
    return transaction


def get_transactions(
    session: Session,
    filters: Optional[TransactionFilter] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    include_transfers: bool = True,
) -> List[Transaction]:
    """
    Get transactions matching the given filters.
    
    Args:
        session: Database session
        filters: TransactionFilter object (if None, returns all transactions)
        limit: Maximum number of results
        offset: Number of results to skip
        
    Returns:
        List of Transaction objects
    """
    query = session.query(Transaction)
    if not include_transfers:
        query = query.filter(Transaction.is_transfer.is_(False))
    
    if filters:
        # Apply filters
        if filters.start_date:
            query = query.filter(Transaction.date >= filters.start_date)
        
        if filters.end_date:
            query = query.filter(Transaction.date <= filters.end_date)
        
        if filters.account_id:
            query = query.filter(Transaction.account_id == filters.account_id)
        
        if filters.min_amount is not None:
            query = query.filter(Transaction.amount >= filters.min_amount)
        
        if filters.max_amount is not None:
            query = query.filter(Transaction.amount <= filters.max_amount)
        
        # Filter by tag (AND: all tags required; OR: any tag matches)
        if filters.tag_ids:
            if getattr(filters, "tags_match_any", False):
                query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
            else:
                for tag_id in filters.tag_ids:
                    query = query.filter(Transaction.tags.any(Tag.id == tag_id))
        
        # Filter by category (direct category_id match only)
        if filters.category_id:
            query = query.filter(Transaction.category_id == filters.category_id)
        
        # Filter by subcategory
        if filters.subcategory_id:
            query = query.filter(Transaction.subcategory_id == filters.subcategory_id)
    
    # Apply ordering
    query = query.order_by(Transaction.date.desc(), Transaction.id.desc())
    
    # Apply limit and offset
    if limit:
        query = query.limit(limit)
    query = query.offset(offset)
    
    return query.all()


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
    
    Args:
        session: Database session
        transaction_id: ID of the transaction
        
    Returns:
        True if successful, False if transaction not found
    """
    transaction = session.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        return False

    # If this transaction is part of a transfer group, delete the entire group
    if transaction.transfer_group_id:
        group = (
            session.query(TransferGroup)
            .filter(TransferGroup.id == transaction.transfer_group_id)
            .first()
        )
        if group:
            session.delete(group)
            session.commit()
            return True

    session.delete(transaction)
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
    session.commit()

    return group


def count_transactions(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> int:
    """
    Count transactions matching the given filters.
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        Number of transactions
    """
    query = session.query(Transaction)
    
    if filters:
        if filters.start_date:
            query = query.filter(Transaction.date >= filters.start_date)
        
        if filters.end_date:
            query = query.filter(Transaction.date <= filters.end_date)
        
        if filters.account_id:
            query = query.filter(Transaction.account_id == filters.account_id)
        
        if filters.min_amount is not None:
            query = query.filter(Transaction.amount >= filters.min_amount)
        
        if filters.max_amount is not None:
            query = query.filter(Transaction.amount <= filters.max_amount)
        
        # Filter by tag (AND: all tags required; OR: any tag matches)
        if filters.tag_ids:
            if getattr(filters, "tags_match_any", False):
                query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
            else:
                for tag_id in filters.tag_ids:
                    query = query.filter(Transaction.tags.any(Tag.id == tag_id))
        
        # Filter by category (direct category_id match only)
        if filters.category_id:
            query = query.filter(Transaction.category_id == filters.category_id)
        
        # Filter by subcategory
        if filters.subcategory_id:
            query = query.filter(Transaction.subcategory_id == filters.subcategory_id)
    
    return query.count()


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

    session.commit()
    return list(txn.splits)