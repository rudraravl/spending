"""
Filter System for querying transactions.

Provides a reusable TransactionFilter object that supports:
- Date range (start_date, end_date)
- Account
- Category
- Subcategory
- Tags (AND logic: transaction must have ALL specified tags)
- Amount range (min_amount, max_amount)

Filters are combinable and used throughout the app.
"""

from datetime import date
from typing import Optional, List


class TransactionFilter:
    """
    Reusable filter object for querying transactions.
    
    Supports filtering by:
    - Date range (start_date, end_date) - required for summaries
    - Account ID
    - Category ID
    - Subcategory ID
    - Tag IDs (AND logic: transaction must have ALL specified tags)
    - Amount range (min and max)
    """
    
    def __init__(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        account_id: Optional[int] = None,
        category_id: Optional[int] = None,
        subcategory_id: Optional[int] = None,
        tag_ids: Optional[List[int]] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
    ):
        """
        Initialize a filter.
        
        Args:
            start_date: Start date (inclusive)
            end_date: End date (inclusive)
            account_id: Account ID to filter by
            category_id: Category ID to filter by
            subcategory_id: Subcategory ID to filter by
            tag_ids: List of tag IDs to filter by (AND logic: transaction must have ALL tags)
            min_amount: Minimum transaction amount
            max_amount: Maximum transaction amount
        """
        self.start_date = start_date
        self.end_date = end_date
        self.account_id = account_id
        self.category_id = category_id
        self.subcategory_id = subcategory_id
        self.tag_ids = tag_ids
        self.min_amount = min_amount
        self.max_amount = max_amount
    
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
        
        # For IDs: use the one that is set (or None if both unset)
        account_id = self.account_id or other.account_id
        category_id = self.category_id or other.category_id
        subcategory_id = self.subcategory_id or other.subcategory_id
        
        # For tags: combine lists (AND logic: transaction must have ALL tags from both filters)
        tag_ids = None
        if self.tag_ids or other.tag_ids:
            tag_ids = (self.tag_ids or []) + (other.tag_ids or [])
            tag_ids = list(set(tag_ids))  # Remove duplicates
        
        return TransactionFilter(
            start_date=start_date,
            end_date=end_date,
            account_id=account_id,
            category_id=category_id,
            subcategory_id=subcategory_id,
            tag_ids=tag_ids,
            min_amount=min_amount,
            max_amount=max_amount,
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
        if self.tag_ids:
            parts.append(f"tag_ids={self.tag_ids}")
        if self.min_amount is not None:
            parts.append(f"min_amount={self.min_amount}")
        if self.max_amount is not None:
            parts.append(f"max_amount={self.max_amount}")
        
        return f"TransactionFilter({', '.join(parts)})"
