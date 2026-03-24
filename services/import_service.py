"""
Import Service - CSV import and deduplication logic.

Handles:
- CSV parsing via adapters
- Deduplication (check for existing transactions)
- Transaction insertion
- Account and category management
"""

from typing import List, Tuple, Optional
import pandas as pd
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from db.models import Transaction, Account, Category, Subcategory, Tag
from adapters.base_adapter import BaseAdapter
from adapters.generic_adapter import GenericAdapter
from adapters.wells_adapter import WellsAdapter
from adapters.bilt_adapter import BiltAdapter
from adapters.discover_adapter import DiscoverAdapter
from adapters.citi_adapter import CitiAdapter
from adapters.chase_adapter import ChaseCreditCardAdapter, ChaseCheckingAdapter
from adapters.capital_one_adapter import CapitalOneAdapter
from services.rule_service import apply_rules_to_transaction
from services.account_service import ASSET_ACCOUNT_TYPES


# Adapter registry
ADAPTERS = {
    'Generic': GenericAdapter,
    'Wells': WellsAdapter,
    'Bilt': BiltAdapter,
    'Discover': DiscoverAdapter,
    'Citi': CitiAdapter,
    'Chase (Credit Card)': ChaseCreditCardAdapter,
    'Chase (Checking)': ChaseCheckingAdapter,
    'Capital One': CapitalOneAdapter,
}


def get_available_adapters() -> List[str]:
    """Get list of available adapter names."""
    return list(ADAPTERS.keys())


def preview_csv(
    file_path: str,
    adapter_name: str,
    **adapter_kwargs,
) -> pd.DataFrame:
    """
    Preview parsed CSV data without inserting into database.
    
    Args:
        file_path: Path to CSV file
        adapter_name: Name of adapter to use
        **adapter_kwargs: Additional arguments for the adapter (required for 'generic')
        
    Returns:
        Parsed DataFrame
    """
    
    # Get adapter
    adapter = _get_adapter(adapter_name, **adapter_kwargs)
    
    # Parse
    parsed = adapter.parse(file_path)
    
    return parsed


def import_csv(
    session: Session,
    file_path: str,
    account_id: int,
    adapter_name: str,
    **adapter_kwargs,
) -> Tuple[int, List[dict]]:
    """
    Import CSV file into database.
    
    Args:
        session: Database session
        file_path: Path to CSV file
        account_id: ID of the account to assign to imported transactions
        adapter_name: Name of adapter to use
        **adapter_kwargs: Additional arguments for the adapter
        
    Returns:
        Tuple of (num_imported, list of skipped rows)
    """
    # Verify account exists
    account = session.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise ValueError(f"Account with id {account_id} does not exist")
    
    # Read and parse CSV
    adapter = _get_adapter(adapter_name, **adapter_kwargs)
    parsed = adapter.parse(file_path)
    
    # Import transactions
    num_imported = 0
    skipped = []
    
    for _, row in parsed.iterrows():
        try:
            # Source/external_id are optional and adapter-specific; default to simple
            # "csv" source with no external id when not provided.
            source = getattr(row, "source", "csv")
            external_id = getattr(row, "external_id", None)

            # Check for duplicate: prefer external_id+source when both are present,
            # otherwise fall back to legacy date/amount/merchant/account match.
            if _transaction_exists(session, row, account_id, source, external_id):
                skipped.append({
                    'date': row['date'],
                    'amount': row['amount'],
                    'merchant': row['merchant'],
                    'reason': 'duplicate',
                })
                continue
            
            # Create transaction (requires category + subcategory)
            # Default to "Other" category with "Uncategorized" subcategory if not specified
            other_category = ensure_category(session, "Other")
            other_subcategory = ensure_subcategory(session, "Uncategorized", other_category.id)
            
            transaction = Transaction(
                date=pd.to_datetime(row['date']).date()
                if isinstance(row['date'], str)
                else row['date'],
                amount=float(row['amount']),
                merchant=str(row['merchant']),
                account_id=account_id,
                category_id=other_category.id,
                subcategory_id=other_subcategory.id,
                notes=None,
                source=source,
                external_id=external_id,
            )
            session.add(transaction)
            # Apply auto-categorization rules during import only.
            apply_rules_to_transaction(session, transaction)
            num_imported += 1
            
        except Exception as e:
            skipped.append({
                'date': row.get('date'),
                'amount': row.get('amount'),
                'merchant': row.get('merchant'),
                'reason': str(e),
            })
    
    # Bank-reported balance from CSV (checking/savings/cash/investment only)
    reported = adapter.reported_balance_from_import(file_path)
    if reported is not None and account.type in ASSET_ACCOUNT_TYPES:
        account.reported_balance = float(reported)
        account.reported_balance_at = datetime.now(timezone.utc)

    session.commit()
    
    return num_imported, skipped


def _get_adapter(adapter_name: str, **kwargs) -> BaseAdapter:
    """Get an adapter instance by name."""
    if adapter_name not in ADAPTERS:
        raise ValueError(f"Unknown adapter: {adapter_name}. Available: {list(ADAPTERS.keys())}")
    
    adapter_class = ADAPTERS[adapter_name]
    
    # For Generic adapter, require kwargs
    if adapter_name == 'Generic':
        if not kwargs:
            raise ValueError("Generic adapter requires: date_col, amount_col, merchant_col")
        return adapter_class(**kwargs)
    
    # For specific adapters, no kwargs needed
    return adapter_class()


def _transaction_exists(
    session: Session,
    row: pd.Series,
    account_id: int,
    source: str,
    external_id: Optional[str],
) -> bool:
    """
    Check if transaction already exists in database.

    Preferred dedupe: (source, external_id) when both are present.
    Fallback dedupe: identical (date, amount, merchant, account_id).
    """
    if external_id:
        existing = (
            session.query(Transaction)
            .filter(
                Transaction.source == source,
                Transaction.external_id == external_id,
            )
            .first()
        )
        if existing:
            return True

    transaction_date = (
        pd.to_datetime(row["date"]).date()
        if isinstance(row["date"], str)
        else row["date"]
    )

    existing = (
        session.query(Transaction)
        .filter(
            Transaction.date == transaction_date,
            Transaction.amount == float(row["amount"]),
            Transaction.merchant == str(row["merchant"]),
            Transaction.account_id == account_id,
        )
        .first()
    )

    return existing is not None


def ensure_account(session: Session, account_name: str, account_type: str = 'credit_card') -> Account:
    """
    Ensure an account exists, creating it if necessary.
    
    Args:
        session: Database session
        account_name: Name of the account
        account_type: Type of account (default: 'credit_card')
        
    Returns:
        Account object
    """
    account = session.query(Account).filter(Account.name == account_name).first()
    
    if not account:
        account = Account(name=account_name, type=account_type)
        session.add(account)
        session.commit()
    
    return account


def ensure_category(session: Session, category_name: str) -> Category:
    """
    Ensure a category exists, creating it if necessary.
    
    Args:
        session: Database session
        category_name: Name of the category
        
    Returns:
        Category object
    """
    category = session.query(Category).filter(Category.name == category_name).first()
    
    if not category:
        category = Category(name=category_name)
        session.add(category)
        session.commit()
    
    return category


def ensure_subcategory(session: Session, subcategory_name: str, category_id: int) -> Subcategory:
    """
    Ensure a subcategory exists, creating it if necessary.
    
    Args:
        session: Database session
        subcategory_name: Name of the subcategory
        category_id: ID of the parent category
        
    Returns:
        Subcategory object
    """
    subcategory = session.query(Subcategory).filter(
        Subcategory.name == subcategory_name,
        Subcategory.category_id == category_id
    ).first()
    
    if not subcategory:
        # Verify category exists
        category = session.query(Category).filter(Category.id == category_id).first()
        if not category:
            raise ValueError(f"Category with id {category_id} does not exist")
        
        subcategory = Subcategory(name=subcategory_name, category_id=category_id)
        session.add(subcategory)
        session.commit()
    
    return subcategory


def ensure_tag(session: Session, tag_name: str) -> Tag:
    """
    Ensure a tag exists, creating it if necessary.
    
    Tags are flat (no category relationship).
    
    Args:
        session: Database session
        tag_name: Name of the tag
        
    Returns:
        Tag object
    """
    tag = session.query(Tag).filter(Tag.name == tag_name).first()
    
    if not tag:
        tag = Tag(name=tag_name)
        session.add(tag)
        session.commit()
    
    return tag
