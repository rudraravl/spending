from __future__ import annotations

import os
import shutil
from datetime import date, datetime

from db.database import DB_PATH, init_db, get_session, close_session


def backup_db_once_per_day() -> None:
    """
    Best-effort DB backup (at most once per day per server start).

    - Create `db_backup_<timestamp>.db` in the same folder as `DB_PATH`
    - Keep at most 5 backups, delete oldest when above limit
    - Ignore backup failures (non-fatal)
    """

    if not os.path.exists(DB_PATH):
        return

    db_dir = os.path.dirname(DB_PATH)
    today_prefix = f"db_backup_{date.today().isoformat()}_"

    try:
        has_today_backup = any(
            name.startswith(today_prefix) and name.endswith(".db")
            for name in os.listdir(db_dir)
        )
        if has_today_backup:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        backup_name = f"db_backup_{timestamp}.db"
        backup_path = os.path.join(db_dir, backup_name)

        shutil.copy2(DB_PATH, backup_path)

        backups: list[str] = []
        for name in os.listdir(db_dir):
            if name.startswith("db_backup_") and name.endswith(".db"):
                path = os.path.join(db_dir, name)
                if os.path.isfile(path):
                    backups.append(path)

        if len(backups) > 5:
            backups.sort(key=lambda p: os.path.getmtime(p))
            for path in backups[:-5]:
                try:
                    os.remove(path)
                except OSError:
                    pass
    except OSError:
        # Non-fatal: continue without backup.
        return


def _seed_simplefin_connection() -> None:
    """
    If no SimpleFINConnection rows exist and the env var SIMPLEFIN_ACCESS_URL_PROD
    is set, create a default connection so the UI can manage it immediately.
    """
    access_url = os.environ.get("SIMPLEFIN_ACCESS_URL_PROD")
    if not access_url:
        return

    from db.models import SimpleFINConnection
    from services.simplefin_sync_service import create_connection_from_access_url

    session = get_session()
    try:
        if session.query(SimpleFINConnection).count() > 0:
            return
        create_connection_from_access_url(session, access_url, label="SimpleFIN (Prod)")
        print("Seeded SimpleFIN connection from SIMPLEFIN_ACCESS_URL_PROD.")
    except Exception as exc:
        session.rollback()
        print(f"Warning: could not seed SimpleFIN connection: {exc}")
    finally:
        close_session(session)


def init_database() -> None:
    """Initialize (and rebuild if necessary) the SQLite database."""

    init_db()
    _seed_simplefin_connection()

