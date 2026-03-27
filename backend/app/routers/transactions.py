from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import (
    PaymentsHoldoutResponse,
    TransferCreate,
    TransferLinkExisting,
    TransferLinkExistingResponse,
    TransferUnlinkExisting,
    TransferUnlinkExistingResponse,
    TransferMatchCandidatesResponse,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
)
from backend.app.transfer_helpers import transfer_pair_to_candidate_out
from db.models import Subcategory, Transaction
from services.trasaction_service import (
    create_transaction,
    create_transfer,
    delete_transaction,
    get_transactions,
    get_transaction_by_id,
    link_transactions_as_transfer,
    unlink_transfer_pair,
    update_transaction,
)
from services.transfer_matching_service import find_transfer_match_candidates
from utils.filters import TransactionFilter


router = APIRouter(tags=["transactions"])


def _txn_to_out(txn: Transaction) -> TransactionOut:
    tags = list(txn.tags or [])
    category = getattr(txn, "category", None)
    subcategory = getattr(txn, "subcategory", None)

    # Loading splits lazily is OK for MVP; UI needs just "has_splits".
    splits = getattr(txn, "splits", None)
    has_splits = bool(splits)

    return TransactionOut(
        id=txn.id,
        date=txn.date,
        amount=float(txn.amount),
        merchant=txn.merchant,
        notes=txn.notes,
        account_id=txn.account_id,
        account_name=getattr(txn.account, "name", None) if getattr(txn, "account", None) else None,
        category_id=txn.category_id,
        category_name=getattr(category, "name", None) if category else None,
        subcategory_id=txn.subcategory_id,
        subcategory_name=getattr(subcategory, "name", None) if subcategory else None,
        tag_ids=[t.id for t in tags],
        tag_names=[t.name for t in tags],
        is_transfer=bool(getattr(txn, "is_transfer", False)),
        has_splits=has_splits,
        transfer_group_id=getattr(txn, "transfer_group_id", None),
    )


@router.get("/api/transactions", response_model=list[TransactionOut])
def list_transactions(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    account_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    subcategory_id: int | None = Query(default=None),
    tag_ids: list[int] | None = Query(default=None),
    tags_match_any: bool = Query(default=False),
    min_amount: float | None = Query(default=None),
    max_amount: float | None = Query(default=None),
    include_transfers: bool = Query(default=True),
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db_session),
) -> list[TransactionOut]:
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

    # If all filter fields are empty, pass `None` to keep semantics identical.
    is_empty_filters = not any(
        [
            start_date,
            end_date,
            account_id,
            category_id,
            subcategory_id,
            tag_ids,
            min_amount is not None,
            max_amount is not None,
        ]
    )
    filters_arg: Optional[TransactionFilter] = None if is_empty_filters else filters

    txns = get_transactions(
        session,
        filters=filters_arg,
        limit=limit,
        offset=offset,
        include_transfers=include_transfers,
    )
    return [_txn_to_out(t) for t in txns]


@router.get("/api/transactions/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: int,
    session: Session = Depends(get_db_session),
) -> TransactionOut:
    txn = get_transaction_by_id(session, transaction_id)
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return _txn_to_out(txn)


@router.post("/api/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction_endpoint(
    payload: TransactionCreate,
    session: Session = Depends(get_db_session),
) -> TransactionOut:
    try:
        txn = create_transaction(
            session,
            date_=payload.date,
            amount=float(payload.amount),
            merchant=payload.merchant,
            account_id=payload.account_id,
            category_id=payload.category_id,
            subcategory_id=payload.subcategory_id,
            notes=payload.notes,
            tag_ids=payload.tag_ids,
            source=payload.source or "manual",
            external_id=payload.external_id,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return _txn_to_out(txn)


@router.patch("/api/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction_endpoint(
    transaction_id: int,
    payload: TransactionUpdate,
    session: Session = Depends(get_db_session),
) -> TransactionOut:
    update_data = payload.model_dump(exclude_unset=True)
    service_kwargs: dict[str, object] = {}
    if "date" in update_data:
        service_kwargs["date_"] = update_data.pop("date")
    if "amount" in update_data:
        service_kwargs["amount"] = update_data.pop("amount")
    if "merchant" in update_data:
        service_kwargs["merchant"] = update_data.pop("merchant")
    if "account_id" in update_data:
        service_kwargs["account_id"] = update_data.pop("account_id")
    if "category_id" in update_data:
        service_kwargs["category_id"] = update_data.pop("category_id")
    if "subcategory_id" in update_data:
        service_kwargs["subcategory_id"] = update_data.pop("subcategory_id")
    if "notes" in update_data:
        service_kwargs["notes"] = update_data.pop("notes")
    if "tag_ids" in update_data:
        service_kwargs["tag_ids"] = update_data.pop("tag_ids")

    try:
        txn = update_transaction(session, transaction_id, **service_kwargs)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return _txn_to_out(txn)


@router.delete("/api/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction_endpoint(
    transaction_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    ok = delete_transaction(session, transaction_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")


@router.post("/api/transfers", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_transfer_endpoint(
    payload: TransferCreate,
    session: Session = Depends(get_db_session),
) -> dict:
    try:
        group = create_transfer(
            session,
            from_account_id=payload.from_account_id,
            to_account_id=payload.to_account_id,
            amount=float(payload.amount),
            date_=payload.date,
            notes=payload.notes,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return {"transfer_group_id": group.id}


@router.post(
    "/api/transfers/link-existing",
    response_model=TransferLinkExistingResponse,
    status_code=status.HTTP_201_CREATED,
)
def link_existing_transfer_endpoint(
    payload: TransferLinkExisting,
    session: Session = Depends(get_db_session),
) -> TransferLinkExistingResponse:
    try:
        group = link_transactions_as_transfer(
            session,
            payload.transaction_id_a,
            payload.transaction_id_b,
            canonical_amount=payload.canonical_amount,
            notes=payload.notes,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return TransferLinkExistingResponse(transfer_group_id=group.id)


@router.post(
    "/api/transfers/unlink-existing",
    response_model=TransferUnlinkExistingResponse,
    status_code=status.HTTP_200_OK,
)
def unlink_existing_transfer_endpoint(
    payload: TransferUnlinkExisting,
    session: Session = Depends(get_db_session),
) -> TransferUnlinkExistingResponse:
    try:
        group_id = unlink_transfer_pair(
            session,
            payload.transaction_id_a,
            payload.transaction_id_b,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return TransferUnlinkExistingResponse(transfer_group_id=group_id)


@router.get("/api/transfers/match-candidates", response_model=TransferMatchCandidatesResponse)
def transfer_match_candidates(
    seed_ids: list[int] | None = Query(default=None, alias="seed_ids"),
    lookback_days: int = Query(default=365, ge=1, le=3650),
    session: Session = Depends(get_db_session),
) -> TransferMatchCandidatesResponse:
    pairs = find_transfer_match_candidates(
        session,
        seed_transaction_ids=seed_ids,
        lookback_days=lookback_days,
    )
    return TransferMatchCandidatesResponse(
        candidates=[transfer_pair_to_candidate_out(session, p) for p in pairs],
    )


@router.get("/api/transfers/payments-holdouts", response_model=PaymentsHoldoutResponse)
def payments_subcategory_holdouts(
    session: Session = Depends(get_db_session),
) -> PaymentsHoldoutResponse:
    rows = (
        session.query(Transaction.id)
        .join(Subcategory, Transaction.subcategory_id == Subcategory.id)
        .filter(func.lower(Subcategory.name) == "payments")
        .order_by(Transaction.id.asc())
        .all()
    )
    ids = [r[0] for r in rows]
    return PaymentsHoldoutResponse(count=len(ids), transaction_ids=ids)