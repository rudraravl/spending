from __future__ import annotations

import os
import shutil
from datetime import date, datetime

from db.database import DB_PATH, init_db


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


def init_database() -> None:
    """Initialize (and rebuild if necessary) the SQLite database."""

    init_db()

