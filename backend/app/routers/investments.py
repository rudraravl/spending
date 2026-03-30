from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import (
    InvestmentHistoryPointOut,
    InvestmentManualPositionCreate,
    InvestmentManualPositionOut,
    InvestmentManualPositionUpdate,
    InvestmentReclassifyIn,
    InvestmentReclassifyOut,
    InvestmentsSummaryOut,
)
from db.models import Account, InvestmentManualPosition
from services.investment_service import (
    get_history_series,
    get_investments_summary,
    get_portfolio_detail,
)
from services.investment_txn_parser import reclassify_investment_transactions

router = APIRouter(tags=["investments"])


@router.get("/api/investments/summary", response_model=InvestmentsSummaryOut)
def api_investments_summary(session: Session = Depends(get_db_session)) -> InvestmentsSummaryOut:
    data = get_investments_summary(session)
    session.commit()
    return InvestmentsSummaryOut(**data)


@router.get("/api/investments/accounts/{account_id}/portfolio")
def api_portfolio(account_id: int, session: Session = Depends(get_db_session)) -> dict:
    detail = get_portfolio_detail(session, account_id)
    session.commit()
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found or not an investment account",
        )
    return detail


@router.get(
    "/api/investments/accounts/{account_id}/history",
    response_model=list[InvestmentHistoryPointOut],
)
def api_portfolio_history(
    account_id: int,
    limit: int = 365,
    session: Session = Depends(get_db_session),
) -> list[InvestmentHistoryPointOut]:
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct or acct.type != "investment":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found or not an investment account",
        )
    series = get_history_series(session, account_id, limit=min(max(limit, 1), 2000))
    session.commit()
    return [InvestmentHistoryPointOut(**row) for row in series]


@router.post(
    "/api/investments/accounts/{account_id}/manual-positions",
    response_model=InvestmentManualPositionOut,
    status_code=status.HTTP_201_CREATED,
)
def api_create_manual_position(
    account_id: int,
    payload: InvestmentManualPositionCreate,
    session: Session = Depends(get_db_session),
) -> InvestmentManualPosition:
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct or acct.type != "investment":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found or not an investment account",
        )
    row = InvestmentManualPosition(
        account_id=account_id,
        symbol=payload.symbol.strip().upper() if payload.symbol and payload.symbol.strip() else None,
        quantity=payload.quantity,
        cost_basis_total=payload.cost_basis_total,
        as_of_date=payload.as_of_date,
        notes=payload.notes,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.patch(
    "/api/investments/accounts/{account_id}/manual-positions/{position_id}",
    response_model=InvestmentManualPositionOut,
)
def api_update_manual_position(
    account_id: int,
    position_id: int,
    payload: InvestmentManualPositionUpdate,
    session: Session = Depends(get_db_session),
) -> InvestmentManualPosition:
    row = (
        session.query(InvestmentManualPosition)
        .filter(
            InvestmentManualPosition.id == position_id,
            InvestmentManualPosition.account_id == account_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manual position not found")
    data = payload.model_dump(exclude_unset=True)
    if "symbol" in data:
        sym = data["symbol"]
        row.symbol = sym.strip().upper() if sym and str(sym).strip() else None
        del data["symbol"]
    for k, v in data.items():
        setattr(row, k, v)
    session.commit()
    session.refresh(row)
    return row


@router.delete(
    "/api/investments/accounts/{account_id}/manual-positions/{position_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def api_delete_manual_position(
    account_id: int,
    position_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    row = (
        session.query(InvestmentManualPosition)
        .filter(
            InvestmentManualPosition.id == position_id,
            InvestmentManualPosition.account_id == account_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manual position not found")
    session.delete(row)
    session.commit()


@router.post("/api/investments/reclassify", response_model=InvestmentReclassifyOut)
def api_reclassify(
    payload: InvestmentReclassifyIn,
    session: Session = Depends(get_db_session),
) -> InvestmentReclassifyOut:
    if payload.account_id is not None:
        acct = session.query(Account).filter(Account.id == payload.account_id).first()
        if not acct or acct.type != "investment":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found or not an investment account",
            )
    n = reclassify_investment_transactions(session, account_id=payload.account_id)
    session.commit()
    return InvestmentReclassifyOut(updated_count=n)
