# Personal Budget App - MVP

A local-only personal finance tracking application that ingests CSV credit card statements, stores data in SQLite, and provides filterable summaries.

## Features

✅ **CSV Import** - Upload and parse credit card statements (Wells, BILT, Discover, or custom)  
✅ **Manual Entry** - Add transactions manually with tags and notes  
✅ **Full Editing** - Edit any transaction field and tags  
✅ **Hierarchical Tags** - Organize spending with categories and tags  
✅ **Flexible Filters** - Filter by date, account, category, tag, and amount  
✅ **Smart Summaries** - Current month, year, and semester views with export  
✅ **No Cloud** - 100% local SQLite database  
✅ **No Auth** - Single-user, no authentication needed  

## Tech Stack

- **Python 3.11+**
- **SQLAlchemy** (ORM)
- **SQLite** (local database)
- **pandas** (CSV processing)
- **Streamlit** (UI)

## Setup

### 1. Create Virtual Environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Initialize Database

The database will be auto-initialized when you first run the app.

## Running the App

```bash
streamlit run app.py
```

The app will open in your browser at `http://localhost:8501`

## Project Structure

```
budget_app/
├── app.py                          # Streamlit UI
│
├── db/
│   ├── models.py                   # SQLAlchemy models
│   └── database.py                 # Database connection and init
│
├── services/
│   ├── trasaction_service.py       # Transaction CRUD
│   ├── import_service.py           # CSV import and deduplication
│   └── summary_service.py          # Aggregation and summaries
│
├── adapters/
│   ├── base_adapter.py             # Abstract base class
│   ├── generic_adapter.py          # Manual column mapping
│   ├── wells_adapter.py            # Wells Fargo format
│   ├── bilt_adapter.py             # BILT Mastercard format
│   └── discover_adapter.py         # Discover Card format
│
├── utils/
│   ├── filters.py                  # Transaction filter object
│   └── semester.py                 # Academic semester utilities
│
├── data/
│   └── budget.db                   # SQLite database (auto-created)
│
└── requirements.txt
```

## Database Schema

### Accounts
Represents bank or credit card accounts
```
id, name (unique), type, created_at
```

### Categories
High-level spending categories (Food, Travel, etc.)
```
id, name (unique)
```

### Tags
Specific tags within categories
```
id, name (unique), category_id (FK)
```

### Transactions
Individual transaction entries
```
id, date, amount, merchant, account_id (FK), notes, created_at, updated_at
```

### TransactionTags (Many-to-Many)
Links transactions to multiple tags
```
transaction_id (PK), tag_id (PK)
```

## Usage Guide

### Step 1: Set Up Accounts & Categories

1. Go to **Settings** page
2. Create accounts (e.g., "Chase Sapphire", "Amex Blue")
3. Create categories (e.g., "Food", "Travel", "Housing")
4. Create tags within categories (e.g., "Groceries" → Food)

### Step 2: Import CSV

1. Go to **Import CSV** page
2. Select account
3. Choose adapter (or "generic" for custom format)
4. Upload CSV file
5. Review preview and confirm import

**Deduplication**: Import service checks for existing transactions with identical date, amount, merchant, and account before inserting.

### Step 3: Add Transactions Manually

1. Go to **Add Transaction** page
2. Fill in date, amount, merchant
3. Select account and tags
4. Click Save

### Step 4: View & Edit

1. Go to **All Transactions** page
2. Click any transaction to expand and edit
3. Changes save immediately

### Step 5: Analyze with Summaries

1. Go to **Summaries** page
2. View current month/year/semester breakdowns
3. See spending by tag and category
4. Export CSV for external analysis

### Custom Date Range Analysis

1. Go to **Custom Date Range** page
2. Set date range and optional filters
3. View filtered transactions and summaries

## CSV Import Format

### Generic Adapter (Manual Mapping)

Upload any CSV and map columns:
- Date Column (e.g., "Date", "Trans Date")
- Amount Column (e.g., "Amount", "Debit")
- Merchant Column (e.g., "Description", "Merchant Name")

### Built-In Adapters

**Wells Fargo Format**
```
Date, Amount, Description
```

**BILT Mastercard Format**
```
Transaction Date, Amount, Merchant Name
```

**Discover Card Format**
```
Trans. Date, Amount, Merchant Name
```

All adapters normalize to: `date | amount | merchant`

## Semester Definitions

Automatic academic semester detection:
- **Spring**: Jan 1 – May 31
- **Summer**: Jun 1 – Aug 15
- **Fall**: Aug 16 – Dec 31

## Performance

Built to handle 20,000+ transactions smoothly with proper indexing and pagination.

## Limitations (Out of Scope)

❌ Charts/visualizations  
❌ Budget limits  
❌ Recurring transactions  
❌ Multi-user  
❌ Cloud sync  
❌ Forecasting  
❌ Authentication  

## Database Location

SQLite database is stored at: `/data/budget.db`

All data is local. No external services are called.

## Troubleshooting

### Database issues
Delete `data/budget.db` to reset the database (saves all data in CSV format first!)

### Import errors
- Check CSV column names match adapter expectations
- Ensure dates are in expected format
- Verify amounts are numeric (not formatted strings)

### Duplicate transactions
Import service prevents duplicates by checking date + amount + merchant + account combination

## Building the App

The recommended build order was:
1. ✅ Database schema (models.py)
2. ✅ Database connection (database.py)
3. ✅ Transaction CRUD (trasaction_service.py)
4. ✅ Filter system (filters.py)
5. ✅ Summary calculations (summary_service.py)
6. ✅ CSV adapters (adapters/)
7. ✅ Import service (import_service.py)
8. ✅ Semester utilities (semester.py)
9. ✅ Streamlit UI (app.py)

UI was built last to ensure all backend layers were complete and testable.

## Next Steps (Not in MVP)

For future versions, consider:
- Chart visualizations (Plotly, Matplotlib)
- Recurring transaction detection
- Budget limit alerts
- Category spending forecasts
- Backup/export functionality
- Multiple currency support
