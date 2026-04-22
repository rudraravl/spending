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
    
    def combine(self, other: 'TransactionFilter') -> 'TransactionFilter':
        """
        Combine two filters (create a new filter with constraints from both).
        
        Args:
            other: Another TransactionFilter
            
        Returns:
            A new TransactionFilter with combined constraints
        """
        # For dates: use the most restrictive range
        start_date = self.start_date or other.start_date
        if self.start_date and other.start_date:
            start_date = max(self.start_date, other.start_date)
        
        end_date = self.end_date or other.end_date
        if self.end_date and other.end_date:
            end_date = min(self.end_date, other.end_date)
        
        # For amounts: use the most restrictive range
        min_amount = self.min_amount or other.min_amount
        if self.min_amount is not None and other.min_amount is not None:
            min_amount = max(self.min_amount, other.min_amount)
        
        max_amount = self.max_amount or other.max_amount
        if self.max_amount is not None and other.max_amount is not None:
            max_amount = min(self.max_amount, other.max_amount)

        exclude_account_types = None
        if self.exclude_account_types or other.exclude_account_types:
            a = set(self.exclude_account_types or ())
            b = set(other.exclude_account_types or ())
            exclude_account_types = tuple(sorted(a | b)) if (a | b) else None
        
        # For IDs: use the one that is set (or None if both unset)
        account_id = self.account_id or other.account_id
        category_id = self.category_id or other.category_id
        subcategory_id = self.subcategory_id or other.subcategory_id
        subcategory_ids = None
        if self.subcategory_ids or other.subcategory_ids:
            subcategory_ids = list(set((self.subcategory_ids or []) + (other.subcategory_ids or [])))
        
        # For tags: combine lists; use OR if either filter uses OR
        tag_ids = None
        if self.tag_ids or other.tag_ids:
            tag_ids = (self.tag_ids or []) + (other.tag_ids or [])
            tag_ids = list(set(tag_ids))  # Remove duplicates
        tags_match_any = self.tags_match_any or other.tags_match_any

        return TransactionFilter(
            start_date=start_date,
            end_date=end_date,
            account_id=account_id,
            category_id=category_id,
            subcategory_id=subcategory_id,
            subcategory_ids=subcategory_ids,
            tag_ids=tag_ids,
            tags_match_any=tags_match_any,
            min_amount=min_amount,
            max_amount=max_amount,
            exclude_account_types=exclude_account_types,
        )
    
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
