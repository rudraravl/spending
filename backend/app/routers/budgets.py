from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import (
    BudgetLimitOut,
    BudgetLimitUpsertIn,
    BudgetMonthOut,
    BudgetProgressOut,
)
from db.models import BudgetLimit, Category, Subcategory
from services.budget_service import (
    budget_progress_for_month,
    delete_budget_category,
    list_limits_for_month,
    normalize_month_start,
    upsert_limits,
)


router = APIRouter(tags=["budgets"])


def _month_start_from_parts(year: int, month: int) -> date:
    if month < 1 or month > 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be 1..12")
    return date(year, month, 1)


def _limit_to_out(l: BudgetLimit, *, cat_name: str | None, sub_name: str | None) -> BudgetLimitOut:
    return BudgetLimitOut(
        id=int(l.id),
        budget_month_id=int(l.budget_month_id),
        category_id=int(l.category_id),
        category_name=cat_name,
        subcategory_id=int(l.subcategory_id) if l.subcategory_id is not None else None,
        subcategory_name=sub_name,
        limit_amount=float(l.limit_amount),
    )


@router.get("/api/budgets/months", response_model=BudgetMonthOut)
def get_budget_month(
    year: int = Query(...),
    month: int = Query(...),
    session: Session = Depends(get_db_session),
) -> BudgetMonthOut:
    ms = _month_start_from_parts(year, month)
    bm, limits = list_limits_for_month(session, ms)

    cat_names = {int(r.id): str(r.name) for r in session.query(Category.id, Category.name).all()}
    sub_names = {int(r.id): str(r.name) for r in session.query(Subcategory.id, Subcategory.name).all()}

    out_limits = [
        _limit_to_out(
            l,
            cat_name=cat_names.get(int(l.category_id)),
            sub_name=sub_names.get(int(l.subcategory_id)) if l.subcategory_id is not None else None,
        )
        for l in limits
    ]
    session.commit()

    return BudgetMonthOut(id=int(bm.id), month_start=bm.month_start, limits=out_limits)


@router.put("/api/budgets/months/{month_start}/limits", response_model=BudgetMonthOut)
def put_budget_limits(
    month_start: str,
    payload: list[BudgetLimitUpsertIn],
    session: Session = Depends(get_db_session),
) -> BudgetMonthOut:
    try:
        ms = normalize_month_start(date.fromisoformat(month_start))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month_start must be YYYY-MM-DD") from e

    try:
        bm, limits = upsert_limits(
            session,
            ms,
            items=[p.model_dump() for p in payload],
        )
        session.commit()
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    cat_names = {int(r.id): str(r.name) for r in session.query(Category.id, Category.name).all()}
    sub_names = {int(r.id): str(r.name) for r in session.query(Subcategory.id, Subcategory.name).all()}
    out_limits = [
        _limit_to_out(
            l,
            cat_name=cat_names.get(int(l.category_id)),
            sub_name=sub_names.get(int(l.subcategory_id)) if l.subcategory_id is not None else None,
        )
        for l in limits
    ]
    return BudgetMonthOut(id=int(bm.id), month_start=bm.month_start, limits=out_limits)


@router.get("/api/budgets/months/{month_start}/progress", response_model=BudgetProgressOut)
def get_budget_progress(
    month_start: str,
    include_projected: bool = Query(default=False),
    session: Session = Depends(get_db_session),
) -> BudgetProgressOut:
    try:
        ms = normalize_month_start(date.fromisoformat(month_start))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month_start must be YYYY-MM-DD") from e

    try:
        out = budget_progress_for_month(session, ms, include_projected=include_projected)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    session.commit()
    return BudgetProgressOut(**out)


@router.delete("/api/budgets/months/{month_start}/categories/{category_id}", response_model=BudgetMonthOut)
def delete_budget_month_category(
    month_start: str,
    category_id: int,
    session: Session = Depends(get_db_session),
) -> BudgetMonthOut:
    try:
        ms = normalize_month_start(date.fromisoformat(month_start))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month_start must be YYYY-MM-DD") from e

    try:
        bm, limits = delete_budget_category(session, ms, category_id=category_id)
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    cat_names = {int(r.id): str(r.name) for r in session.query(Category.id, Category.name).all()}
    sub_names = {int(r.id): str(r.name) for r in session.query(Subcategory.id, Subcategory.name).all()}
    out_limits = [
        _limit_to_out(
            l,
            cat_name=cat_names.get(int(l.category_id)),
            sub_name=sub_names.get(int(l.subcategory_id)) if l.subcategory_id is not None else None,
        )
        for l in limits
    ]
    return BudgetMonthOut(id=int(bm.id), month_start=bm.month_start, limits=out_limits)

