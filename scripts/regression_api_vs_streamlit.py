from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from backend.main import app
from db.database import close_session, get_session, init_db
from db.models import Account, Tag
from services.trasaction_service import get_transactions
from backend.app.routers import reports as reports_router
from services.summary_service import (
    PAYMENT_SUBCATEGORY_NAMES,
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


def _jsonify(v: Any) -> object:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass

    if isinstance(v, (np.integer, np.floating)):
        return v.item()
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except Exception:
            pass
    return v


def _df_to_records(df: pd.DataFrame) -> list[dict[str, object]]:
    if df is None or df.empty:
        return []
    return [{k: _jsonify(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


def _assert_close(a: Any, b: Any, eps: float = 1e-6) -> None:
    if a is None and b is None:
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(float(a)) and math.isnan(float(b)):
            return
        if abs(float(a) - float(b)) > eps:
            raise AssertionError(f"Expected {a} ~= {b} (eps={eps})")
        return
    if a != b:
        raise AssertionError(f"Expected {a} == {b}")


def _assert_records_match(got: list[dict[str, object]], exp: list[dict[str, object]], float_eps: float = 1e-6) -> None:
    if len(got) != len(exp):
        raise AssertionError(f"Record length mismatch: got {len(got)} exp {len(exp)}")
    for i in range(len(exp)):
        g = got[i]
        e = exp[i]
        if g.keys() != e.keys():
            raise AssertionError(f"Key mismatch at index {i}: got {sorted(g.keys())} exp {sorted(e.keys())}")
        for k in e.keys():
            _assert_close(g[k], e[k], eps=float_eps)


def compute_expected_dashboard(
    session,
    range_preset: str,
    *,
    custom_start: date | None = None,
    custom_end: date | None = None,
) -> dict[str, object]:
    if range_preset == "this_month":
        start, end = get_current_month_range()
    elif range_preset == "last_month":
        start, end = get_last_month_range()
    elif range_preset == "year":
        start, end = get_current_year_range()
    elif range_preset == "custom":
        if not custom_start or not custom_end:
            raise ValueError("custom_start and custom_end required for custom range")
        start, end = custom_start, custom_end
    else:
        raise ValueError(f"Unsupported dashboard range: {range_preset}")

    filters = TransactionFilter(start_date=start, end_date=end)
    total_spending = calculate_gross_spending(session, filters)
    total_income = calculate_total_income(session, filters)
    by_category = summarize_by_category(session, filters)
    by_subcategory = summarize_by_subcategory(session, filters)

    trend_txns = get_transactions(session, filters=filters, include_transfers=False)
    daily: dict[date, float] = {}
    for t in trend_txns:
        sub = t.subcategory.name.lower() if t.subcategory and t.subcategory.name else ""
        if sub in PAYMENT_SUBCATEGORY_NAMES:
            continue
        raw = float(t.amount)
        if raw < 0:
            daily[t.date] = daily.get(t.date, 0.0) - raw
    spending_over_time = [
        {"date": d.isoformat(), "amount": amt}
        for d, amt in sorted(daily.items(), key=lambda x: x[0])
    ]

    recent_txns = get_transactions(session, limit=10, include_transfers=False)
    recent_transactions = [reports_router._transaction_table_row(t) for t in recent_txns]

    return {
        "range": range_preset,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total_spending": total_spending,
        "total_income": total_income,
        "by_category": _df_to_records(by_category),
        "by_subcategory": _df_to_records(by_subcategory),
        "spending_over_time": spending_over_time,
        "recent_transactions": recent_transactions,
    }


def compute_expected_summaries(session, range_type: str) -> dict[str, object]:
    if range_type == "month":
        start, end = get_current_month_range()
    elif range_type == "year":
        start, end = get_current_year_range()
    elif range_type == "semester":
        start, end = get_current_semester_range()
    else:
        raise ValueError(f"Unsupported range_type: {range_type}")

    filters = TransactionFilter(start_date=start, end_date=end)
    total = calculate_total(session, filters)
    by_tag = summarize_by_tag(session, filters)
    by_category = summarize_by_category(session, filters)
    by_subcategory = summarize_by_subcategory(session, filters)
    return {
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total": total,
        "by_tag": _df_to_records(by_tag),
        "by_category": _df_to_records(by_category),
        "by_subcategory": _df_to_records(by_subcategory),
    }


def compute_expected_views(session, *, start_date: date, end_date: date, account_id: int | None, tag_ids: list[int] | None, tags_match_any: bool) -> dict[str, object]:
    filters = TransactionFilter(
        start_date=start_date,
        end_date=end_date,
        account_id=account_id,
        tag_ids=tag_ids if tag_ids else None,
        tags_match_any=tags_match_any,
    )

    transactions = get_transactions(session, filters=filters, include_transfers=False)
    total = calculate_total(session, filters)

    exclude_subcategories = {"payments", "rent"}
    daily: dict[date, float] = {}
    for t in transactions:
        sub = t.subcategory.name.lower() if t.subcategory and t.subcategory.name else ""
        if sub in exclude_subcategories:
            continue
        raw = float(t.amount)
        if raw < 0:
            daily[t.date] = daily.get(t.date, 0.0) - raw

    spending_over_time = [{"date": d.isoformat(), "amount": amt} for d, amt in sorted(daily.items(), key=lambda x: x[0])]

    by_tag = summarize_by_tag(session, filters)
    by_category = summarize_by_category(session, filters)
    by_subcategory = summarize_by_subcategory(session, filters)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "total": total,
        "transaction_count": len(transactions),
        "spending_over_time": spending_over_time,
        "by_tag": _df_to_records(by_tag),
        "by_category": _df_to_records(by_category),
        "by_subcategory": _df_to_records(by_subcategory),
    }


def main() -> None:
    init_db()
    session = get_session()
    try:
        client = TestClient(app)

        # Use stable-ish filter ranges (relative to today).
        today = date.today()
        start_date = today - timedelta(days=30)
        end_date = today

        accounts = session.query(Account).order_by(Account.id.asc()).all()
        tags = session.query(Tag).order_by(Tag.id.asc()).all()
        account_id = accounts[0].id if accounts else None
        tag_ids = [tags[0].id] if tags else []

        # --- Dashboard ---
        for preset in ("this_month", "last_month"):
            got_dashboard = client.get(f"/api/dashboard?range={preset}").json()
            exp_dashboard = compute_expected_dashboard(session, preset)
            _assert_close(got_dashboard["range"], exp_dashboard["range"])
            _assert_close(got_dashboard["start_date"], exp_dashboard["start_date"])
            _assert_close(got_dashboard["end_date"], exp_dashboard["end_date"])
            _assert_close(got_dashboard["total_spending"], exp_dashboard["total_spending"])
            _assert_close(got_dashboard["total_income"], exp_dashboard["total_income"])
            _assert_records_match(got_dashboard["by_category"], exp_dashboard["by_category"])
            _assert_records_match(got_dashboard["by_subcategory"], exp_dashboard["by_subcategory"])
            _assert_records_match(got_dashboard["spending_over_time"], exp_dashboard["spending_over_time"])
            _assert_records_match(got_dashboard["recent_transactions"], exp_dashboard["recent_transactions"])

        # --- Summaries ---
        for range_type in ["month", "year", "semester"]:
            got = client.get(f"/api/summaries?range_type={range_type}").json()
            exp = compute_expected_summaries(session, range_type)
            _assert_close(got["total"], exp["total"])
            _assert_close(got["start_date"], exp["start_date"])
            _assert_close(got["end_date"], exp["end_date"])
            _assert_records_match(got["by_tag"], exp["by_tag"])
            _assert_records_match(got["by_category"], exp["by_category"])
            _assert_records_match(got["by_subcategory"], exp["by_subcategory"])

        # --- Views ---
        params: list[tuple[str, str]] = [
            ("start_date", start_date.isoformat()),
            ("end_date", end_date.isoformat()),
        ]
        if account_id is not None:
            params.append(("account_id", str(account_id)))
        if tag_ids:
            for tid in tag_ids:
                params.append(("tag_ids", str(tid)))
        params.append(("tags_match_any", "false"))

        got_views = client.get("/api/views", params=params).json()
        exp_views = compute_expected_views(
            session,
            start_date=start_date,
            end_date=end_date,
            account_id=account_id,
            tag_ids=tag_ids,
            tags_match_any=False,
        )
        _assert_close(got_views["total"], exp_views["total"])
        _assert_close(got_views["transaction_count"], exp_views["transaction_count"])
        _assert_records_match(got_views["spending_over_time"], exp_views["spending_over_time"])
        _assert_records_match(got_views["by_tag"], exp_views["by_tag"])
        _assert_records_match(got_views["by_category"], exp_views["by_category"])
        _assert_records_match(got_views["by_subcategory"], exp_views["by_subcategory"])

        print("Regression check passed.")
    finally:
        close_session(session)


if __name__ == "__main__":
    main()

