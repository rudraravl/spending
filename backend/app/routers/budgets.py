from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import (
    BudgetCategoryCreateIn,
    BudgetCategoryOut,
    BudgetCategoryUpdateIn,
    ZbbAssignIn,
    ZbbMonthOut,
    ZbbMoveMoneyIn,
    ZbbRolloverSettingOut,
    ZbbRolloverSettingUpdateIn,
)
from services.zbb_service import (
    assign_amount,
    create_budget_category,
    delete_budget_category as delete_zbb_budget_category,
    get_month_overview,
    get_rollover_mode,
    list_budget_categories,
    move_money,
    set_rollover_mode,
    update_budget_category,
)


router = APIRouter(tags=["budgets"])


@router.get("/api/budgets/zbb/months", response_model=ZbbMonthOut)
def get_zbb_month(
    year: int = Query(...),
    month: int = Query(...),
    session: Session = Depends(get_db_session),
) -> ZbbMonthOut:
    if month < 1 or month > 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be 1..12")
    out = get_month_overview(session, year, month)
    session.commit()
    return ZbbMonthOut(**out)


@router.patch("/api/budgets/zbb/months/{year}/{month}/assign", response_model=ZbbMonthOut)
def patch_zbb_assign(
    year: int,
    month: int,
    payload: ZbbAssignIn,
    session: Session = Depends(get_db_session),
) -> ZbbMonthOut:
    try:
        out = assign_amount(
            session,
            year=year,
            month=month,
            category_id=payload.category_id,
            assigned=payload.assigned,
        )
        if float(out["ready_to_assign"]) < 0:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign money you do not have (Ready to Assign would be negative).",
            )
        session.commit()
        return ZbbMonthOut(**out)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.post("/api/budgets/zbb/months/{year}/{month}/move-money", response_model=ZbbMonthOut)
def post_zbb_move_money(
    year: int,
    month: int,
    payload: ZbbMoveMoneyIn,
    session: Session = Depends(get_db_session),
) -> ZbbMonthOut:
    try:
        out = move_money(
            session,
            year=year,
            month=month,
            from_category_id=payload.from_category_id,
            to_category_id=payload.to_category_id,
            amount=payload.amount,
        )
        session.commit()
        return ZbbMonthOut(**out)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.get("/api/budgets/zbb/settings", response_model=ZbbRolloverSettingOut)
def get_zbb_settings(session: Session = Depends(get_db_session)) -> ZbbRolloverSettingOut:
    mode = get_rollover_mode(session)
    session.commit()
    return ZbbRolloverSettingOut(rollover_mode=mode)


@router.patch("/api/budgets/zbb/settings", response_model=ZbbRolloverSettingOut)
def patch_zbb_settings(
    payload: ZbbRolloverSettingUpdateIn,
    session: Session = Depends(get_db_session),
) -> ZbbRolloverSettingOut:
    try:
        mode = set_rollover_mode(session, payload.rollover_mode)
        session.commit()
        return ZbbRolloverSettingOut(rollover_mode=mode)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.get("/api/budgets/zbb/categories", response_model=list[BudgetCategoryOut])
def get_zbb_categories(session: Session = Depends(get_db_session)) -> list[BudgetCategoryOut]:
    out = list_budget_categories(session)
    session.commit()
    return [BudgetCategoryOut(**row) for row in out]


@router.post("/api/budgets/zbb/categories", response_model=BudgetCategoryOut, status_code=status.HTTP_201_CREATED)
def post_zbb_category(
    payload: BudgetCategoryCreateIn,
    session: Session = Depends(get_db_session),
) -> BudgetCategoryOut:
    try:
        created = create_budget_category(
            session,
            name=payload.name,
            txn_category_id=payload.txn_category_id,
            txn_subcategory_id=payload.txn_subcategory_id,
        )
        row = next((r for r in list_budget_categories(session) if int(r["id"]) == int(created["id"])), None)
        session.commit()
        if row is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load created category")
        return BudgetCategoryOut(**row)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.patch("/api/budgets/zbb/categories/{budget_category_id}", response_model=BudgetCategoryOut)
def patch_zbb_category(
    budget_category_id: int,
    payload: BudgetCategoryUpdateIn,
    session: Session = Depends(get_db_session),
) -> BudgetCategoryOut:
    try:
        update_budget_category(
            session,
            budget_category_id,
            name=payload.name,
            txn_category_id=payload.txn_category_id,
            txn_subcategory_id=payload.txn_subcategory_id,
        )
        row = next((r for r in list_budget_categories(session) if int(r["id"]) == int(budget_category_id)), None)
        session.commit()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget category not found")
        return BudgetCategoryOut(**row)
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.delete("/api/budgets/zbb/categories/{budget_category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zbb_category(
    budget_category_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        delete_zbb_budget_category(session, budget_category_id)
        session.commit()
    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

