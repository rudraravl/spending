"""
Category / subcategory deletion.

Deleting a category or subcategory must not leave rows pointing at it: with SQLite
foreign keys enforced that delete would fail, and without them the rows would be
silently orphaned. Everything that referenced the deleted row is moved to
Other / Uncategorized first.
"""

from __future__ import annotations

from sqlalchemy import extract, or_
from sqlalchemy.orm import Session

from db.models import (
    BudgetCategory,
    Category,
    CategoryBudget,
    RecurringSeries,
    Rule,
    Subcategory,
    Transaction,
    TransactionSplit,
)
from services.account_service import get_other_uncategorized_ids
from services.summary_service import INCOME_CATEGORY_NAME
from services.zbb_service import recalc_activity_for_months

PROTECTED_CATEGORY_NAMES = frozenset({INCOME_CATEGORY_NAME, "Other"})


def is_protected_subcategory(subcategory: Subcategory) -> bool:
    return (
        subcategory.name == "Uncategorized"
        and subcategory.category is not None
        and subcategory.category.name == "Other"
    )


def _reassign_to_uncategorized(
    session: Session,
    *,
    category_id: int | None,
    subcategory_ids: list[int],
) -> list[tuple[int, int]]:
    """
    Point everything that references the category (or any of `subcategory_ids`)
    at Other / Uncategorized. Returns the (year, month)s whose budget activity changed;
    recalculate them only after the rows are deleted, since the recalc creates an
    envelope for any category that lacks one.

    Rules targeting the deleted row are removed rather than moved: rules are
    first-match-wins, so one assigning "Uncategorized" would shadow later rules.
    Budget envelopes mapped to it are unmapped rather than pointed at Uncategorized,
    which would make them track all uncategorized spending.
    """
    other_cat_id, unc_sub_id = get_other_uncategorized_ids(session)

    def refs(model) -> object:
        clauses = []
        if category_id is not None:
            clauses.append(model.category_id == category_id)
        if subcategory_ids:
            clauses.append(model.subcategory_id.in_(subcategory_ids))
        return or_(*clauses)

    txn_filter = refs(Transaction)
    split_filter = refs(TransactionSplit)
    split_txn_ids = session.query(TransactionSplit.transaction_id).filter(split_filter)
    months = (
        session.query(extract("year", Transaction.date), extract("month", Transaction.date))
        .filter(or_(txn_filter, Transaction.id.in_(split_txn_ids)))
        .distinct()
        .all()
    )

    moved = {"category_id": other_cat_id, "subcategory_id": unc_sub_id}
    session.query(Transaction).filter(txn_filter).update(moved, synchronize_session=False)
    session.query(TransactionSplit).filter(split_filter).update(moved, synchronize_session=False)
    session.query(RecurringSeries).filter(refs(RecurringSeries)).update(moved, synchronize_session=False)
    session.query(Rule).filter(refs(Rule)).delete(synchronize_session=False)

    envelope_clauses = []
    if category_id is not None:
        envelope_clauses.append(BudgetCategory.txn_category_id == category_id)
        session.query(CategoryBudget).filter(CategoryBudget.category_id == category_id).update(
            {"category_id": other_cat_id}, synchronize_session=False
        )
    if subcategory_ids:
        envelope_clauses.append(BudgetCategory.txn_subcategory_id.in_(subcategory_ids))
    session.query(BudgetCategory).filter(or_(*envelope_clauses)).update(
        {"txn_category_id": None, "txn_subcategory_id": None}, synchronize_session=False
    )

    return [(int(y), int(m)) for y, m in months]


def delete_category(session: Session, category: Category) -> None:
    if category.name in PROTECTED_CATEGORY_NAMES:
        raise ValueError(f"The '{category.name}' category is required by the app and cannot be deleted")
    category_id = int(category.id)
    sub_ids = [int(s.id) for s in category.subcategories]
    months = _reassign_to_uncategorized(session, category_id=category_id, subcategory_ids=sub_ids)
    session.query(Subcategory).filter(Subcategory.category_id == category_id).delete(synchronize_session=False)
    session.query(Category).filter(Category.id == category_id).delete(synchronize_session=False)
    # Bulk statements bypass the identity map; drop stale in-memory state before recalc.
    session.expire_all()
    recalc_activity_for_months(session, months)


def delete_subcategory(session: Session, subcategory: Subcategory) -> None:
    if is_protected_subcategory(subcategory):
        raise ValueError("Other / Uncategorized is required by the app and cannot be deleted")
    sub_id = int(subcategory.id)
    months = _reassign_to_uncategorized(session, category_id=None, subcategory_ids=[sub_id])
    session.query(Subcategory).filter(Subcategory.id == sub_id).delete(synchronize_session=False)
    session.expire_all()
    recalc_activity_for_months(session, months)
