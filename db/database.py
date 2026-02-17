"""
Database connection and session management for the Personal Budget App.

Handles:
- SQLite connection to local budget.db
- SQLAlchemy session creation
- Database initialization
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from db.models import Base

# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'budget.db')
DATABASE_URL = f'sqlite:///{DB_PATH}'

# Create engine
engine = create_engine(
    DATABASE_URL,
    echo=False,  # Set to True for SQL query logging
    connect_args={'check_same_thread': False},  # Required for SQLite
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Initialize the database by creating all tables."""
    Base.metadata.create_all(bind=engine)
    print(f"Database initialized at {DB_PATH}")


def get_session() -> Session:
    """Get a new database session."""
    return SessionLocal()


def close_session(session: Session):
    """Close a database session."""
    if session:
        session.close()
