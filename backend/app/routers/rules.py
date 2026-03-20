from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import RuleCreate, RuleMeta, RuleOut, RuleUpdate
from services.rule_service import (
    ALLOWED_FIELDS,
    ALLOWED_OPERATORS,
    create_rule,
    delete_rule,
    list_rules,
    update_rule,
)


router = APIRouter(tags=["rules"])


@router.get("/api/rules/meta", response_model=RuleMeta)
def rules_meta() -> RuleMeta:
    return RuleMeta(
        allowed_fields=sorted(list(ALLOWED_FIELDS)),
        allowed_operators=sorted(list(ALLOWED_OPERATORS)),
    )


@router.get("/api/rules", response_model=list[RuleOut])
def list_all_rules(session: Session = Depends(get_db_session)) -> list[RuleOut]:
    rules = list_rules(session)
    return [
        RuleOut(
            id=r.id,
            priority=r.priority,
            field=r.field,
            operator=r.operator,
            value=r.value,
            category_id=r.category_id,
            subcategory_id=r.subcategory_id,
        )
        for r in rules
    ]


@router.post("/api/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule_endpoint(
    payload: RuleCreate,
    session: Session = Depends(get_db_session),
) -> RuleOut:
    try:
        r = create_rule(
            session,
            priority=payload.priority,
            field=payload.field,
            operator=payload.operator,
            value=payload.value,
            category_id=payload.category_id,
            subcategory_id=payload.subcategory_id,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return RuleOut(
        id=r.id,
        priority=r.priority,
        field=r.field,
        operator=r.operator,
        value=r.value,
        category_id=r.category_id,
        subcategory_id=r.subcategory_id,
    )


@router.patch("/api/rules/{rule_id}", response_model=RuleOut)
def update_rule_endpoint(
    rule_id: int,
    payload: RuleUpdate,
    session: Session = Depends(get_db_session),
) -> RuleOut:
    update_data = payload.model_dump(exclude_unset=True)
    try:
        r = update_rule(session, rule_id, **update_data)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return RuleOut(
        id=r.id,
        priority=r.priority,
        field=r.field,
        operator=r.operator,
        value=r.value,
        category_id=r.category_id,
        subcategory_id=r.subcategory_id,
    )


@router.delete("/api/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule_endpoint(
    rule_id: int,
    session: Session = Depends(get_db_session),
) -> None:
    try:
        delete_rule(session, rule_id)
    except Exception as e:
        # Service raises ValueError when not found.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

