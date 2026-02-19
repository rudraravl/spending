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
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
from db.models import Transaction, Tag, Account, Category, Subcategory
from utils.filters import TransactionFilter


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
) -> Transaction:
    """
    Create a new transaction.
    
    Args:
        session: Database session
        date_: Transaction date
        amount: Transaction amount
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
    field: str,
    value: Any,
) -> Transaction:
    """
    Update a single field of a transaction.
    
    Args:
        session: Database session
        transaction_id: ID of the transaction
        field: Field name to update (date, amount, merchant, notes, account_id, category_id, subcategory_id)
        value: New value
        
    Returns:
        Updated Transaction object
        
    Raises:
        ValueError: If transaction doesn't exist, field is invalid, or validation fails
    """
    transaction = session.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise ValueError(f"Transaction with id {transaction_id} does not exist")
    
    # Validate field
    valid_fields = ['date', 'amount', 'merchant', 'notes', 'account_id', 'category_id', 'subcategory_id']
    if field not in valid_fields:
        raise ValueError(f"Invalid field '{field}'. Must be one of {valid_fields}")
    
    # Special validation for account_id
    if field == 'account_id':
        account = session.query(Account).filter(Account.id == value).first()
        if not account:
            raise ValueError(f"Account with id {value} does not exist")

    # Special validation for category_id
    if field == 'category_id':
        if value is None:
            raise ValueError("category_id is required and cannot be None")
        category = session.query(Category).filter(Category.id == value).first()
        if not category:
            raise ValueError(f"Category with id {value} does not exist")
        # If changing category, validate subcategory still belongs to new category
        if transaction.subcategory_id:
            subcategory = session.query(Subcategory).filter(Subcategory.id == transaction.subcategory_id).first()
            if subcategory and subcategory.category_id != value:
                raise ValueError(
                    f"Cannot change category: current subcategory '{subcategory.name}' "
                    f"belongs to category id {subcategory.category_id}, not {value}"
                )
    
    # Special validation for subcategory_id
    if field == 'subcategory_id':
        if value is None:
            raise ValueError("subcategory_id is required and cannot be None")
        subcategory = session.query(Subcategory).filter(Subcategory.id == value).first()
        if not subcategory:
            raise ValueError(f"Subcategory with id {value} does not exist")
        # Validate subcategory belongs to transaction's category
        if transaction.category_id != subcategory.category_id:
            category = session.query(Category).filter(Category.id == transaction.category_id).first()
            raise ValueError(
                f"Subcategory '{subcategory.name}' (id={value}) does not belong to "
                f"transaction's category '{category.name if category else 'Unknown'}' (id={transaction.category_id})"
            )
    
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
