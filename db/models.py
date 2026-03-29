"""
SQLAlchemy ORM Models for Keep.

Defines the following entities:
- Account: Credit card or bank account
- Category: High-level accounting category (Food, Travel, etc.)
- Subcategory: Required accounting subcategory (e.g., Food -> Grocery)
- Tag: Flat context label (0..N per transaction)
- Transaction: Individual transaction entry
- TransactionTag: Many-to-many relationship between Transaction and Tag
"""

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Date,
    DateTime,
    Text,
    ForeignKey,
    Table,
    UniqueConstraint,
    Index,
    Boolean,
    func,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()

# Association table for many-to-many relationship between Transaction and Tag
transaction_tags = Table(
    'transaction_tags',
    Base.metadata,
    Column('transaction_id', Integer, ForeignKey('transactions.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id'), primary_key=True),
)


class Account(Base):
    """Represents a bank or credit card account."""
    __tablename__ = 'accounts'

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    # Allowed values (enforced at UI/service layer): checking, savings, credit, cash, investment
    type = Column(String, nullable=False)
    currency = Column(String, nullable=False, server_default="USD")
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    # Future: bank / Plaid / investment platform linkage (manual accounts keep defaults)
    is_linked = Column(Boolean, nullable=False, server_default="0", default=False)
    provider = Column(String, nullable=True)
    external_id = Column(String, nullable=True)
    institution_name = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    # Bank/custodian-reported balance (e.g. top-of-export Balance on checking CSV imports)
    reported_balance = Column(Float, nullable=True)
    reported_balance_at = Column(DateTime, nullable=True)

    # Relationships
    transactions = relationship('Transaction', back_populates='account', cascade='all, delete-orphan')
    investment_sync_snapshots = relationship(
        "InvestmentSyncSnapshot",
        back_populates="account",
        cascade="all, delete-orphan",
    )
    investment_manual_positions = relationship(
        "InvestmentManualPosition",
        back_populates="account",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Account(id={self.id}, name='{self.name}', type='{self.type}')>"


class Category(Base):
    """Represents a high-level accounting category."""
    __tablename__ = 'categories'

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    # Relationships
    subcategories = relationship('Subcategory', back_populates='category', cascade='all, delete-orphan')
    transactions = relationship('Transaction', back_populates='category')

    def __repr__(self):
        return f"<Category(id={self.id}, name='{self.name}')>"


class Subcategory(Base):
    """Represents a required accounting subcategory (belongs to exactly one Category)."""
    __tablename__ = 'subcategories'
    __table_args__ = (
        UniqueConstraint('name', 'category_id', name='uq_subcategories_name_category_id'),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=False)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    category = relationship('Category', back_populates='subcategories')
    transactions = relationship('Transaction', back_populates='subcategory')

    def __repr__(self):
        return f"<Subcategory(id={self.id}, name='{self.name}', category_id={self.category_id})>"


class Tag(Base):
    """Represents a flat context tag (no accounting meaning)."""
    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    # Relationships
    transactions = relationship(
        'Transaction',
        secondary=transaction_tags,
        back_populates='tags',
    )

    def __repr__(self):
        return f"<Tag(id={self.id}, name='{self.name}')>"


class Transaction(Base):
    """Represents a single transaction.

    Amount uses cash-flow sign: positive = inflow, negative = outflow.
    Transfers: source account negative, destination positive (see docs/AMOUNT_CONVENTION.md).
    """
    __tablename__ = 'transactions'

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)
    merchant = Column(String, nullable=False)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False)
    # For normal spending transactions these are required; for transfers they are NULL.
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=True)
    subcategory_id = Column(Integer, ForeignKey('subcategories.id'), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String, nullable=False, server_default="cleared")
    source = Column(String, nullable=False, server_default="manual")
    external_id = Column(String, nullable=True)
    transfer_group_id = Column(Integer, ForeignKey("transfer_groups.id"), nullable=True)
    is_transfer = Column(Boolean, nullable=False, server_default="0")
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    account = relationship('Account', back_populates='transactions')
    category = relationship('Category', back_populates='transactions')
    subcategory = relationship('Subcategory', back_populates='transactions')
    tags = relationship(
        'Tag',
        secondary=transaction_tags,
        back_populates='transactions',
    )
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan",
    )
    transfer_group = relationship("TransferGroup", back_populates="transactions")
    investment_classification = relationship(
        "InvestmentTxnClassification",
        back_populates="transaction",
        uselist=False,
        cascade="all, delete-orphan",
    )

    # Dedupe support for imports: (source, external_id)
    __table_args__ = (
        Index("idx_external_source", "source", "external_id"),
    )

    def __repr__(self):
        return (
            f"<Transaction(id={self.id}, date={self.date}, amount={self.amount}, "
            f"merchant='{self.merchant}', account_id={self.account_id}, source='{self.source}')>"
        )


class TransactionSplit(Base):
    """Represents a future-proof split against a parent transaction."""
    __tablename__ = "transaction_splits"

    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    subcategory_id = Column(Integer, ForeignKey("subcategories.id"), nullable=False)
    amount = Column(Float, nullable=False)
    notes = Column(Text, nullable=True)

    transaction = relationship("Transaction", back_populates="splits")
    category = relationship("Category")
    subcategory = relationship("Subcategory")

    def __repr__(self):
        return (
            f"<TransactionSplit(id={self.id}, transaction_id={self.transaction_id}, "
            f"subcategory_id={self.subcategory_id}, amount={self.amount})>"
        )


class TransferGroup(Base):
    """Logical grouping for transfers between accounts."""
    __tablename__ = "transfer_groups"

    id = Column(Integer, primary_key=True)
    created_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        nullable=False,
    )
    notes = Column(Text, nullable=True)

    transactions = relationship(
        "Transaction",
        back_populates="transfer_group",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<TransferGroup(id={self.id})>"


class Rule(Base):
    """Represents a rule for automatic categorization of transactions."""
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True)
    priority = Column(Integer, nullable=False)
    field = Column(String, nullable=False)
    operator = Column(String, nullable=False)
    value = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    subcategory_id = Column(Integer, ForeignKey("subcategories.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    category = relationship("Category")
    subcategory = relationship("Subcategory")

    __table_args__ = (
        Index("idx_rules_priority_id", "priority", "id"),
    )


    def __repr__(self):
        return f"<Rule(id={self.id}, priority={self.priority}, field='{self.field}', operator='{self.operator}', value='{self.value}', category_id={self.category_id}, subcategory_id={self.subcategory_id})>"


class RecurringSeries(Base):
    """
    User-tracked recurring charge series.

    Fingerprint is merchant-only + amount anchor in cents, so the app can apply
    a tolerance when matching suggestions while still keeping a stable key.
    """

    __tablename__ = "recurring_series"

    id = Column(Integer, primary_key=True)
    merchant_norm = Column(String, nullable=False)
    amount_anchor_cents = Column(Integer, nullable=False)
    # suggested | confirmed | ignored | removed
    status = Column(String, nullable=False, server_default="suggested")
    cadence_type = Column(String, nullable=True)  # weekly | biweekly | monthly | ...
    cadence_days = Column(Integer, nullable=True)
    # Canonical budget mapping for this series (must be a single category/subcategory pair).
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    subcategory_id = Column(Integer, ForeignKey("subcategories.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "merchant_norm",
            "amount_anchor_cents",
            name="uq_recurring_series_fingerprint",
        ),
        Index("idx_recurring_series_status", "status"),
    )

    category = relationship("Category")
    subcategory = relationship("Subcategory")

    def __repr__(self):
        return (
            f"<RecurringSeries(id={self.id}, merchant_norm='{self.merchant_norm}', "
            f"amount_anchor_cents={self.amount_anchor_cents}, status='{self.status}')>"
        )


class BudgetMonth(Base):
    """Represents a single calendar-month budget container (month_start = first of month)."""

    __tablename__ = "budget_months"

    id = Column(Integer, primary_key=True)
    month_start = Column(Date, nullable=False, unique=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    limits = relationship(
        "BudgetLimit",
        back_populates="budget_month",
        cascade="all, delete-orphan",
    )


class SimpleFINConnection(Base):
    """Stores a SimpleFIN Access URL (encrypted) for automatic bank syncing."""
    __tablename__ = "simplefin_connections"

    id = Column(Integer, primary_key=True)
    label = Column(String, nullable=False)
    access_url_encrypted = Column(Text, nullable=False)
    status = Column(String, nullable=False, server_default="active")  # active | disabled | error
    last_synced_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    sync_runs = relationship("SimpleFINSyncRun", back_populates="connection", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<SimpleFINConnection(id={self.id}, label='{self.label}', status='{self.status}')>"


class SimpleFINSyncRun(Base):
    """Records an individual sync attempt for audit / debugging."""
    __tablename__ = "simplefin_sync_runs"

    id = Column(Integer, primary_key=True)
    connection_id = Column(Integer, ForeignKey("simplefin_connections.id"), nullable=False)
    started_at = Column(DateTime, nullable=False)
    finished_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, server_default="running")  # running | success | error
    accounts_synced = Column(Integer, nullable=True)
    transactions_imported = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)

    connection = relationship("SimpleFINConnection", back_populates="sync_runs")
    investment_snapshots = relationship(
        "InvestmentSyncSnapshot",
        back_populates="sync_run",
    )

    def __repr__(self):
        return (
            f"<SimpleFINSyncRun(id={self.id}, connection_id={self.connection_id}, "
            f"status='{self.status}')>"
        )


class InvestmentSyncSnapshot(Base):
    """Point-in-time portfolio value for an investment account (per SimpleFIN sync)."""

    __tablename__ = "investment_sync_snapshots"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    captured_at = Column(DateTime, nullable=False)
    simplefin_sync_run_id = Column(Integer, ForeignKey("simplefin_sync_runs.id"), nullable=True)
    reported_balance = Column(Float, nullable=False)
    positions_value = Column(Float, nullable=False)
    cash_balance = Column(Float, nullable=False)
    currency = Column(String, nullable=False, server_default="USD")

    account = relationship("Account", back_populates="investment_sync_snapshots")
    sync_run = relationship("SimpleFINSyncRun", back_populates="investment_snapshots")
    holdings = relationship(
        "InvestmentHoldingSnapshot",
        back_populates="snapshot",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("idx_inv_sync_snap_account_captured", "account_id", "captured_at"),)


class InvestmentHoldingSnapshot(Base):
    """Immutable holding line captured inside a sync snapshot."""

    __tablename__ = "investment_holding_snapshots"

    id = Column(Integer, primary_key=True)
    snapshot_id = Column(Integer, ForeignKey("investment_sync_snapshots.id"), nullable=False)
    external_holding_id = Column(String, nullable=False)
    symbol = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    shares = Column(Float, nullable=False)
    market_value = Column(Float, nullable=False)
    cost_basis = Column(Float, nullable=True)
    purchase_price = Column(Float, nullable=True)
    currency = Column(String, nullable=False, server_default="USD")

    snapshot = relationship("InvestmentSyncSnapshot", back_populates="holdings")

    __table_args__ = (Index("idx_inv_hold_snap_snapshot", "snapshot_id"),)


class InvestmentTxnClassification(Base):
    """Parsed investment activity for a transaction (ledger / UX); optional 1:1 with Transaction."""

    __tablename__ = "investment_txn_classifications"

    id = Column(Integer, primary_key=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, unique=True)
    kind = Column(String, nullable=False)
    parsed_symbol = Column(String, nullable=True)
    confidence = Column(String, nullable=False)
    parser_version = Column(String, nullable=False)

    transaction = relationship("Transaction", back_populates="investment_classification")

    __table_args__ = (Index("idx_inv_txn_class_txn", "transaction_id"),)


class InvestmentManualPosition(Base):
    """User-entered opening position for history not available via import."""

    __tablename__ = "investment_manual_positions"

    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    symbol = Column(String, nullable=True)
    quantity = Column(Float, nullable=False)
    cost_basis_total = Column(Float, nullable=True)
    as_of_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

    account = relationship("Account", back_populates="investment_manual_positions")

    __table_args__ = (Index("idx_inv_manual_acct", "account_id"),)


class BudgetLimit(Base):
    """
    Represents a budget limit for a category, optionally allocated to a subcategory.

    - category-level cap: subcategory_id is NULL
    - subcategory allocation: subcategory_id is set
    """

    __tablename__ = "budget_limits"

    id = Column(Integer, primary_key=True)
    budget_month_id = Column(Integer, ForeignKey("budget_months.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    subcategory_id = Column(Integer, ForeignKey("subcategories.id"), nullable=True)
    limit_amount = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)
    updated_at = Column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    budget_month = relationship("BudgetMonth", back_populates="limits")
    category = relationship("Category")
    subcategory = relationship("Subcategory")

    __table_args__ = (
        UniqueConstraint(
            "budget_month_id",
            "category_id",
            "subcategory_id",
            name="uq_budget_limits_month_cat_subcat",
        ),
        Index("idx_budget_limits_month", "budget_month_id"),
        Index("idx_budget_limits_cat", "category_id"),
        Index("idx_budget_limits_subcat", "subcategory_id"),
    )