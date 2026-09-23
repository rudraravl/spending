from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import TransactionSplitIn, TransactionSplitOut
from db.models import Transaction, TransactionSplit
from services.transaction_service import get_transaction_by_id, set_transaction_splits


router = APIRouter(tags=["splits"])


def _get_txn_or_404(session: Session, transaction_id: int) -> Transaction:
    txn = get_transaction_by_id(session, transaction_id)
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return txn


def _split_to_out(s: TransactionSplit) -> TransactionSplitOut:
    return TransactionSplitOut(
        id=s.id,
        category_id=s.category_id,
        category_name=s.category.name if s.category else None,
        subcategory_id=s.subcategory_id,
        subcategory_name=s.subcategory.name if s.subcategory else None,
        amount=float(s.amount),
        notes=s.notes,
    )


@router.get(
    "/api/transactions/{transaction_id}/splits",
    response_model=list[TransactionSplitOut],
)
def get_splits(
    transaction_id: int,
    session: Session = Depends(get_db_session),
) -> list[TransactionSplitOut]:
    txn = _get_txn_or_404(session, transaction_id)
    return [_split_to_out(s) for s in txn.splits or []]


@router.put(
    "/api/transactions/{transaction_id}/splits",
    response_model=list[TransactionSplitOut],
    status_code=status.HTTP_200_OK,
)
def replace_splits(
    transaction_id: int,
    splits: list[TransactionSplitIn],
    session: Session = Depends(get_db_session),
) -> list[TransactionSplitOut]:
    """
    Replace all splits for a transaction (including clearing them by sending an empty list).
    """
    _get_txn_or_404(session, transaction_id)

    payload = [
        {
            "category_id": s.category_id,
            "subcategory_id": s.subcategory_id,
            "amount": float(s.amount),
            "notes": s.notes,
        }
        for s in splits
    ]

    try:
        set_transaction_splits(session, transaction_id, payload)
    except ValueError as e:
        # Surface validation errors to the user.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    # Return updated splits
    updated = _get_txn_or_404(session, transaction_id)
    return [_split_to_out(s) for s in updated.splits or []]
