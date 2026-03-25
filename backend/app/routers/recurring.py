from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Any, cast

from backend.app.deps import get_db_session
from backend.app.schemas import (
    RecurringOccurrenceOut,
    RecurringSeriesActionIn,
    RecurringSeriesBulkCategoryUpdateIn,
    RecurringSeriesCardOut,
)
from services.recurring_service import (
    apply_series_action,
    bulk_update_series_category,
    list_series_occurrences,
    list_recurring_suggestions,
)


router = APIRouter(tags=["recurring"])


@router.get("/api/recurring/suggestions", response_model=list[RecurringSeriesCardOut])
def recurring_suggestions(session: Session = Depends(get_db_session)) -> list[RecurringSeriesCardOut]:
    return list_recurring_suggestions(session)


@router.post("/api/recurring/series/confirm", status_code=status.HTTP_204_NO_CONTENT)
def recurring_confirm(
    payload: RecurringSeriesActionIn,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        apply_series_action(session, payload, status_value="confirmed")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.post("/api/recurring/series/ignore", status_code=status.HTTP_204_NO_CONTENT)
def recurring_ignore(
    payload: RecurringSeriesActionIn,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        apply_series_action(session, payload, status_value="ignored")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.post("/api/recurring/series/remove", status_code=status.HTTP_204_NO_CONTENT)
def recurring_remove(
    payload: RecurringSeriesActionIn,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        apply_series_action(session, payload, status_value="removed")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.post("/api/recurring/series/occurrences", response_model=list[RecurringOccurrenceOut])
def recurring_series_occurrences(
    payload: RecurringSeriesActionIn,
    session: Session = Depends(get_db_session),
) -> list[RecurringOccurrenceOut]:
    txns = list_series_occurrences(session, payload)
    return [
        # ORM model attributes are typed as Columns in stubs; cast for response mapping.
        RecurringOccurrenceOut(
            transaction_id=int(getattr(cast(Any, t), "id")),
            date=getattr(cast(Any, t), "date"),
            amount=float(getattr(cast(Any, t), "amount")),
            merchant=str(getattr(cast(Any, t), "merchant")),
            category_id=getattr(cast(Any, t), "category_id"),
            category_name=(
                str(getattr(cast(Any, getattr(cast(Any, t), "category", None)), "name"))
                if getattr(cast(Any, t), "category", None) is not None
                else None
            ),
            subcategory_id=getattr(cast(Any, t), "subcategory_id"),
            subcategory_name=(
                str(getattr(cast(Any, getattr(cast(Any, t), "subcategory", None)), "name"))
                if getattr(cast(Any, t), "subcategory", None) is not None
                else None
            ),
        )
        for t in txns
    ]


@router.post("/api/recurring/series/bulk-category", status_code=status.HTTP_204_NO_CONTENT)
def recurring_bulk_category_update(
    payload: RecurringSeriesBulkCategoryUpdateIn,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        bulk_update_series_category(
            session,
            RecurringSeriesActionIn(
                merchant_norm=payload.merchant_norm,
                amount_anchor_cents=payload.amount_anchor_cents,
            ),
            category_id=payload.category_id,
            subcategory_id=payload.subcategory_id,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

