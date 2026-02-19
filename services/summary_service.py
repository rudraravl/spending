"""
Summary Service - Aggregation and summary calculations.

Provides:
- Summaries grouped by tag
- Summaries grouped by category
- Total spend calculation
- Export to CSV format
"""

from typing import List, Optional, Dict, Tuple
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from db.models import Transaction, Tag, Category, Subcategory
from utils.filters import TransactionFilter


# Subcategory name(s) to exclude from spending totals (case-insensitive)
PAYMENT_SUBCATEGORY_NAMES = {'payments'}


def _exclude_payment_transactions(query):
    """Exclude transactions in the Payments subcategory from spending aggregates."""
    return query.filter(
        ~Transaction.subcategory.has(func.lower(Subcategory.name).in_(list(PAYMENT_SUBCATEGORY_NAMES)))
    )


def calculate_total(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Calculate total spending for transactions matching filters.

    NOTE: Transactions in the Payments subcategory are excluded from totals.

    Args:
        session: Database session
        filters: TransactionFilter object

    Returns:
        Total amount (sum of matching transaction amounts excluding Payments subcategory)
    """
    query = session.query(func.sum(Transaction.amount))
    query = _exclude_payment_transactions(query)
    
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
    
    result = query.scalar()
    return float(result) if result else 0.0


def summarize_by_tag(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by tag (contextual reporting only, tags have no accounting meaning).

    NOTE: Transactions in the Payments subcategory are excluded from this summary.

    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: tag, total, count, percent
    """
    # Get all transactions matching filters
    query = session.query(
        Tag.id.label('tag_id'),
        Tag.name.label('tag'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).join(Transaction.tags).group_by(Tag.id, Tag.name)
    query = _exclude_payment_transactions(query)
    
    # Apply filters
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
    
    results = query.all()
    
    # Convert to list of dicts
    data = []
    for row in results:
        data.append({
            'tag': row.tag,
            'total': row.total,
            'count': row.count,
        })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    if len(df) == 0:
        return pd.DataFrame(columns=['tag', 'total', 'count', 'percent'])
    
    # Calculate percentage
    total = df['total'].sum()
    if total > 0:
        df['percent'] = (df['total'] / total * 100).round(2)
    else:
        df['percent'] = 0.0
    
    # Sort by total descending
    df = df.sort_values('total', ascending=False).reset_index(drop=True)
    
    return df[['tag', 'total', 'count', 'percent']]


def summarize_by_category(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by category (accounting classification).
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: category, total, count, percent
    """
    # Group by category_id directly (every transaction has exactly one category)
    query = session.query(
        Category.id.label('category_id'),
        Category.name.label('category'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).select_from(Transaction).join(Transaction.category).group_by(Category.id, Category.name)
    query = _exclude_payment_transactions(query)
    
    # Apply filters
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
    
    results = query.all()
    
    # Convert to list of dicts
    data = []
    for row in results:
        data.append({
            'category': row.category,
            'total': row.total,
            'count': row.count,
        })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    if len(df) == 0:
        return pd.DataFrame(columns=['category', 'total', 'count', 'percent'])
    
    # Calculate percentage
    total = df['total'].sum()
    if total > 0:
        df['percent'] = (df['total'] / total * 100).round(2)
    else:
        df['percent'] = 0.0
    
    # Sort by total descending
    df = df.sort_values('total', ascending=False).reset_index(drop=True)
    
    return df[['category', 'total', 'count', 'percent']]


def summarize_by_subcategory(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by subcategory (accounting classification).
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: category, subcategory, total, count, percent
    """
    # Group by subcategory_id directly (every transaction has exactly one subcategory)
    query = session.query(
        Category.name.label('category'),
        Subcategory.name.label('subcategory'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).select_from(Transaction).join(Transaction.subcategory).join(Subcategory.category).group_by(
        Category.id, Category.name, Subcategory.id, Subcategory.name
    )
    query = _exclude_payment_transactions(query)
    
    # Apply filters
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
    
    results = query.all()
    
    # Convert to list of dicts
    data = []
    for row in results:
        data.append({
            'category': row.category,
            'subcategory': row.subcategory,
            'total': row.total,
            'count': row.count,
        })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    if len(df) == 0:
        return pd.DataFrame(columns=['category', 'subcategory', 'total', 'count', 'percent'])
    
    # Calculate percentage
    total = df['total'].sum()
    if total > 0:
        df['percent'] = (df['total'] / total * 100).round(2)
    else:
        df['percent'] = 0.0
    
    # Sort by total descending
    df = df.sort_values('total', ascending=False).reset_index(drop=True)
    
    return df[['category', 'subcategory', 'total', 'count', 'percent']]


def export_summary(
    tag_df: pd.DataFrame,
    category_df: pd.DataFrame,
    range_name: str,
    output_dir: str = 'data',
) -> Tuple[str, str]:
    """
    Export tag and category summaries to CSV.
    
    Args:
        tag_df: DataFrame from summarize_by_tag()
        category_df: DataFrame from summarize_by_category()
        range_name: Name of the range (e.g., "current_month", "current_year")
        output_dir: Directory for output files
        
    Returns:
        Tuple of (tag_file_path, category_file_path)
    """
    import os
    from datetime import datetime
    
    os.makedirs(output_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    tag_filename = os.path.join(output_dir, f'summary_tags_{range_name}_{timestamp}.csv')
    category_filename = os.path.join(output_dir, f'summary_categories_{range_name}_{timestamp}.csv')
    
    tag_df.to_csv(tag_filename, index=False)
    category_df.to_csv(category_filename, index=False)
    
    return tag_filename, category_filename


def transactions_to_dataframe(transactions: List[Transaction]) -> pd.DataFrame:
    """Convert transactions to a DataFrame matching transaction views."""
    data = []
    for txn in transactions:
        data.append({
            'Date': txn.date,
            'Merchant': txn.merchant,
            'Amount': float(txn.amount),
            'Notes': txn.notes or '',
            'Account': txn.account.name if txn.account else '',
            'Category': txn.category.name if txn.category else 'None',
            'Subcategory': txn.subcategory.name if txn.subcategory else 'None',
            'Tags': ', '.join([t.name for t in txn.tags]) or 'None',
        })

    return pd.DataFrame(data, columns=['Date', 'Merchant', 'Amount', 'Notes', 'Account', 'Category', 'Subcategory', 'Tags'])


def export_transactions(
    transactions: List[Transaction],
    range_name: str,
    output_dir: str = 'data',
) -> str:
    """Export transaction-level view data to CSV."""
    import os
    from datetime import datetime

    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.join(output_dir, f'transactions_{range_name}_{timestamp}.csv')

    df = transactions_to_dataframe(transactions)
    df.to_csv(filename, index=False)

    return filename
