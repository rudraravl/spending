"""
Database connection and session management for Keep.

Handles:
- SQLite connection to local budget.db
- SQLAlchemy session creation
- Database initialization
"""

import os
from datetime import date
from sqlalchemy import text
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from db.models import Base, Category, Subcategory

# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'budget.db')
DATABASE_URL = f'sqlite:///{DB_PATH}'

# Create engine
engine = create_engine(
    DATABASE_URL,
    echo=False,  # Set to True for SQL query logging
    connect_args={'check_same_thread': False},  # Required for SQLite
)

# Bump this when schema changes require a rebuild.
SCHEMA_VERSION = "2026-03-31-zbb-v2-decoupled"

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _migrate_remove_payments_subcategory(conn) -> None:
    """
    Remove legacy Bills → Payments subcategory: reassign transactions and rules to
    Other / Uncategorized, then delete the subcategory row.
    """
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    if "subcategories" not in tables or "transactions" not in tables:
        return

    row = conn.execute(
        text(
            """
            SELECT s.id FROM subcategories s
            JOIN categories c ON c.id = s.category_id
            WHERE lower(trim(s.name)) = 'payments' AND c.name = 'Bills'
            LIMIT 1
            """
        )
    ).fetchone()
    if not row:
        return
    payments_sub_id = int(row[0])

    other = conn.execute(text("SELECT id FROM categories WHERE name = 'Other' LIMIT 1")).fetchone()
    if not other:
        return
    other_cat_id = int(other[0])
    uncat = conn.execute(
        text(
            "SELECT id FROM subcategories WHERE category_id = :cid AND name = 'Uncategorized' LIMIT 1"
        ),
        {"cid": other_cat_id},
    ).fetchone()
    if not uncat:
        return
    unc_sub_id = int(uncat[0])

    conn.execute(
        text(
            "UPDATE transactions SET category_id = :cid, subcategory_id = :uid "
            "WHERE subcategory_id = :sid"
        ),
        {"cid": other_cat_id, "uid": unc_sub_id, "sid": payments_sub_id},
    )
    if "rules" in tables:
        conn.execute(
            text(
                "UPDATE rules SET category_id = :cid, subcategory_id = :uid "
                "WHERE subcategory_id = :sid"
            ),
            {"cid": other_cat_id, "uid": unc_sub_id, "sid": payments_sub_id},
        )
    conn.execute(text("DELETE FROM subcategories WHERE id = :sid"), {"sid": payments_sub_id})


def _migrate_accounts_columns(conn) -> None:
    """Add linkage columns to existing SQLite `accounts` rows without full rebuild."""
    if "accounts" not in {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }:
        return
    cols = {row[1] for row in conn.execute(text("PRAGMA table_info(accounts)")).fetchall()}
    # SQLite stores BOOLEAN as INTEGER 0/1
    if "is_linked" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN is_linked INTEGER NOT NULL DEFAULT 0"))
    if "provider" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN provider VARCHAR"))
    if "external_id" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN external_id VARCHAR"))
    if "institution_name" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN institution_name VARCHAR"))
    if "last_synced_at" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN last_synced_at DATETIME"))
    if "reported_balance" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN reported_balance FLOAT"))
    if "reported_balance_at" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN reported_balance_at DATETIME"))
    if "is_robinhood_crypto" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN is_robinhood_crypto INTEGER NOT NULL DEFAULT 0"))
    if "is_budget_account" not in cols:
        conn.execute(text("ALTER TABLE accounts ADD COLUMN is_budget_account INTEGER NOT NULL DEFAULT 0"))
        conn.execute(
            text(
                "UPDATE accounts SET is_budget_account = 1 "
                "WHERE lower(trim(type)) IN ('checking', 'savings', 'cash')"
            )
        )


def _migrate_budget_settings_table(conn) -> None:
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    if "budget_settings" not in tables:
        return
    cols = {row[1] for row in conn.execute(text("PRAGMA table_info(budget_settings)")).fetchall()}
    if "rollover_mode" not in cols:
        conn.execute(text("ALTER TABLE budget_settings ADD COLUMN rollover_mode VARCHAR NOT NULL DEFAULT 'strict'"))
    row = conn.execute(text("SELECT id FROM budget_settings ORDER BY id ASC LIMIT 1")).fetchone()
    if row is None:
        conn.execute(text("INSERT INTO budget_settings (id, rollover_mode) VALUES (1, 'strict')"))
    conn.execute(text("UPDATE budget_settings SET rollover_mode = 'strict' WHERE rollover_mode NOT IN ('strict','flexible')"))


def _seed_zbb_period_rows(conn) -> None:
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    required = {"budget_periods", "category_budgets", "categories", "budget_settings", "budget_categories"}
    if not required.issubset(tables):
        return

    today = date.today()
    months: list[tuple[int, int]] = [(today.year, today.month)]
    if today.month == 12:
        months.append((today.year + 1, 1))
    else:
        months.append((today.year, today.month + 1))

    for year, month in months:
        conn.execute(
            text(
                "INSERT OR IGNORE INTO budget_periods (year, month, rta_snapshot) "
                "VALUES (:year, :month, 0)"
            ),
            {"year": year, "month": month},
        )
        period_row = conn.execute(
            text("SELECT id FROM budget_periods WHERE year = :year AND month = :month LIMIT 1"),
            {"year": year, "month": month},
        ).fetchone()
        if period_row is None:
            continue
        period_id = int(period_row[0])
        conn.execute(
            text(
                "INSERT OR IGNORE INTO category_budgets (category_id, budget_category_id, budget_period_id, assigned, activity) "
                "SELECT "
                "COALESCE("
                "  bc.txn_category_id, "
                "  (SELECT id FROM categories WHERE name = 'Other' LIMIT 1), "
                "  (SELECT id FROM categories ORDER BY id ASC LIMIT 1)"
                "), "
                "bc.id, :period_id, 0, 0 "
                "FROM budget_categories bc"
            ),
            {"period_id": period_id},
        )

    row = conn.execute(text("SELECT id FROM budget_settings ORDER BY id ASC LIMIT 1")).fetchone()
    if row is None:
        conn.execute(text("INSERT INTO budget_settings (id, rollover_mode) VALUES (1, 'strict')"))


def _migrate_recurring_series_columns(conn) -> None:
    """Add category mapping columns to recurring_series without full rebuild."""
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    if "recurring_series" not in tables:
        return
    cols = {row[1] for row in conn.execute(text("PRAGMA table_info(recurring_series)")).fetchall()}
    if "category_id" not in cols:
        conn.execute(text("ALTER TABLE recurring_series ADD COLUMN category_id INTEGER"))
    if "subcategory_id" not in cols:
        conn.execute(text("ALTER TABLE recurring_series ADD COLUMN subcategory_id INTEGER"))


def _migrate_budget_category_decoupling(conn) -> None:
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    if "category_budgets" not in tables:
        return
    cols = {row[1] for row in conn.execute(text("PRAGMA table_info(category_budgets)")).fetchall()}
    if "budget_category_id" not in cols:
        conn.execute(text("ALTER TABLE category_budgets ADD COLUMN budget_category_id INTEGER"))
    # Backfill budget_categories from existing txn categories.
    if "budget_categories" in tables:
        conn.execute(
            text(
                "INSERT OR IGNORE INTO budget_categories (name, is_system, txn_category_id) "
                "SELECT c.name, 0, c.id FROM categories c"
            )
        )
        conn.execute(
            text(
                "UPDATE category_budgets SET budget_category_id = ("
                "  SELECT bc.id FROM budget_categories bc "
                "  WHERE bc.txn_category_id = category_budgets.category_id "
                "  ORDER BY bc.id ASC LIMIT 1"
                ") "
                "WHERE budget_category_id IS NULL"
            )
        )


def _migrate_category_budgets_unique_constraint(conn) -> None:
    """
    Replace legacy unique(category_id, budget_period_id) with
    unique(budget_category_id, budget_period_id) for decoupled budget categories.
    """
    tables = {
        row[0]
        for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }
    if "category_budgets" not in tables:
        return

    # Detect whether legacy unique index/constraint still exists.
    index_rows = conn.execute(text("PRAGMA index_list(category_budgets)")).fetchall()
    has_legacy_unique = False
    has_new_unique = False
    for row in index_rows:
        idx_name = str(row[1])
        is_unique = int(row[2]) == 1
        if not is_unique:
            continue
        cols = [str(c[2]) for c in conn.execute(text(f"PRAGMA index_info('{idx_name}')")).fetchall()]
        if cols == ["category_id", "budget_period_id"]:
            has_legacy_unique = True
        if cols == ["budget_category_id", "budget_period_id"]:
            has_new_unique = True

    if not has_legacy_unique:
        return

    # Rebuild table to drop the legacy unique constraint.
    conn.execute(text("PRAGMA foreign_keys=OFF"))
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS category_budgets_new (
              id INTEGER PRIMARY KEY,
              category_id INTEGER REFERENCES categories(id),
              budget_category_id INTEGER REFERENCES budget_categories(id),
              budget_period_id INTEGER NOT NULL REFERENCES budget_periods(id),
              assigned FLOAT NOT NULL DEFAULT 0,
              activity FLOAT NOT NULL DEFAULT 0,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )
    conn.execute(
        text(
            """
            INSERT INTO category_budgets_new
              (id, category_id, budget_category_id, budget_period_id, assigned, activity, created_at, updated_at)
            SELECT
              id, category_id, budget_category_id, budget_period_id, assigned, activity, created_at, updated_at
            FROM category_budgets
            """
        )
    )
    conn.execute(text("DROP TABLE category_budgets"))
    conn.execute(text("ALTER TABLE category_budgets_new RENAME TO category_budgets"))
    conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_category_budgets_budget_cat_period "
            "ON category_budgets (budget_category_id, budget_period_id)"
        )
    )
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_category_budgets_period ON category_budgets (budget_period_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_category_budgets_category ON category_budgets (category_id)"))
    conn.execute(
        text("CREATE INDEX IF NOT EXISTS idx_category_budgets_budget_category ON category_budgets (budget_category_id)")
    )
    conn.execute(text("PRAGMA foreign_keys=ON"))


def init_db():
    """
    Initialize the database by creating all tables and seeding required data.

    IMPORTANT: This app is local-only and the accounting schema is versioned by code.
    If the on-disk database does not match the current schema, we rebuild it.
    """

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=ON"))

        existing_tables = {
            row[0]
            for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
        }

        # If we detect legacy tables/columns (e.g., tags.category_id or transactions missing required columns),
        # drop & recreate the schema to match the required architecture.
        needs_rebuild = False
        if "tags" in existing_tables:
            tag_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tags)")).fetchall()]
            if "category_id" in tag_cols:
                needs_rebuild = True
        if "transactions" in existing_tables:
            txn_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(transactions)")).fetchall()]
            required_txn_cols = {
                "subcategory_id",
                "status",
                "source",
                "external_id",
                "transfer_group_id",
                "is_transfer",
            }
            if not required_txn_cols.issubset(set(txn_cols)):
                needs_rebuild = True

        if "accounts" in existing_tables:
            acct_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(accounts)")).fetchall()]
            if "currency" not in acct_cols:
                needs_rebuild = True

        if "transfer_groups" not in existing_tables:
            needs_rebuild = True

        # Ensure transaction_splits has category_id (split support v2)
        if "transaction_splits" in existing_tables:
            split_cols = [
                row[1]
                for row in conn.execute(text("PRAGMA table_info(transaction_splits)")).fetchall()
            ]
            if "category_id" not in split_cols:
                needs_rebuild = True
        else:
            # If the table doesn't exist yet, schema is definitely out of date.
            needs_rebuild = True

        if needs_rebuild:
            Base.metadata.drop_all(bind=engine)

        Base.metadata.create_all(bind=engine)

        _migrate_accounts_columns(conn)
        _migrate_recurring_series_columns(conn)
        _migrate_remove_payments_subcategory(conn)
        _migrate_budget_category_decoupling(conn)
        _migrate_category_budgets_unique_constraint(conn)
        _migrate_budget_settings_table(conn)
        _seed_zbb_period_rows(conn)

        # Ensure external dedupe index exists for imports
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_external_source "
                "ON transactions (source, external_id)"
            )
        )

    # Seed required categories/subcategories (idempotent).
    session = get_session()
    try:
        _seed_required_data(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        close_session(session)

    print(f"Database initialized at {DB_PATH}")


def _seed_required_data(session: Session) -> None:
    """Seed required categories/subcategories (tags start empty)."""
    categories_seed = ["Food", "Travel", "Leisure", "Bills", "Shopping", "Other", "Income"]
    existing = {str(c.name): c for c in session.query(Category).all()}

    for name in categories_seed:
        if name not in existing:
            session.add(Category(name=name))
    session.flush()

    categories = {str(c.name): c for c in session.query(Category).all()}

    subcategories_seed = {
        "Food": ["Grocery", "Eating Out", "Drinks"],
        "Travel": ["Flights", "Lodging", "Transportation"],
        "Bills": ["Rent"],
        "Shopping": ["Clothes"],
        "Leisure": ["Leisure"],
        "Other": ["Uncategorized"],  # Default subcategory for imports
        "Income": ["Paycheck"],
    }

    for category_name, subcats in subcategories_seed.items():
        category = categories.get(category_name)
        if not category:
            continue
        existing_subcats = {
            s.name
            for s in session.query(Subcategory).filter(Subcategory.category_id == category.id).all()
        }
        for subcat_name in subcats:
            if subcat_name not in existing_subcats:
                session.add(Subcategory(name=subcat_name, category_id=category.id))


def get_session() -> Session:
    """Get a new database session."""
    return SessionLocal()


def close_session(session: Session):
    """Close a database session."""
    if session:
        session.close()
