# Development Guide

This document describes how to extend and modify the Keep MVP.

## Architecture Overview

```
React UI (frontend/)
    ↓ HTTP
FastAPI (backend/)
    ↓
Service Layer (services/)
    ├── transaction_service.py (CRUD)
    ├── summary_service.py (Aggregation)
    └── import_service.py (CSV Import)
    ↓
Database Layer (db/)
    ├── models.py (SQLAlchemy ORM)
    └── database.py (Connection)
    ↓
SQLite (data/budget.db)
```

## Adding New CSV Adapters

To support a new bank/card format:

### 1. Create Adapter Class

```python
# adapters/amex_adapter.py
from adapters.generic_adapter import GenericAdapter

class AmexAdapter(GenericAdapter):
    """American Express CSV format adapter."""
    
    def __init__(self):
        super().__init__(
            date_col='Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
        )
```

### 2. Register Adapter

In `services/import_service.py`, add to `ADAPTERS` dict:

```python
ADAPTERS = {
    'generic': GenericAdapter,
    'wells': WellsAdapter,
    'amex': AmexAdapter,  # Add this
    ...
}
```

### 3. Test

The adapter will immediately be available in the Import CSV page.

## Adding Features

### Adding a New Service Function

Services layer handles business logic. Example:

```python
# services/transaction_service.py

def bulk_assign_tags(
    session: Session,
    transaction_ids: List[int],
    tag_ids: List[int],
):
    """Assign same tags to multiple transactions."""
    transactions = session.query(Transaction).filter(
        Transaction.id.in_(transaction_ids)
    ).all()
    
    tags = session.query(Tag).filter(Tag.id.in_(tag_ids)).all()
    
    for txn in transactions:
        txn.tags = tags
    
    session.commit()
```

### Adding a New React Page

1. Add a route and page component under `frontend/src/pages`.
2. Add API calls in `frontend/src/api` and a matching router in `backend/app/routers` if needed.
3. Keep business logic in `services/` and avoid duplicating logic in route handlers.

### Adding Database Model

1. Add to `db/models.py`
2. Call `init_db()` to create tables
3. Create service functions to interact with the model

Example:

```python
# db/models.py
class Budget(Base):
    __tablename__ = 'budgets'
    
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey('categories.id'))
    limit_amount = Column(Float)
    period = Column(String)  # 'monthly', 'yearly'
    created_at = Column(DateTime, default=datetime.utcnow)
```

## Filtering Patterns

Use the `TransactionFilter` object for consistent querying:

```python
from utils.filters import TransactionFilter

# Create filter
filters = TransactionFilter(
    start_date=date(2024, 1, 1),
    end_date=date(2024, 3, 31),
    category_id=5,
    tag_ids=[1, 2, 3],
    min_amount=10.0,
)

# Use in service
transactions = get_transactions(session, filters=filters)
total = calculate_total(session, filters=filters)
```

## Testing

### Test Database Operations

```python
from db.database import get_session, init_db
from services.trasaction_service import create_transaction

init_db()
session = get_session()

# Create test transaction
txn = create_transaction(
    session,
    date.today(),
    50.00,
    "Test Merchant",
    account_id=1,
)

print(f"Created transaction: {txn.id}")
```

### Test CSV Import

```python
from services.import_service import preview_csv

# Preview before importing
df = preview_csv(
    'test.csv',
    'wells',  # or 'generic' with kwargs
)

print(df.head())
```

## Performance Optimization

### For Large Transaction Sets

1. **Add indexes** to frequently queried fields:

```python
# In models.py
class Transaction(Base):
    __tablename__ = 'transactions'
    
    # ... columns ...
    
    __table_args__ = (
        Index('idx_date', 'date'),
        Index('idx_account_id', 'account_id'),
        Index('idx_date_account', 'date', 'account_id'),
    )
```

2. **Use pagination** in list views (already implemented in All Transactions view)

3. **Cache summary calculations** for frequently viewed ranges (not in MVP)

## Common Patterns

### Query with Multiple Conditions

```python
query = session.query(Transaction)

if filters.start_date:
    query = query.filter(Transaction.date >= filters.start_date)

if filters.account_id:
    query = query.filter(Transaction.account_id == filters.account_id)

transactions = query.all()
```

### Handle Optional Relationships

```python
# Safe access to related objects
for txn in transactions:
    account_name = txn.account.name if txn.account else "Unknown"
    tags = [t.name for t in txn.tags]  # Returns empty list if no tags
```

### Export Data to CSV

```python
import pandas as pd

df = pd.DataFrame([
    {
        'date': txn.date,
        'merchant': txn.merchant,
        'amount': txn.amount,
        'tags': ', '.join([t.name for t in txn.tags]),
    }
    for txn in transactions
])

df.to_csv('export.csv', index=False)
```

## Debugging

### Enable SQL Logging

```python
# In db/database.py
engine = create_engine(
    DATABASE_URL,
    echo=True,  # Set to True for logging
    ...
)
```

### Check Database State

```python
from db.database import get_session

session = get_session()

# Count rows
print(f"Transactions: {session.query(Transaction).count()}")
print(f"Tags: {session.query(Tag).count()}")

# View all accounts
for account in session.query(Account).all():
    print(f"Account: {account.name}")
```

### Reset Database

```bash
# Delete and recreate
rm data/budget.db
python3 demo.py  # Recreates with sample data
```

## Code Organization

- **models.py**: Data structures (no logic)
- **database.py**: Connection management (no business logic)
- ***_service.py**: Business logic and queries
- **adapters/*.py**: CSV parsing (no DB access)
- **utils/*.py**: Helper functions (no DB access)
- **frontend/src/**: UI only (delegates to backend APIs)

Keep this separation clean:
- Services stay framework-agnostic
- UI never queries database directly
- Adapters never touch the database

## Future Enhancements

### Recommended Next Steps

1. **Duplicate Detection**
   - ML-based matching for similar merchant names
   - Fuzzy matching for typos

2. **Budget Tracking**
   - Set monthly budgets per category
   - Alert when exceeding limits

3. **Recurring Transactions**
   - Auto-categorize based on merchant patterns
   - Flag and skip recurring items

4. **Analytics**
   - Trend analysis (month-over-month)
   - Spending habits insights
   - Visualization with Plotly

5. **Backup & Export**
   - Export all data to CSV
   - Import from backup
   - Data integrity checks

6. **Multi-Currency**
   - Support for different currencies
   - Exchange rate handling
   - Converted amounts in reports

## Troubleshooting Development

### Import Errors

```
ModuleNotFoundError: No module named 'services'
```

Solution: Ensure you're running from the project root directory:

```bash
cd /path/to/your/repo
uvicorn backend.main:app --reload --port 8000
```

### Database Locked

```
OperationalError: database is locked
```

Solution: Close all other instances of the app. SQLite doesn't handle concurrent writes well.

### CSV Parse Errors

Check:
- Column names exactly match (case-sensitive)
- Date format string is correct
- All required columns are present

## Questions?

Refer to:
- README.md for usage
- Code comments in relevant modules
- FastAPI docs: https://fastapi.tiangolo.com
- SQLAlchemy docs: https://docs.sqlalchemy.org
