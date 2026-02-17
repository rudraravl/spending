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
from sqlalchemy import func, or_
from db.models import Transaction, Tag, Category
from utils.filters import TransactionFilter


def calculate_total(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Calculate total spending for transactions matching filters.
    
    NOTE: This sums ALL amounts (positive charges + negative payments/credits).
    If you want only charges, add a filter: Transaction.amount > 0
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        Total amount (sum of all transaction amounts, including negative values)
    """
    query = session.query(func.sum(Transaction.amount))
    
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
    
    result = query.scalar()
    return float(result) if result else 0.0


def summarize_by_tag(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by tag.
    
    NOTE: This sums ALL amounts (positive charges + negative payments/credits).
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: category, tag, total, count, percent
    """
    # Get all transactions matching filters
    query = session.query(
        Tag.id.label('tag_id'),
        Category.name.label('category'),
        Tag.name.label('tag'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).join(Transaction.tags).join(Tag.category).group_by(Tag.id, Category.name, Tag.name)
    
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
        
        if filters.tag_ids:
            query = query.filter(Tag.id.in_(filters.tag_ids))
        
        if filters.category_id:
            query = query.filter(Tag.category_id == filters.category_id)
    
    results = query.all()
    
    # Convert to list of dicts
    data = []
    for row in results:
        data.append({
            'category': row.category,
            'tag': row.tag,
            'total': row.total,
            'count': row.count,
        })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    if len(df) == 0:
        return pd.DataFrame(columns=['category', 'tag', 'total', 'count', 'percent'])
    
    # Calculate percentage
    total = df['total'].sum()
    if total > 0:
        df['percent'] = (df['total'] / total * 100).round(2)
    else:
        df['percent'] = 0.0
    
    # Sort by total descending
    df = df.sort_values('total', ascending=False).reset_index(drop=True)
    
    return df[['category', 'tag', 'total', 'count', 'percent']]


def summarize_by_category(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by category.
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: category, total, count, percent
    """
    tagged_query = session.query(
        Category.id.label('category_id'),
        Category.name.label('category'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).select_from(Transaction).join(Transaction.tags).join(Tag.category).group_by(Category.id, Category.name)

    untagged_query = session.query(
        Category.id.label('category_id'),
        Category.name.label('category'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).select_from(Transaction).join(Transaction.category).filter(~Transaction.tags.any()).group_by(Category.id, Category.name)
    
    # Apply filters
    if filters:
        if filters.start_date:
            tagged_query = tagged_query.filter(Transaction.date >= filters.start_date)
            untagged_query = untagged_query.filter(Transaction.date >= filters.start_date)
        
        if filters.end_date:
            tagged_query = tagged_query.filter(Transaction.date <= filters.end_date)
            untagged_query = untagged_query.filter(Transaction.date <= filters.end_date)
        
        if filters.account_id:
            tagged_query = tagged_query.filter(Transaction.account_id == filters.account_id)
            untagged_query = untagged_query.filter(Transaction.account_id == filters.account_id)
        
        if filters.min_amount is not None:
            tagged_query = tagged_query.filter(Transaction.amount >= filters.min_amount)
            untagged_query = untagged_query.filter(Transaction.amount >= filters.min_amount)
        
        if filters.max_amount is not None:
            tagged_query = tagged_query.filter(Transaction.amount <= filters.max_amount)
            untagged_query = untagged_query.filter(Transaction.amount <= filters.max_amount)
        
        if filters.tag_ids:
            tagged_query = tagged_query.filter(Tag.id.in_(filters.tag_ids))
            untagged_query = untagged_query.filter(False)
        
        if filters.category_id:
            tagged_query = tagged_query.filter(Category.id == filters.category_id)
            untagged_query = untagged_query.filter(Category.id == filters.category_id)
    
    results = tagged_query.all() + untagged_query.all()
    
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

    df = (
        df.groupby('category', as_index=False)
        .agg({'total': 'sum', 'count': 'sum'})
    )
    
    # Calculate percentage
    total = df['total'].sum()
    if total > 0:
        df['percent'] = (df['total'] / total * 100).round(2)
    else:
        df['percent'] = 0.0
    
    # Sort by total descending
    df = df.sort_values('total', ascending=False).reset_index(drop=True)
    
    return df[['category', 'total', 'count', 'percent']]


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
        categories = sorted({t.category.name for t in txn.tags})
        category_name = categories[0] if len(categories) == 1 else (txn.category.name if txn.category else 'None')
        data.append({
            'Date': txn.date,
            'Merchant': txn.merchant,
            'Amount': float(txn.amount),
            'Notes': txn.notes or '',
            'Account': txn.account.name if txn.account else '',
            'Category': category_name,
            'Tags': ', '.join([t.name for t in txn.tags]) or 'None',
        })

    return pd.DataFrame(data, columns=['Date', 'Merchant', 'Amount', 'Notes', 'Account', 'Category', 'Tags'])


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
