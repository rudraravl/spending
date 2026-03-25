from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import RecurringSeriesActionIn, RecurringSeriesCardOut
from services.recurring_service import (
    apply_series_action,
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

