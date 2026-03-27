"""
SimpleFIN API router – connection management, account discovery/linking, sync.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from services.simplefin_client import SimpleFINAuthError, SimpleFINError
from services.simplefin_sync_service import (
    create_connection_from_token,
    delete_connection,
    discover_accounts,
    get_connection,
    link_account,
    list_connections,
    list_sync_runs,
    sync_connection,
    update_connection,
    validate_discovered_account,
    get_connection_daily_budget,
)

router = APIRouter(tags=["simplefin"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConnectionOut(BaseModel):
    id: int
    label: str
    status: str
    last_synced_at: datetime | None = None
    last_error: str | None = None
    created_at: datetime | None = None


class ConnectionClaimIn(BaseModel):
    token: str
    label: str | None = None


class ConnectionUpdateIn(BaseModel):
    label: str | None = None
    status: str | None = None


class DiscoveredAccountOut(BaseModel):
    conn_id: str
    conn_name: str
    account_id: str
    name: str
    currency: str
    balance: float
    balance_date: int
    local_account_id: int | None = None


class DiscoveryResponse(BaseModel):
    accounts: list[DiscoveredAccountOut]
    errors: list[dict]


class LinkAccountIn(BaseModel):
    connection_id: int
    conn_id: str
    account_id: str
    local_name: str
    local_type: str
    currency: str = "USD"
    institution_name: str = ""


class LinkAccountOut(BaseModel):
    account_id: int
    name: str
    type: str
    is_linked: bool


class SyncIn(BaseModel):
    connection_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    include_pending: bool = False
    lookback_days: int = 7


class SyncResultOut(BaseModel):
    accounts_synced: int
    transactions_imported: int
    errors: list[str] | None = None


class SyncRunOut(BaseModel):
    id: int
    connection_id: int
    started_at: datetime | None = None
    finished_at: datetime | None = None
    status: str
    accounts_synced: int | None = None
    transactions_imported: int | None = None
    error_message: str | None = None


class DailyBudgetOut(BaseModel):
    connection_id: int
    used: int
    limit: int


# ---------------------------------------------------------------------------
# Connection CRUD
# ---------------------------------------------------------------------------

@router.get("/api/simplefin/connections", response_model=list[ConnectionOut])
def api_list_connections(session: Session = Depends(get_db_session)):
    conns = list_connections(session)
    return [
        ConnectionOut(
            id=c.id,
            label=c.label,
            status=c.status,
            last_synced_at=c.last_synced_at,
            last_error=c.last_error,
            created_at=c.created_at,
        )
        for c in conns
    ]


@router.post(
    "/api/simplefin/connections/claim",
    response_model=ConnectionOut,
    status_code=status.HTTP_201_CREATED,
)
def api_claim_connection(
    payload: ConnectionClaimIn,
    session: Session = Depends(get_db_session),
):
    try:
        conn = create_connection_from_token(
            session, payload.token, label=payload.label or "SimpleFIN"
        )
    except SimpleFINAuthError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except SimpleFINError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ConnectionOut(
        id=conn.id,
        label=conn.label,
        status=conn.status,
        last_synced_at=conn.last_synced_at,
        last_error=conn.last_error,
        created_at=conn.created_at,
    )


@router.patch("/api/simplefin/connections/{connection_id}", response_model=ConnectionOut)
def api_update_connection(
    connection_id: int,
    payload: ConnectionUpdateIn,
    session: Session = Depends(get_db_session),
):
    try:
        conn = update_connection(
            session,
            connection_id,
            label=payload.label,
            status=payload.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return ConnectionOut(
        id=conn.id,
        label=conn.label,
        status=conn.status,
        last_synced_at=conn.last_synced_at,
        last_error=conn.last_error,
        created_at=conn.created_at,
    )


@router.delete(
    "/api/simplefin/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def api_delete_connection(
    connection_id: int,
    session: Session = Depends(get_db_session),
):
    try:
        delete_connection(session, connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Discovery + linking
# ---------------------------------------------------------------------------

@router.get("/api/simplefin/discovery", response_model=DiscoveryResponse)
def api_discover(
    connection_id: int = Query(...),
    session: Session = Depends(get_db_session),
):
    try:
        accounts, errors = discover_accounts(session, connection_id)
    except (SimpleFINAuthError, SimpleFINError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return DiscoveryResponse(
        accounts=[
            DiscoveredAccountOut(
                conn_id=a.conn_id,
                conn_name=a.conn_name,
                account_id=a.account_id,
                name=a.name,
                currency=a.currency,
                balance=a.balance,
                balance_date=a.balance_date,
                local_account_id=a.local_account_id,
            )
            for a in accounts
        ],
        errors=errors,
    )


@router.post("/api/simplefin/accounts/link", response_model=LinkAccountOut)
def api_link_account(
    payload: LinkAccountIn,
    session: Session = Depends(get_db_session),
):
    try:
        # Verify connection exists
        get_connection(session, payload.connection_id)
        exists_on_connection = validate_discovered_account(
            session,
            payload.connection_id,
            conn_id=payload.conn_id,
            sfin_account_id=payload.account_id,
        )
        if not exists_on_connection:
            raise ValueError(
                "Selected SimpleFIN account was not found for this connection. "
                "Refresh discovery and try again."
            )
        acct = link_account(
            session,
            payload.connection_id,
            conn_id=payload.conn_id,
            sfin_account_id=payload.account_id,
            local_name=payload.local_name,
            local_type=payload.local_type,
            currency=payload.currency,
            institution_name=payload.institution_name,
        )
    except (SimpleFINAuthError, SimpleFINError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return LinkAccountOut(
        account_id=acct.id,
        name=acct.name,
        type=acct.type,
        is_linked=bool(acct.is_linked),
    )


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

@router.post("/api/simplefin/sync", response_model=SyncResultOut)
def api_sync(
    payload: SyncIn,
    session: Session = Depends(get_db_session),
):
    connection_ids: list[int] = []
    if payload.connection_id is not None:
        connection_ids = [payload.connection_id]
    else:
        conns = list_connections(session)
        connection_ids = [c.id for c in conns if c.status == "active"]

    total = SyncResultOut(accounts_synced=0, transactions_imported=0, errors=[])
    for cid in connection_ids:
        try:
            result = sync_connection(
                session,
                cid,
                lookback_days=payload.lookback_days,
                start_date=payload.start_date,
                end_date=payload.end_date,
                include_pending=payload.include_pending,
            )
            total.accounts_synced += result.accounts_synced
            total.transactions_imported += result.transactions_imported
            if result.errors:
                total.errors = (total.errors or []) + result.errors
        except (SimpleFINError, SimpleFINAuthError) as exc:
            total.errors = (total.errors or []) + [str(exc)]

    return total


# ---------------------------------------------------------------------------
# Sync runs
# ---------------------------------------------------------------------------

@router.get("/api/simplefin/sync-runs", response_model=list[SyncRunOut])
def api_sync_runs(
    connection_id: int = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_db_session),
):
    runs = list_sync_runs(session, connection_id, limit=limit)
    return [
        SyncRunOut(
            id=r.id,
            connection_id=r.connection_id,
            started_at=r.started_at,
            finished_at=r.finished_at,
            status=r.status,
            accounts_synced=r.accounts_synced,
            transactions_imported=r.transactions_imported,
            error_message=r.error_message,
        )
        for r in runs
    ]


@router.get("/api/simplefin/daily-budget", response_model=DailyBudgetOut)
def api_daily_budget(
    connection_id: int = Query(...),
    session: Session = Depends(get_db_session),
):
    try:
        used, limit = get_connection_daily_budget(session, connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return DailyBudgetOut(connection_id=connection_id, used=used, limit=limit)
