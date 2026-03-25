from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import TransactionSplitIn, TransactionSplitOut
from db.models import Transaction, TransactionSplit
from services.trasaction_service import get_transaction_by_id, set_transaction_splits


router = APIRouter(tags=["splits"])


@router.get(
    "/api/transactions/{transaction_id}/splits",
    response_model=list[TransactionSplitOut],
)
def get_splits(
    transaction_id: int,
    session: Session = Depends(get_db_session),
) -> list[TransactionSplitOut]:
    txn = get_transaction_by_id(session, transaction_id)
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    result: list[TransactionSplitOut] = []
    for s in list(txn.splits or []):
        result.append(
            TransactionSplitOut(
                id=s.id,
                category_id=s.category_id,
                category_name=getattr(s.category, "name", None) if getattr(s, "category", None) else None,
                subcategory_id=s.subcategory_id,
                subcategory_name=getattr(s.subcategory, "name", None)
                if getattr(s, "subcategory", None)
                else None,
                amount=float(s.amount),
                notes=s.notes,
            )
        )
    return result


@router.put(
    "/api/transactions/{transaction_id}/splits",
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
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    # Return updated splits
    updated = get_transaction_by_id(session, transaction_id)
    assert updated is not None  # existence checked earlier in service or via DB constraints

    result: list[TransactionSplitOut] = []
    for s in list(updated.splits or []):
        result.append(
            TransactionSplitOut(
                id=s.id,
                category_id=s.category_id,
                category_name=getattr(s.category, "name", None) if getattr(s, "category", None) else None,
                subcategory_id=s.subcategory_id,
                subcategory_name=getattr(s.subcategory, "name", None)
                if getattr(s, "subcategory", None)
                else None,
                amount=float(s.amount),
                notes=s.notes,
            )
        )
    return result

