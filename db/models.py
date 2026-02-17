"""
SQLAlchemy ORM Models for the Personal Budget App.

Defines the following entities:
- Account: Credit card or bank account
- Category: High-level spending category (Food, Travel, Housing, etc.)
- Tag: Specific tag within a category
- Transaction: Individual transaction entry
- TransactionTag: Many-to-many relationship between Transaction and Tag
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, ForeignKey, Table
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
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    transactions = relationship('Transaction', back_populates='account', cascade='all, delete-orphan')

    def __repr__(self):
        return f"<Account(id={self.id}, name='{self.name}', type='{self.type}')>"


class Category(Base):
    """Represents a high-level spending category."""
    __tablename__ = 'categories'

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)

    # Relationships
    tags = relationship('Tag', back_populates='category', cascade='all, delete-orphan')
    transactions = relationship('Transaction', back_populates='category')

    def __repr__(self):
        return f"<Category(id={self.id}, name='{self.name}')>"


class Tag(Base):
    """Represents a specific tag within a category."""
    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=False)

    # Relationships
    category = relationship('Category', back_populates='tags')
    transactions = relationship(
        'Transaction',
        secondary=transaction_tags,
        back_populates='tags',
    )

    def __repr__(self):
        return f"<Tag(id={self.id}, name='{self.name}', category_id={self.category_id})>"


class Transaction(Base):
    """Represents a single transaction."""
    __tablename__ = 'transactions'

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)
    merchant = Column(String, nullable=False)
    account_id = Column(Integer, ForeignKey('accounts.id'), nullable=False)
    category_id = Column(Integer, ForeignKey('categories.id'), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    account = relationship('Account', back_populates='transactions')
    category = relationship('Category', back_populates='transactions')
    tags = relationship(
        'Tag',
        secondary=transaction_tags,
        back_populates='transactions',
    )

    def __repr__(self):
        return f"<Transaction(id={self.id}, date={self.date}, amount={self.amount}, merchant='{self.merchant}', account_id={self.account_id})>"
