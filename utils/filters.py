"""
Filter System for querying transactions.

Provides a reusable TransactionFilter object that supports:
- Date range (start_date, end_date)
- Account
- Category
- Subcategory
- Tags (AND or OR: transaction must have ALL or ANY of the specified tags)
- Amount range (min_amount, max_amount)

Filters are combinable and used throughout the app.
"""

from datetime import date
from typing import Optional, List, Tuple

from db.models import Account, Tag, Transaction, TransactionSplit


class TransactionFilter:
    """
    Reusable filter object for querying transactions.
    
    Supports filtering by:
    - Date range (start_date, end_date) - required for summaries
    - Account ID
    - Category ID
    - Subcategory ID
    - Tag IDs (AND or OR via tags_match_any: ALL vs ANY of specified tags)
    - Amount range (min and max)
    """
    
    def __init__(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        account_id: Optional[int] = None,
        category_id: Optional[int] = None,
        subcategory_id: Optional[int] = None,
        subcategory_ids: Optional[List[int]] = None,
        tag_ids: Optional[List[int]] = None,
        tags_match_any: bool = False,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        exclude_account_types: Optional[Tuple[str, ...]] = None,
    ):
        """
        Initialize a filter.

        Args:
            start_date: Start date (inclusive)
            end_date: End date (inclusive)
            account_id: Account ID to filter by
            category_id: Category ID to filter by
            subcategory_id: Subcategory ID to filter by
            subcategory_ids: Subcategory IDs to filter by (OR semantics)
            tag_ids: List of tag IDs to filter by
            tags_match_any: If False (default), transaction must have ALL tags (AND).
                If True, transaction must have ANY of the tags (OR).
            min_amount: Minimum transaction amount
            max_amount: Maximum transaction amount
            exclude_account_types: If set, exclude transactions whose account type is in this set
                (e.g. ``("investment",)`` for budget/dashboard views).
        """
        self.start_date = start_date
        self.end_date = end_date
        self.account_id = account_id
        self.category_id = category_id
        self.subcategory_id = subcategory_id
        self.subcategory_ids = subcategory_ids
        self.tag_ids = tag_ids
        self.tags_match_any = tags_match_any
        self.min_amount = min_amount
        self.max_amount = max_amount
        self.exclude_account_types = exclude_account_types
    
    def __repr__(self):
        parts = []
        if self.start_date:
            parts.append(f"start_date={self.start_date}")
        if self.end_date:
            parts.append(f"end_date={self.end_date}")
        if self.account_id:
            parts.append(f"account_id={self.account_id}")
        if self.category_id:
            parts.append(f"category_id={self.category_id}")
        if self.subcategory_id:
            parts.append(f"subcategory_id={self.subcategory_id}")
        if self.subcategory_ids:
            parts.append(f"subcategory_ids={self.subcategory_ids}")
        if self.tag_ids:
            parts.append(f"tag_ids={self.tag_ids}")
        if self.tags_match_any:
            parts.append("tags_match_any=True")
        if self.min_amount is not None:
            parts.append(f"min_amount={self.min_amount}")
        if self.max_amount is not None:
            parts.append(f"max_amount={self.max_amount}")
        if self.exclude_account_types:
            parts.append(f"exclude_account_types={self.exclude_account_types}")
        
        return f"TransactionFilter({', '.join(parts)})"


def apply_transaction_filters(query, filters: Optional[TransactionFilter], *, split_level: bool = False):
    """
    Apply a TransactionFilter to a query that selects from (or joins) Transaction.

    Date, account, amount, tag and account-type filters always apply to the parent
    Transaction. Category/subcategory filters apply to Transaction, or to
    TransactionSplit when ``split_level`` is True (split-aware rollups).
    """
    if not filters:
        return query

    if filters.exclude_account_types:
        query = query.join(Account, Transaction.account_id == Account.id)
        query = query.filter(~Account.type.in_(list(filters.exclude_account_types)))

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

    # Tags (AND: all tags required; OR: any tag matches)
    if filters.tag_ids:
        if filters.tags_match_any:
            query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
        else:
            for tag_id in filters.tag_ids:
                query = query.filter(Transaction.tags.any(Tag.id == tag_id))

    category_model = TransactionSplit if split_level else Transaction
    if filters.category_id:
        query = query.filter(category_model.category_id == filters.category_id)
    if filters.subcategory_id:
        query = query.filter(category_model.subcategory_id == filters.subcategory_id)
    elif filters.subcategory_ids:
        query = query.filter(category_model.subcategory_id.in_(filters.subcategory_ids))

    return query
