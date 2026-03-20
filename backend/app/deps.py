from __future__ import annotations

from collections.abc import Generator

from sqlalchemy.orm import Session

from db.database import close_session, get_session


def get_db_session() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a SQLAlchemy session and closes it afterwards.
    """

    session = get_session()
    try:
        yield session
    finally:
        close_session(session)

