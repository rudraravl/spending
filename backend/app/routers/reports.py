from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from db.models import Transaction
from services.trasaction_service import get_transactions
from services.summary_service import (
    average_transaction_abs_amount,
    calculate_net_spending_excluding_income,
    calculate_total,
    calculate_total_income,
    cumulative_spending_by_day_of_month,
    daily_net_spending_non_income_by_date,
    dashboard_bilateral_daily_series,
    filter_dashboard_breakdowns,
    net_spending_daily_series,
    summarize_by_category,
    summarize_by_subcategory,
    summarize_by_tag,
)
from services.net_worth_service import net_worth_history
from utils.filters import TransactionFilter
from utils.semester import (
    get_calendar_month_range,
    get_current_month_range,
    get_current_semester_range,
    get_current_year_range,
    get_last_month_range,
    shift_calendar_month,
)


router = APIRouter(tags=["reports"])

_NO_INVEST = ("investment",)


def _jsonify(v: Any) -> object:
    if v is None:
        return None
    if isinstance(v, (np.integer, np.floating)):
        return v.item()
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            pass
    return v


def _df_to_records(df: pd.DataFrame) -> list[dict[str, object]]:
    if df is None:
        return []
    if df.empty:
        return []
    records: list[dict[str, object]] = []
    for row in df.to_dict(orient="records"):
        records.append({k: _jsonify(v) for k, v in row.items()})
    return records


def _transaction_table_row(txn: Transaction) -> dict[str, object]:
    category = txn.category.name if txn.category else "None"
    subcategory = txn.subcategory.name if txn.subcategory else "None"
    tags = ", ".join([t.name for t in (txn.tags or [])]) or "None"
    account_name = txn.account.name if getattr(txn, "account", None) else ""
    return {
        "id": txn.id,
        "Date": txn.date.isoformat(),
        "Merchant": txn.merchant,
        "Amount": float(txn.amount),
        "Category": category,
        "Subcategory": subcategory,
        "Tags": tags,
        "Notes": txn.notes or "",
        "Acct": account_name,
        "is_transfer": bool(getattr(txn, "is_transfer", False)),
    }


def _resolve_dashboard_range(
    range_preset: str,
    start_date: date | None,
    end_date: date | None,
) -> tuple[date, date]:
    if range_preset == "this_month":
        return get_current_month_range()
    if range_preset == "last_month":
        return get_last_month_range()
    if range_preset == "year":
        return get_current_year_range()
    if range_preset == "custom":
        if not start_date or not end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_date and end_date are required when range=custom",
            )
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_date must be on or before end_date",
            )
        return start_date, end_date
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid range; use this_month, last_month, year, or custom",
    )


@router.get("/api/dashboard", status_code=status.HTTP_200_OK)
def dashboard(
    range_preset: str = Query(
        "this_month",
        alias="range",
        description="this_month|last_month|year|custom",
    ),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    start, end = _resolve_dashboard_range(range_preset, start_date, end_date)
    filters = TransactionFilter(start_date=start, end_date=end, exclude_account_types=_NO_INVEST)

    # Net non-Income spending vs Income-category totals (split-aware in services).
    total_spending = calculate_net_spending_excluding_income(session, filters)
    total_income = calculate_total_income(session, filters)

    by_category_df = summarize_by_category(session, filters)
    by_subcategory_df = summarize_by_subcategory(session, filters)
    by_category_df, by_subcategory_df = filter_dashboard_breakdowns(
        by_category_df, by_subcategory_df
    )

    trend_txns = get_transactions(
        session,
        filters=filters,
        include_transfers=False,
    )
    spending_over_time = dashboard_bilateral_daily_series(
        trend_txns,
        start,
        end,
    )

    recent_txns = get_transactions(
        session,
        filters=TransactionFilter(exclude_account_types=_NO_INVEST),
        limit=10,
        include_transfers=False,
    )
    recent_transactions = [_transaction_table_row(t) for t in recent_txns]

    return {
        "range": range_preset,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total_spending": total_spending,
        "total_income": total_income,
        "net_worth_over_time": net_worth_history(session, start=start, end=end),
        "by_category": _df_to_records(by_category_df),
        "by_subcategory": _df_to_records(by_subcategory_df),
        "spending_over_time": spending_over_time,
        "recent_transactions": recent_transactions,
    }


@router.get("/api/summaries", status_code=status.HTTP_200_OK)
def summaries(
    range_type: str = Query(..., description="month|year|semester|custom"),
    # custom range
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if range_type == "month":
        start, end = get_current_month_range()
    elif range_type == "year":
        start, end = get_current_year_range()
    elif range_type == "semester":
        start, end = get_current_semester_range()
    elif range_type == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date and end_date are required for custom")
        start, end = start_date, end_date
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid range_type")

    filters = TransactionFilter(start_date=start, end_date=end)

    total = calculate_total(session, filters)
    by_tag_df = summarize_by_tag(session, filters)
    by_category_df = summarize_by_category(session, filters)
    by_subcategory_df = summarize_by_subcategory(session, filters)

    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total": total,
        "by_tag": _df_to_records(by_tag_df),
        "by_category": _df_to_records(by_category_df),
        "by_subcategory": _df_to_records(by_subcategory_df),
    }


@router.get("/api/reports/monthly", status_code=status.HTTP_200_OK)
def reports_monthly(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    """
    Calendar month rollup for the Reports page: KPIs, cumulative vs prior month,
    and category/tag/subcategory breakdowns (transfers excluded; investment accounts excluded).
    """
    today = date.today()
    y = year if year is not None else today.year
    m = month if month is not None else today.month
    start, end = get_calendar_month_range(y, m)

    py, pm = shift_calendar_month(y, m, -1)
    prev_start, prev_end = get_calendar_month_range(py, pm)

    filters = TransactionFilter(
        start_date=start,
        end_date=end,
        exclude_account_types=_NO_INVEST,
    )
    prev_filters = TransactionFilter(
        start_date=prev_start,
        end_date=prev_end,
        exclude_account_types=_NO_INVEST,
    )

    total_spending = calculate_net_spending_excluding_income(session, filters)
    total_income = calculate_total_income(session, filters)
    avg_abs, txn_count = average_transaction_abs_amount(session, filters)

    savings_rate_pct: float | None
    if total_income > 0:
        savings_rate_pct = (total_income - total_spending) / total_income * 100.0
    else:
        savings_rate_pct = None

    daily_this = daily_net_spending_non_income_by_date(session, filters)
    daily_prev = daily_net_spending_non_income_by_date(session, prev_filters)
    cum_this = cumulative_spending_by_day_of_month(daily_this, start)
    cum_prev = cumulative_spending_by_day_of_month(daily_prev, prev_start)

    dim_this = monthrange(y, m)[1]
    dim_prev = monthrange(py, pm)[1]
    if y > today.year or (y == today.year and m > today.month):
        effective_this = 0
    elif y == today.year and m == today.month:
        effective_this = min(today.day, dim_this)
    else:
        effective_this = dim_this

    cumulative_comparison: list[dict[str, object]] = []
    for dom in range(1, 32):
        this_v: float | None
        if effective_this > 0 and dom <= effective_this:
            this_v = float(cum_this[dom - 1])
        else:
            this_v = None
        last_v: float | None
        if dom <= dim_prev:
            last_v = float(cum_prev[dom - 1])
        else:
            last_v = None
        cumulative_comparison.append(
            {
                "day_of_month": dom,
                "this_month": this_v,
                "last_month": last_v,
            }
        )

    by_tag_df = summarize_by_tag(session, filters)
    by_category_df = summarize_by_category(session, filters)
    by_subcategory_df = summarize_by_subcategory(session, filters)
    by_category_df, by_subcategory_df = filter_dashboard_breakdowns(
        by_category_df, by_subcategory_df
    )

    return {
        "year": y,
        "month": m,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "prev_month_year": py,
        "prev_month": pm,
        "total_spending": total_spending,
        "total_income": total_income,
        "avg_transaction_amount": avg_abs,
        "transaction_count": txn_count,
        "savings_rate_pct": savings_rate_pct,
        "cumulative_comparison": cumulative_comparison,
        "by_tag": _df_to_records(by_tag_df),
        "by_category": _df_to_records(by_category_df),
        "by_subcategory": _df_to_records(by_subcategory_df),
    }


@router.get("/api/reports/net-worth", status_code=status.HTTP_200_OK)
def net_worth_history_endpoint(
    start_date: date = Query(..., description="YYYY-MM-DD"),
    end_date: date = Query(..., description="YYYY-MM-DD"),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must be on or before end_date",
        )

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "net_worth_over_time": net_worth_history(session, start=start_date, end=end_date),
    }


@router.get("/api/views", status_code=status.HTTP_200_OK)
def views(
    # Date range required
    start_date: date = Query(...),
    end_date: date = Query(...),
    account_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    subcategory_id: int | None = Query(default=None),
    subcategory_ids: list[int] | None = Query(default=None),
    tag_ids: list[int] | None = Query(default=None),
    tags_match_any: bool = Query(default=False),
    min_amount: float | None = Query(default=None),
    max_amount: float | None = Query(default=None),
    session: Session = Depends(get_db_session),
) -> dict[str, object]:
    filters = TransactionFilter(
        start_date=start_date,
        end_date=end_date,
        account_id=account_id,
        category_id=category_id,
        subcategory_id=subcategory_id,
        subcategory_ids=subcategory_ids if subcategory_ids else None,
        tag_ids=tag_ids if tag_ids else None,
        tags_match_any=tags_match_any,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    # Exclude transfers from views.
    transactions = get_transactions(session, filters=filters, include_transfers=False)

    total = calculate_total(session, filters)

    # Daily chart: gross outflows; exclude rent.
    exclude_subcategories = {"rent"}
    spending_over_time = net_spending_daily_series(
        transactions,
        exclude_subcategory_names=exclude_subcategories,
    )

    by_tag_df = summarize_by_tag(session, filters)
    by_category_df = summarize_by_category(session, filters)
    by_subcategory_df = summarize_by_subcategory(session, filters)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "filters": {
            "account_id": account_id,
            "category_id": category_id,
            "subcategory_id": subcategory_id,
            "subcategory_ids": subcategory_ids,
            "tag_ids": tag_ids,
            "tags_match_any": tags_match_any,
            "min_amount": min_amount,
            "max_amount": max_amount,
        },
        "total": total,
        "transaction_count": len(transactions),
        "spending_over_time": spending_over_time,
        "by_tag": _df_to_records(by_tag_df),
        "by_category": _df_to_records(by_category_df),
        "by_subcategory": _df_to_records(by_subcategory_df),
        "transactions": [_transaction_table_row(t) for t in transactions],
    }

