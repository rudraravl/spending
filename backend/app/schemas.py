from __future__ import annotations

from datetime import datetime
from datetime import date as Date
from typing import Literal

from pydantic import BaseModel, ConfigDict


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    currency: str
    created_at: datetime | None = None
    is_linked: bool = False
    provider: str | None = None
    external_id: str | None = None
    institution_name: str | None = None
    last_synced_at: datetime | None = None
    reported_balance: float | None = None
    reported_balance_at: datetime | None = None
    # Display balance (same logic as GET …/summary: reported for asset types when set, else ledger sum)
    balance: float


class AccountCreate(BaseModel):
    name: str
    type: str
    currency: str | None = None


class AccountSummaryOut(BaseModel):
    account_id: int
    balance: float
    ledger_balance: float


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime | None = None


class CategoryCreate(BaseModel):
    name: str


class SubcategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category_id: int
    created_at: datetime | None = None


class SubcategoryCreate(BaseModel):
    category_id: int
    name: str


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime | None = None


class TagCreate(BaseModel):
    name: str


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: Date
    amount: float
    merchant: str
    notes: str | None = None

    account_id: int | None = None
    account_name: str | None = None

    category_id: int | None = None
    category_name: str | None = None

    subcategory_id: int | None = None
    subcategory_name: str | None = None

    tag_ids: list[int] = []
    tag_names: list[str] = []

    is_transfer: bool = False
    has_splits: bool = False
    transfer_group_id: int | None = None


class TransactionCreate(BaseModel):
    date: Date
    amount: float
    merchant: str
    account_id: int
    category_id: int
    subcategory_id: int
    notes: str | None = None
    tag_ids: list[int] | None = None
    source: str | None = None
    external_id: str | None = None


class TransactionUpdate(BaseModel):
    # All fields are optional; endpoint uses `exclude_unset=True` to preserve null vs omitted.
    date: Date | None = None
    amount: float | None = None
    merchant: str | None = None
    account_id: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    notes: str | None = None
    tag_ids: list[int] | None = None


class TransferCreate(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: float
    date: Date
    notes: str | None = None


class TransferLinkExisting(BaseModel):
    """Unordered pair of transaction ids (one outflow, one inflow; any account types)."""

    transaction_id_a: int
    transaction_id_b: int
    canonical_amount: float | None = None
    notes: str | None = None


class TransferUnlinkExisting(BaseModel):
    transaction_id_a: int
    transaction_id_b: int


class TransferMatchTxnBrief(BaseModel):
    id: int
    date: str
    amount: float
    merchant: str
    account_id: int
    account_name: str | None = None
    account_type: str | None = None


class TransferMatchCandidateOut(BaseModel):
    kind: Literal["card_payment", "asset_transfer"] = "card_payment"
    asset_transaction_id: int
    credit_transaction_id: int
    canonical_amount: float
    amount_delta: float
    date_delta_days: int
    asset: TransferMatchTxnBrief
    credit: TransferMatchTxnBrief


class TransferMatchCandidatesResponse(BaseModel):
    candidates: list[TransferMatchCandidateOut]


class TransferLinkExistingResponse(BaseModel):
    transfer_group_id: int


class TransferUnlinkExistingResponse(BaseModel):
    transfer_group_id: int


class TransactionSplitIn(BaseModel):
    category_id: int
    subcategory_id: int
    amount: float
    notes: str | None = None


class TransactionSplitOut(BaseModel):
    id: int
    category_id: int
    category_name: str | None = None
    subcategory_id: int
    subcategory_name: str | None = None
    amount: float
    notes: str | None = None


class CsvInferredDateRange(BaseModel):
    min_date: Date
    max_date: Date


class CsvPreviewResponse(BaseModel):
    rows_detected: int
    raw_columns: list[str]
    preview_rows: list[dict[str, object]]
    inferred_date_range: CsvInferredDateRange | None = None


class CsvImportResult(BaseModel):
    num_imported: int
    skipped: list[dict[str, object]] = []
    imported_transaction_ids: list[int] = []
    transfer_match_candidates: list[TransferMatchCandidateOut] = []


class PaymentsHoldoutResponse(BaseModel):
    """Rows still categorized under Bills → Payments (for migration review)."""

    count: int
    transaction_ids: list[int] = []


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    priority: int
    field: str
    operator: str
    value: str
    category_id: int
    subcategory_id: int


class RuleCreate(BaseModel):
    priority: int
    field: str
    operator: str
    value: str
    category_id: int
    subcategory_id: int


class RuleUpdate(BaseModel):
    priority: int | None = None
    field: str | None = None
    operator: str | None = None
    value: str | None = None
    category_id: int | None = None
    subcategory_id: int | None = None


class RuleMeta(BaseModel):
    allowed_fields: list[str]
    allowed_operators: list[str]


class RecurringSeriesFingerprint(BaseModel):
    merchant_norm: str
    amount_anchor_cents: int


class RecurringSeriesActionIn(RecurringSeriesFingerprint):
    pass


class RecurringSeriesBulkCategoryUpdateIn(RecurringSeriesFingerprint):
    category_id: int
    subcategory_id: int


class RecurringOccurrenceOut(BaseModel):
    transaction_id: int
    date: Date
    amount: float
    merchant: str
    category_id: int | None = None
    category_name: str | None = None
    subcategory_id: int | None = None
    subcategory_name: str | None = None


class RecurringSeriesCardOut(BaseModel):
    merchant_norm: str
    display_name: str | None = None
    amount_anchor_cents: int
    amount_anchor: float
    status: str
    cadence_type: str | None = None
    cadence_days: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    occurrences: list[RecurringOccurrenceOut] = []


class RecurringSeriesDetailOut(RecurringSeriesCardOut):
    total_occurrences: int = 0


class BudgetLimitUpsertIn(BaseModel):
    """
    Upsert a budget limit.

    - subcategory_id = None => category-level cap
    - subcategory_id != None => subcategory allocation under the category
    """

    category_id: int
    subcategory_id: int | None = None
    limit_amount: float


class BudgetLimitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    budget_month_id: int
    category_id: int
    category_name: str | None = None
    subcategory_id: int | None = None
    subcategory_name: str | None = None
    limit_amount: float


class BudgetMonthOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    month_start: Date
    limits: list[BudgetLimitOut] = []


class BudgetProgressSubcategoryOut(BaseModel):
    category_id: int
    subcategory_id: int
    subcategory_name: str
    limit_amount: float
    spent_amount: float
    remaining_amount: float
    percent_used: float
    projected_spent_amount: float = 0.0


class BudgetProgressCategoryOut(BaseModel):
    category_id: int
    category_name: str
    limit_amount: float
    allocated_to_subcategories: float
    unallocated_amount: float
    spent_amount: float
    remaining_amount: float
    percent_used: float
    projected_spent_amount: float = 0.0
    subcategories: list[BudgetProgressSubcategoryOut] = []


class BudgetProgressOut(BaseModel):
    month_start: Date
    include_projected: bool = False
    categories: list[BudgetProgressCategoryOut] = []

