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
    type = Column(String, nullable=False)  # e.g., "credit_card", "checking", "savings"
    created_at = Column(DateTime, server_default=func.current_timestamp(), nullable=False)

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
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=False)
    subcategory_id = Column(Integer, ForeignKey('subcategories.id'), nullable=False)
    notes = Column(Text, nullable=True)
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

    def __repr__(self):
        return f"<Transaction(id={self.id}, date={self.date}, amount={self.amount}, merchant='{self.merchant}', account_id={self.account_id})>"
