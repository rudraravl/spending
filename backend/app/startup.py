from __future__ import annotations

import os
import sqlite3
from datetime import date, datetime

from db.database import DB_PATH, init_db, get_session, close_session
from services.investment_txn_parser import reclassify_stale_investment_transactions

BACKUP_PREFIX = "db_backup_"
BACKUP_SUFFIX = ".db"
BACKUPS_TO_KEEP = 5


def list_backups(db_dir: str, prefix: str = BACKUP_PREFIX) -> list[str]:
    """Paths of backup files in `db_dir` whose name starts with `prefix`."""
    paths: list[str] = []
    for name in os.listdir(db_dir):
        if name.startswith(prefix) and name.endswith(BACKUP_SUFFIX):
            path = os.path.join(db_dir, name)
            if os.path.isfile(path):
                paths.append(path)
    return paths


def today_backup_prefix() -> str:
    return f"{BACKUP_PREFIX}{date.today().isoformat()}_"


def copy_db_to(dest_path: str) -> None:
    """
    Snapshot the live DB into `dest_path` via SQLite's online backup API.

    Unlike a raw file copy this is transactionally consistent even if the app is
    writing concurrently (and it includes pages still sitting in a WAL file).
    """
    src = sqlite3.connect(DB_PATH)
    try:
        dst = sqlite3.connect(dest_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def create_timestamped_backup(db_dir: str) -> str:
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_path = os.path.join(db_dir, f"{BACKUP_PREFIX}{timestamp}{BACKUP_SUFFIX}")
    copy_db_to(backup_path)
    return backup_path


def cleanup_old_backups(db_dir: str, *, keep: int = BACKUPS_TO_KEEP) -> None:
    backups = list_backups(db_dir)
    if len(backups) <= keep:
        return
    backups.sort(key=os.path.getmtime)
    for path in backups[:-keep]:
        try:
            os.remove(path)
        except OSError:
            pass


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
    try:
        if list_backups(db_dir, today_backup_prefix()):
            return
        create_timestamped_backup(db_dir)
        cleanup_old_backups(db_dir)
    except (OSError, sqlite3.Error):
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
    _refresh_investment_classifications()


def _refresh_investment_classifications() -> None:
    """Re-run the investment activity parser when its rules changed since rows were classified."""
    session = get_session()
    try:
        reclassify_stale_investment_transactions(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        close_session(session)
