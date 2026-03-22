"""
SQLAlchemy ORM Models for the Personal Budget App.

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

    # Relationships
    transactions = relationship('Transaction', back_populates='account', cascade='all, delete-orphan')

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
    """Represents a single transaction."""
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