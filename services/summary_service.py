"""
Summary Service - Aggregation and summary calculations.

Provides:
- Summaries grouped by tag
- Summaries grouped by category
- Total spend calculation
- Export to CSV format
"""

from datetime import date, timedelta
from typing import Dict, List, Optional, Set, Tuple
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, union_all
from db.models import Transaction, Tag, Category, Subcategory, TransactionSplit
from utils.filters import TransactionFilter


# Dashboard income totals use this category only (split-aware); refunds stay in spend categories.
INCOME_CATEGORY_NAME = "Income"


def _exclude_non_spend_transactions(query):
    """
    Exclude non-spending activity from aggregates:
    - Transfers (is_transfer = TRUE)

    Card paydowns should be recorded as transfers between bank and credit accounts.
    """
    return query.filter(Transaction.is_transfer.is_(False))


def _apply_filters_base(query, filters: Optional[TransactionFilter]):
    """Apply Transaction-based filters (dates, account, tags, category, subcategory, amount)."""
    if not filters:
        return query

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

    # Tag filters
    if filters.tag_ids:
        if getattr(filters, "tags_match_any", False):
            query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
        else:
            for tag_id in filters.tag_ids:
                query = query.filter(Transaction.tags.any(Tag.id == tag_id))

    # Category / subcategory filters (for unsplit transactions)
    if filters.category_id:
        query = query.filter(Transaction.category_id == filters.category_id)

    if filters.subcategory_id:
        query = query.filter(Transaction.subcategory_id == filters.subcategory_id)

    return query


def _apply_filters_splits(query, filters: Optional[TransactionFilter]):
    """
    Apply filters for split-based queries.

    Date/account/amount/tag filters still apply at the Transaction level.
    Category/subcategory filters apply at the split level.
    """
    if not filters:
        return query

    # Transaction-level dimensions
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

    # Tag filters on parent transaction
    if filters.tag_ids:
        if getattr(filters, "tags_match_any", False):
            query = query.filter(Transaction.tags.any(Tag.id.in_(filters.tag_ids)))
        else:
            for tag_id in filters.tag_ids:
                query = query.filter(Transaction.tags.any(Tag.id == tag_id))

    # Category / subcategory filters on splits
    if filters.category_id:
        query = query.filter(TransactionSplit.category_id == filters.category_id)

    if filters.subcategory_id:
        query = query.filter(TransactionSplit.subcategory_id == filters.subcategory_id)

    return query


def calculate_total(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Net sum of all matching transaction amounts (inflows and outflows).

    Cash-flow convention: positive = inflow, negative = outflow. Net total is the
    signed sum. For dashboard headline totals, use calculate_net_spending_excluding_income
    and calculate_total_income (Income category only; refunds offset in non-Income categories).

    NOTE: Transfers are excluded from totals.

    Args:
        session: Database session
        filters: TransactionFilter object

    Returns:
        Net total (signed sum of matching non-transfer transaction amounts)
    """
    query = session.query(func.sum(Transaction.amount))
    query = _exclude_non_spend_transactions(query)
    
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


def calculate_net_spending_excluding_income(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Net cash flow for non-Income categories, split-aware, as a spending headline.

    Sums signed amounts on split rows and unsplit transactions whose category is not
    Income (uncategorized parents count as non-Income). Returns **minus** that sum so
    positive values mean net outflow; negative means net inflow (e.g. refunds) in
    non-Income categories.

    Same exclusions as calculate_total (no transfers).
    """
    split_q = (
        session.query(TransactionSplit.amount.label("amount"))
        .select_from(TransactionSplit)
        .join(TransactionSplit.category)
        .join(TransactionSplit.transaction)
        .filter(Category.name != INCOME_CATEGORY_NAME)
    )
    split_q = _exclude_non_spend_transactions(split_q)
    split_q = _apply_filters_splits(split_q, filters)

    base_q = (
        session.query(Transaction.amount.label("amount"))
        .select_from(Transaction)
        .outerjoin(Transaction.category)
        .filter(~Transaction.splits.any())
        .filter(
            or_(Category.id.is_(None), Category.name != INCOME_CATEGORY_NAME),
        )
    )
    base_q = _exclude_non_spend_transactions(base_q)
    base_q = _apply_filters_base(base_q, filters)

    combined = union_all(split_q, base_q).subquery("non_income_rows")
    raw_sum = session.query(func.coalesce(func.sum(combined.c.amount), 0.0)).scalar()
    s = float(raw_sum) if raw_sum is not None else 0.0
    return -s


def calculate_total_income(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> float:
    """
    Signed sum of amounts allocated to the Income category (split-aware).

    Paychecks and other Income-category rows only; refunds in other categories are
    excluded from this total. Same exclusions as calculate_total (no transfers).
    """
    split_q = (
        session.query(TransactionSplit.amount.label("amount"))
        .select_from(TransactionSplit)
        .join(TransactionSplit.category)
        .join(TransactionSplit.transaction)
        .filter(Category.name == INCOME_CATEGORY_NAME)
    )
    split_q = _exclude_non_spend_transactions(split_q)
    split_q = _apply_filters_splits(split_q, filters)

    base_q = (
        session.query(Transaction.amount.label("amount"))
        .select_from(Transaction)
        .join(Transaction.category)
        .filter(~Transaction.splits.any())
        .filter(Category.name == INCOME_CATEGORY_NAME)
    )
    base_q = _exclude_non_spend_transactions(base_q)
    base_q = _apply_filters_base(base_q, filters)

    combined = union_all(split_q, base_q).subquery("income_rows")
    result = session.query(func.coalesce(func.sum(combined.c.amount), 0.0)).scalar()
    return float(result) if result is not None else 0.0


def filter_dashboard_breakdowns(
    by_category_df: pd.DataFrame,
    by_subcategory_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Drop Income from dashboard category/subcategory frames and recompute percents
    over the remaining rows (spending-focused charts).
    """
    cat = by_category_df.copy() if by_category_df is not None else pd.DataFrame()
    sub = by_subcategory_df.copy() if by_subcategory_df is not None else pd.DataFrame()

    if len(cat) > 0 and "category" in cat.columns:
        cat = cat[cat["category"] != INCOME_CATEGORY_NAME].reset_index(drop=True)
        grand = cat["total"].sum()
        cat["percent"] = (cat["total"] / grand * 100).round(2) if grand != 0 else 0.0

    if len(sub) > 0 and "category" in sub.columns:
        sub = sub[sub["category"] != INCOME_CATEGORY_NAME].reset_index(drop=True)
        grand_sub = sub["total"].sum()
        sub["percent"] = (sub["total"] / grand_sub * 100).round(2) if grand_sub != 0 else 0.0

    return cat, sub


def net_spending_daily_series(
    transactions: List[Transaction],
    *,
    exclude_subcategory_names: Optional[Set[str]] = None,
    exclude_income_category: bool = True,
) -> List[Dict[str, object]]:
    """
    Per-day signed sum of transaction amounts (after exclusions), returned as
    ``amount`` = negative of that sum so positive values mean net outflow.

    Parent transaction amounts only (split allocation not applied here).
    """
    excl = {s.lower() for s in (exclude_subcategory_names or set())}
    daily: Dict = {}
    for t in transactions:
        sub = t.subcategory.name.lower() if t.subcategory and t.subcategory.name else ""
        if sub in excl:
            continue
        if exclude_income_category:
            cat_name = t.category.name if t.category else None
            if cat_name == INCOME_CATEGORY_NAME:
                continue
        raw = float(t.amount)
        daily[t.date] = daily.get(t.date, 0.0) + raw
    return [
        {"date": d.isoformat(), "amount": -amt}
        for d, amt in sorted(daily.items(), key=lambda x: x[0])
    ]


def dashboard_bilateral_daily_series(
    transactions: List[Transaction],
    range_start: date,
    range_end: date,
    *,
    exclude_subcategory_names: Optional[Set[str]] = None,
    exclude_income_category: bool = True,
) -> List[Dict[str, object]]:
    """
    One row per calendar day in ``[range_start, range_end]`` (inclusive).

    ``spending`` = sum of outflow magnitudes that day (non-Income, after exclusions).
    ``credits`` = sum of inflow amounts that day (positive leg, same rules).
    Parent transaction amounts only (splits not allocated here).
    """
    excl = {s.lower() for s in (exclude_subcategory_names or set())}
    spend_by_day: Dict[date, float] = {}
    credit_by_day: Dict[date, float] = {}
    for t in transactions:
        sub = t.subcategory.name.lower() if t.subcategory and t.subcategory.name else ""
        if sub in excl:
            continue
        if exclude_income_category:
            cat_name = t.category.name if t.category else None
            if cat_name == INCOME_CATEGORY_NAME:
                continue
        raw = float(t.amount)
        d = t.date
        if raw < 0:
            spend_by_day[d] = spend_by_day.get(d, 0.0) - raw
        elif raw > 0:
            credit_by_day[d] = credit_by_day.get(d, 0.0) + raw

    out: List[Dict[str, object]] = []
    d = range_start
    step = timedelta(days=1)
    while d <= range_end:
        out.append(
            {
                "date": d.isoformat(),
                "spending": float(spend_by_day.get(d, 0.0)),
                "credits": float(credit_by_day.get(d, 0.0)),
            }
        )
        d += step
    return out


def summarize_by_tag(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by tag (contextual reporting only, tags have no accounting meaning).

    NOTE: Transfers are excluded from this summary.

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
    query = _exclude_non_spend_transactions(query)
    
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
    
    # Calculate percentage (totals may be negative under cash-flow for spending)
    total = df['total'].sum()
    if total != 0:
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
    Summarize spending by category (accounting classification), split-aware.

    If a transaction has splits, its amount is allocated by split rows.
    Otherwise, the transaction's own category is used.
    """
    # 1) Rows from splits
    split_q = (
        session.query(
            Category.id.label("category_id"),
            Category.name.label("category"),
            TransactionSplit.amount.label("amount"),
        )
        .select_from(TransactionSplit)
        .join(TransactionSplit.category)
        .join(TransactionSplit.transaction)
    )
    split_q = _exclude_non_spend_transactions(split_q)
    split_q = _apply_filters_splits(split_q, filters)

    # 2) Rows from unsplit transactions (no splits)
    base_q = (
        session.query(
            Category.id.label("category_id"),
            Category.name.label("category"),
            Transaction.amount.label("amount"),
        )
        .select_from(Transaction)
        .join(Transaction.category)
        .filter(~Transaction.splits.any())
    )
    base_q = _exclude_non_spend_transactions(base_q)
    base_q = _apply_filters_base(base_q, filters)

    combined = union_all(split_q, base_q).subquery("cat_rows")

    agg_q = (
        session.query(
            combined.c.category_id,
            combined.c.category,
            func.sum(combined.c.amount).label("total"),
            func.count().label("count"),
        )
        .group_by(combined.c.category_id, combined.c.category)
        .order_by(func.sum(combined.c.amount).desc())
    )

    results = agg_q.all()

    data = [
        {
            "category_id": row.category_id,
            "category": row.category,
            "total": row.total,
            "count": row.count,
        }
        for row in results
    ]

    df = pd.DataFrame(data)
    if len(df) == 0:
        return pd.DataFrame(columns=["category_id", "category", "total", "count", "percent"])

    total = df["total"].sum()
    df["percent"] = (df["total"] / total * 100).round(2) if total != 0 else 0.0
    df = df.sort_values("total", ascending=False).reset_index(drop=True)

    return df[["category_id", "category", "total", "count", "percent"]]


def summarize_by_subcategory(
    session: Session,
    filters: Optional[TransactionFilter] = None,
) -> pd.DataFrame:
    """
    Summarize spending by subcategory, split-aware.

    If a transaction has splits, its amount is allocated by split rows.
    Otherwise, the transaction's own subcategory is used.
    """
    # 1) Rows from splits
    split_q = (
        session.query(
            Category.id.label("category_id"),
            Category.name.label("category"),
            Subcategory.name.label("subcategory"),
            TransactionSplit.amount.label("amount"),
        )
        .select_from(TransactionSplit)
        .join(TransactionSplit.category)
        .join(TransactionSplit.subcategory)
        .join(TransactionSplit.transaction)
    )
    split_q = _exclude_non_spend_transactions(split_q)
    split_q = _apply_filters_splits(split_q, filters)

    # 2) Rows from unsplit transactions
    base_q = (
        session.query(
            Category.id.label("category_id"),
            Category.name.label("category"),
            Subcategory.name.label("subcategory"),
            Transaction.amount.label("amount"),
        )
        .select_from(Transaction)
        .join(Transaction.subcategory)
        .join(Subcategory.category)
        .filter(~Transaction.splits.any())
    )
    base_q = _exclude_non_spend_transactions(base_q)
    base_q = _apply_filters_base(base_q, filters)

    combined = union_all(split_q, base_q).subquery("subcat_rows")

    agg_q = (
        session.query(
            combined.c.category_id,
            combined.c.category,
            combined.c.subcategory,
            func.sum(combined.c.amount).label("total"),
            func.count().label("count"),
        )
        .group_by(
            combined.c.category_id,
            combined.c.category,
            combined.c.subcategory,
        )
        .order_by(func.sum(combined.c.amount).desc())
    )

    results = agg_q.all()

    data = [
        {
            "category_id": row.category_id,
            "category": row.category,
            "subcategory": row.subcategory,
            "total": row.total,
            "count": row.count,
        }
        for row in results
    ]

    df = pd.DataFrame(data)
    if len(df) == 0:
        return pd.DataFrame(
            columns=[
                "category_id",
                "category",
                "subcategory",
                "total",
                "count",
                "percent",
            ]
        )

    total = df["total"].sum()
    df["percent"] = (df["total"] / total * 100).round(2) if total != 0 else 0.0
    df = df.sort_values("total", ascending=False).reset_index(drop=True)

    return df[
        ["category_id", "category", "subcategory", "total", "count", "percent"]
    ]


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