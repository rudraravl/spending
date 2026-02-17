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
from sqlalchemy import func
from db.models import Transaction, Tag, Category
from utils.filters import TransactionFilter


def calculate_total(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Calculate total spending for transactions matching filters.
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        Total amount (sum of all transaction amounts)
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
                Transaction.tags.any(Tag.category_id == filters.category_id)
            )
    
    result = query.scalar()
    return float(result) if result else 0.0


def summarize_by_tag(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by tag.
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: tag, total, percent
    """
    # Get all transactions matching filters
    query = session.query(
        Tag.id.label('tag_id'),
        Tag.name.label('tag'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).join(Transaction.tags).group_by(Tag.id, Tag.name)
    
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
    Summarize spending by category.
    
    Args:
        session: Database session
        filters: TransactionFilter object
        
    Returns:
        DataFrame with columns: category, total, count, percent
    """
    query = session.query(
        Category.id.label('category_id'),
        Category.name.label('category'),
        func.sum(Transaction.amount).label('total'),
        func.count(Transaction.id).label('count'),
    ).join(Tag, Category.id == Tag.category_id).join(Transaction.tags).group_by(Category.id, Category.name)
    
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
            query = query.filter(Category.id == filters.category_id)
    
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
