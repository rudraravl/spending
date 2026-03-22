from __future__ import annotations

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
    calculate_gross_spending,
    calculate_total,
    calculate_total_income,
    summarize_by_category,
    summarize_by_subcategory,
    summarize_by_tag,
)
from utils.filters import TransactionFilter
from utils.semester import (
    get_current_month_range,
    get_current_semester_range,
    get_current_year_range,
    get_last_month_range,
)


router = APIRouter(tags=["reports"])


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
    filters = TransactionFilter(start_date=start, end_date=end)

    # Gross outflows vs credits: sum(amount) would net credits into spending and also
    # count them in total_income, inflating net = income - spending. Use positive amounts only.
    total_spending = calculate_gross_spending(session, filters)
    total_income = calculate_total_income(session, filters)

    by_category_df = summarize_by_category(session, filters)
    by_subcategory_df = summarize_by_subcategory(session, filters)

    trend_txns = get_transactions(
        session,
        filters=filters,
        include_transfers=False,
    )
    daily: dict[date, float] = {}
    for t in trend_txns:
        daily[t.date] = daily.get(t.date, 0.0) + float(t.amount)

    spending_over_time = [
        {"date": d.isoformat(), "amount": amt}
        for d, amt in sorted(daily.items(), key=lambda x: x[0])
    ]

    recent_txns = get_transactions(
        session,
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


@router.get("/api/views", status_code=status.HTTP_200_OK)
def views(
    # Date range required
    start_date: date = Query(...),
    end_date: date = Query(...),
    account_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    subcategory_id: int | None = Query(default=None),
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
        tag_ids=tag_ids if tag_ids else None,
        tags_match_any=tags_match_any,
        min_amount=min_amount,
        max_amount=max_amount,
    )

    # Matches Streamlit: exclude transfers from views.
    transactions = get_transactions(session, filters=filters, include_transfers=False)

    total = calculate_total(session, filters)

    # Daily chart: exclude payments AND rent (Streamlit UI-only logic)
    exclude_subcategories = {"payments", "rent"}
    daily: dict[date, float] = {}
    for t in transactions:
        sub = t.subcategory.name.lower() if t.subcategory and t.subcategory.name else ""
        if sub in exclude_subcategories:
            continue
        daily[t.date] = daily.get(t.date, 0.0) + float(t.amount)

    spending_over_time = [
        {"date": d.isoformat(), "amount": amt}
        for d, amt in sorted(daily.items(), key=lambda x: x[0])
    ]

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

