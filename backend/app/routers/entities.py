from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import (
    AccountCreate,
    AccountOut,
    AccountSummaryOut,
    CategoryCreate,
    CategoryOut,
    SubcategoryCreate,
    SubcategoryOut,
    TagCreate,
    TagOut,
)
from db.models import Account, Category, Subcategory, Tag
from services.account_service import account_display_balance, delete_account as delete_account_with_cleanup


router = APIRouter(tags=["entities"])


def _integrity_error_to_http(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _account_to_out(session: Session, a: Account) -> AccountOut:
    display, _ledger = account_display_balance(session, a)
    return AccountOut(
        id=a.id,
        name=a.name,
        type=a.type,
        currency=a.currency,
        created_at=a.created_at,
        is_linked=bool(a.is_linked),
        provider=a.provider,
        external_id=a.external_id,
        institution_name=a.institution_name,
        last_synced_at=a.last_synced_at,
        reported_balance=a.reported_balance,
        reported_balance_at=a.reported_balance_at,
        balance=display,
    )


@router.get("/api/accounts", response_model=list[AccountOut])
def list_accounts(session: Session = Depends(get_db_session)) -> list[AccountOut]:
    return [_account_to_out(session, a) for a in session.query(Account).order_by(Account.id.asc()).all()]


@router.get("/api/accounts/{account_id}", response_model=AccountOut)
def get_account(account_id: int, session: Session = Depends(get_db_session)) -> AccountOut:
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return _account_to_out(session, account)


@router.get("/api/accounts/{account_id}/summary", response_model=AccountSummaryOut)
def get_account_summary(account_id: int, session: Session = Depends(get_db_session)) -> AccountSummaryOut:
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    display, ledger = account_display_balance(session, account)
    return AccountSummaryOut(
        account_id=account_id,
        balance=display,
        ledger_balance=ledger,
    )


@router.post("/api/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate,
    session: Session = Depends(get_db_session),
) -> AccountOut:
    account = Account(
        name=payload.name.strip(),
        type=payload.type.strip(),
        currency=(payload.currency or "USD").strip(),
    )
    try:
        session.add(account)
        session.commit()
        session.refresh(account)
    except Exception as e:  # pragma: no cover (varies by DB)
        session.rollback()
        raise _integrity_error_to_http(str(e)) from e

    return _account_to_out(session, account)


@router.delete("/api/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    account = session.query(Account.id).filter(Account.id == account_id).first()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    try:
        delete_account_with_cleanup(session, account_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


@router.get("/api/categories", response_model=list[CategoryOut])
def list_categories(
    session: Session = Depends(get_db_session),
) -> list[CategoryOut]:
    return [
        CategoryOut(id=c.id, name=c.name, created_at=c.created_at)
        for c in session.query(Category).order_by(Category.id.asc()).all()
    ]


@router.post("/api/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    session: Session = Depends(get_db_session),
) -> CategoryOut:
    category = Category(name=payload.name.strip())
    try:
        session.add(category)
        session.commit()
    except Exception as e:  # pragma: no cover
        session.rollback()
        raise _integrity_error_to_http(str(e)) from e

    return CategoryOut(id=category.id, name=category.name, created_at=category.created_at)


@router.delete("/api/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    category = session.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    session.delete(category)
    session.commit()


@router.get("/api/categories/{category_id}/subcategories", response_model=list[SubcategoryOut])
def list_subcategories(
    category_id: int,
    session: Session = Depends(get_db_session),
) -> list[SubcategoryOut]:
    return [
        SubcategoryOut(
            id=s.id,
            name=s.name,
            category_id=s.category_id,
            created_at=s.created_at,
        )
        for s in session.query(Subcategory)
        .filter(Subcategory.category_id == category_id)
        .order_by(Subcategory.id.asc())
        .all()
    ]


@router.post("/api/subcategories", response_model=SubcategoryOut, status_code=status.HTTP_201_CREATED)
def create_subcategory(
    payload: SubcategoryCreate,
    session: Session = Depends(get_db_session),
) -> SubcategoryOut:
    subcategory = Subcategory(
        name=payload.name.strip(),
        category_id=payload.category_id,
    )
    try:
        session.add(subcategory)
        session.commit()
    except Exception as e:  # pragma: no cover
        session.rollback()
        raise _integrity_error_to_http(str(e)) from e

    return SubcategoryOut(
        id=subcategory.id,
        name=subcategory.name,
        category_id=subcategory.category_id,
        created_at=subcategory.created_at,
    )


@router.delete("/api/subcategories/{subcategory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subcategory(
    subcategory_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    subcategory = session.query(Subcategory).filter(Subcategory.id == subcategory_id).first()
    if not subcategory:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subcategory not found")
    session.delete(subcategory)
    session.commit()


@router.get("/api/tags", response_model=list[TagOut])
def list_tags(
    session: Session = Depends(get_db_session),
) -> list[TagOut]:
    return [
        TagOut(id=t.id, name=t.name, created_at=t.created_at)
        for t in session.query(Tag).order_by(Tag.id.asc()).all()
    ]


@router.post("/api/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreate,
    session: Session = Depends(get_db_session),
) -> TagOut:
    tag = Tag(name=payload.name.strip())
    try:
        session.add(tag)
        session.commit()
    except Exception as e:  # pragma: no cover
        session.rollback()
        raise _integrity_error_to_http(str(e)) from e

    return TagOut(id=tag.id, name=tag.name, created_at=tag.created_at)


@router.delete("/api/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    tag = session.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    session.delete(tag)
    session.commit()

