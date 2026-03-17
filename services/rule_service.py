"""
Rule Service - auto-categorization rules engine.

Applies priority-ordered rules to transactions during import.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional, Tuple, cast

from sqlalchemy.orm import Session

from db.models import Account, Category, Rule, Subcategory, Transaction


ALLOWED_FIELDS = {"merchant", "amount", "account", "notes"}
ALLOWED_OPERATORS = {"contains", "equals", "starts_with", "regex"}


@dataclass(frozen=True)
class RuleMatchContext:
    merchant: str
    notes: str
    account_name: str
    amount: float


def list_rules(session: Session) -> list[Rule]:
    return (
        session.query(Rule)
        .order_by(Rule.priority.asc(), Rule.id.asc())
        .all()
    )


def validate_rule_definition(
    *,
    field: str,
    operator: str,
    value: str,
    category_id: int,
    subcategory_id: int,
    session: Optional[Session] = None,
) -> None:
    if field not in ALLOWED_FIELDS:
        raise ValueError(f"Unsupported field: {field}")
    if operator not in ALLOWED_OPERATORS:
        raise ValueError(f"Unsupported operator: {operator}")
    if value is None or str(value).strip() == "":
        raise ValueError("Rule value cannot be empty")

    # Validate regex early so UI can show a helpful error.
    if operator == "regex":
        try:
            re.compile(str(value), flags=re.IGNORECASE)
        except re.error as e:
            raise ValueError(f"Invalid regex: {e}") from e

    if session is not None:
        category = session.query(Category).filter(Category.id == category_id).first()
        if not category:
            raise ValueError(f"Category with id {category_id} does not exist")
        subcategory = (
            session.query(Subcategory)
            .filter(Subcategory.id == subcategory_id)
            .first()
        )
        if not subcategory:
            raise ValueError(f"Subcategory with id {subcategory_id} does not exist")
        # SQLAlchemy models are not fully typed here; cast for type-checkers.
        subcategory_category_id = cast(int, getattr(subcategory, "category_id"))
        if subcategory_category_id != category_id:
            raise ValueError(
                f"Subcategory '{subcategory.name}' (id={subcategory_id}) does not belong to "
                f"category '{category.name}' (id={category_id})"
            )


def _norm_text(x: Optional[str]) -> str:
    return (x or "").strip().lower()


def _get_match_context(session: Session, txn: Transaction) -> RuleMatchContext:
    txn_any = cast(Any, txn)
    account_name = ""
    if getattr(txn_any, "account", None) is not None:
        account_name = str(getattr(getattr(txn_any, "account"), "name", "") or "")
    else:
        acct = (
            session.query(Account)
            .filter(Account.id == cast(int, getattr(txn_any, "account_id")))
            .first()
        )
        account_name = str(getattr(acct, "name", "") or "") if acct else ""

    return RuleMatchContext(
        merchant=str(getattr(txn_any, "merchant", "") or ""),
        notes=str(getattr(txn_any, "notes", "") or ""),
        account_name=str(account_name or ""),
        amount=float(getattr(txn_any, "amount")),
    )


def match_rule(rule: Rule, ctx: RuleMatchContext) -> bool:
    rule_any = cast(Any, rule)
    field = str(getattr(rule_any, "field"))
    operator = str(getattr(rule_any, "operator"))
    rule_value_raw = str(getattr(rule_any, "value"))
    rule_value = _norm_text(rule_value_raw)

    if field == "merchant":
        actual = _norm_text(ctx.merchant)
    elif field == "notes":
        actual = _norm_text(ctx.notes)
    elif field == "account":
        actual = _norm_text(ctx.account_name)
    elif field == "amount":
        # Amount is numeric; only 'equals' is reliably meaningful with the current operator set.
        if operator != "equals":
            return False
        try:
            target = float(rule_value_raw)
        except ValueError:
            return False
        return abs(float(ctx.amount) - target) < 1e-9
    else:
        return False

    if operator == "contains":
        return rule_value in actual
    if operator == "equals":
        return actual == rule_value
    if operator == "starts_with":
        return actual.startswith(rule_value)
    if operator == "regex":
        try:
            return re.search(rule_value_raw, actual, flags=re.IGNORECASE) is not None
        except re.error:
            # Shouldn't happen if we validate on create/update, but keep import robust.
            return False

    return False


def apply_rules_to_transaction(session: Session, txn: Transaction) -> Tuple[bool, Optional[int]]:
    """
    Apply the first matching rule to txn (priority ASC, id ASC).

    Returns:
        (applied, rule_id)
    """
    rules = list_rules(session)
    if not rules:
        return False, None

    ctx = _get_match_context(session, txn)
    txn_any = cast(Any, txn)
    for rule in rules:
        if match_rule(rule, ctx):
            rule_any = cast(Any, rule)
            txn_any.category_id = int(getattr(rule_any, "category_id"))
            txn_any.subcategory_id = int(getattr(rule_any, "subcategory_id"))
            return True, int(getattr(rule_any, "id"))

    return False, None


def create_rule(
    session: Session,
    *,
    priority: int,
    field: str,
    operator: str,
    value: str,
    category_id: int,
    subcategory_id: int,
) -> Rule:
    validate_rule_definition(
        field=field,
        operator=operator,
        value=value,
        category_id=category_id,
        subcategory_id=subcategory_id,
        session=session,
    )
    rule = Rule(
        priority=int(priority),
        field=field,
        operator=operator,
        value=value,
        category_id=category_id,
        subcategory_id=subcategory_id,
    )
    session.add(rule)
    session.commit()
    return rule


def update_rule(
    session: Session,
    rule_id: int,
    *,
    priority: Optional[int] = None,
    field: Optional[str] = None,
    operator: Optional[str] = None,
    value: Optional[str] = None,
    category_id: Optional[int] = None,
    subcategory_id: Optional[int] = None,
) -> Rule:
    rule = session.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise ValueError(f"Rule with id {rule_id} does not exist")
    rule_any = cast(Any, rule)

    new_priority = int(getattr(rule_any, "priority")) if priority is None else int(priority)
    new_field = str(getattr(rule_any, "field")) if field is None else field
    new_operator = str(getattr(rule_any, "operator")) if operator is None else operator
    new_value = str(getattr(rule_any, "value")) if value is None else value
    new_category_id = int(getattr(rule_any, "category_id")) if category_id is None else int(category_id)
    new_subcategory_id = (
        int(getattr(rule_any, "subcategory_id")) if subcategory_id is None else int(subcategory_id)
    )

    validate_rule_definition(
        field=new_field,
        operator=new_operator,
        value=new_value,
        category_id=new_category_id,
        subcategory_id=new_subcategory_id,
        session=session,
    )

    rule_any.priority = new_priority
    rule_any.field = new_field
    rule_any.operator = new_operator
    rule_any.value = new_value
    rule_any.category_id = new_category_id
    rule_any.subcategory_id = new_subcategory_id
    session.commit()
    return rule


def delete_rule(session: Session, rule_id: int) -> None:
    rule = session.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise ValueError(f"Rule with id {rule_id} does not exist")
    session.delete(rule)
    session.commit()

