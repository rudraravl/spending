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
from typing import List, Optional, Dict, Any
from sqlalchemy import or_
from sqlalchemy.orm import Session
from db.models import Transaction, Tag, Account, Category
from utils.filters import TransactionFilter


def create_transaction(
    session: Session,
    date_: date,
    amount: float,
    merchant: str,
    account_id: int,
    category_id: Optional[int] = None,
    notes: Optional[str] = None,
    tag_ids: Optional[List[int]] = None,
) -> Transaction:
    """
    Create a new transaction.
    
    Args:
        session: Database session
        date_: Transaction date
        amount: Transaction amount
        merchant: Merchant name
        account_id: ID of the account
        category_id: Optional category ID to assign
        notes: Optional notes
        tag_ids: Optional list of tag IDs to assign
        
    Returns:
        Created Transaction object
    """
    # Verify account exists
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError(f"Account with id {account_id} does not exist")

    if category_id is not None:
        category = session.query(Category).filter(Category.id == category_id).first()
        if not category:
            raise ValueError(f"Category with id {category_id} does not exist")
    
    transaction = Transaction(
        date=date_,
        amount=amount,
        merchant=merchant,
        account_id=account_id,
        category_id=category_id,
        notes=notes,
    )
    
    # Add tags if provided
    if tag_ids:
        tags = session.query(Tag).filter(Tag.id.in_(tag_ids)).all()
        transaction.tags = tags
    
    session.add(transaction)
    session.commit()
    
    return transaction


def update_transaction(
    session: Session,
    transaction_id: int,
    field: str,
    value: Any,
) -> Transaction:
    """
    Update a single field of a transaction.
    
    Args:
        session: Database session
        transaction_id: ID of the transaction
        field: Field name to update (date, amount, merchant, notes, account_id)
        value: New value
        
    Returns:
        Updated Transaction object
    """
    transaction = session.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise ValueError(f"Transaction with id {transaction_id} does not exist")
    
    # Validate field
    valid_fields = ['date', 'amount', 'merchant', 'notes', 'account_id', 'category_id']
    if field not in valid_fields:
        raise ValueError(f"Invalid field '{field}'. Must be one of {valid_fields}")
    
    # Special validation for account_id
    if field == 'account_id':
        account = session.query(Account).filter(Account.id == value).first()
        if not account:
            raise ValueError(f"Account with id {value} does not exist")

    if field == 'category_id' and value is not None:
        category = session.query(Category).filter(Category.id == value).first()
        if not category:
            raise ValueError(f"Category with id {value} does not exist")
    
    setattr(transaction, field, value)
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
        
        # Filter by tag (any of the specified tags)
        if filters.tag_ids:
            query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
        
        # Filter by category (transactions with tags in the category)
        if filters.category_id:
            query = query.filter(
                or_(
                    Transaction.category_id == filters.category_id,
                    Transaction.tags.any(Tag.category_id == filters.category_id),
                )
            )
    
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
    
    session.delete(transaction)
    session.commit()
    
    return True


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
        
        if filters.tag_ids:
            query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
        
        if filters.category_id:
            query = query.filter(
                or_(
                    Transaction.category_id == filters.category_id,
                    Transaction.tags.any(Tag.category_id == filters.category_id),
                )
            )
    
    return query.count()
