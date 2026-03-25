"""
Database connection and session management for the Personal Budget App.

Handles:
- SQLite connection to local budget.db
- SQLAlchemy session creation
- Database initialization
"""

import os
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
SCHEMA_VERSION = "2026-03-22-accounts-linkage"

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
        _migrate_remove_payments_subcategory(conn)

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
