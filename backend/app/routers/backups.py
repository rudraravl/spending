from __future__ import annotations

import os
import shutil
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, status

from db.database import DB_PATH

router = APIRouter(tags=["backups"])


def _cleanup_old_backups(db_dir: str, *, keep: int = 5) -> None:
    backups: list[str] = []
    for name in os.listdir(db_dir):
        if not name.startswith("db_backup_") or not name.endswith(".db"):
            continue
        path = os.path.join(db_dir, name)
        if os.path.isfile(path):
            backups.append(path)

    if len(backups) <= keep:
        return

    backups.sort(key=lambda p: os.path.getmtime(p))
    for path in backups[:-keep]:
        try:
            os.remove(path)
        except OSError:
            pass


@router.post("/api/backups/force-today", status_code=status.HTTP_200_OK)
def force_backup_today() -> dict[str, object]:
    """
    Overwrite the most recent DB backup captured on the current day with the
    current DB state.

    If no backup exists yet for today, create a new one.
    """
    if not os.path.exists(DB_PATH):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Database file not found; cannot create backup.",
        )

    db_dir = os.path.dirname(DB_PATH)
    today_prefix = f"db_backup_{date.today().isoformat()}_"

    try:
        today_backups: list[str] = []
        for name in os.listdir(db_dir):
            if not name.startswith(today_prefix) or not name.endswith(".db"):
                continue
            path = os.path.join(db_dir, name)
            if os.path.isfile(path):
                today_backups.append(path)

        if today_backups:
            newest = max(today_backups, key=lambda p: os.path.getmtime(p))
            shutil.copy2(DB_PATH, newest)  # overwrite existing backup
            return {
                "overwritten": True,
                "backup_path": newest,
            }

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        backup_name = f"db_backup_{timestamp}.db"
        backup_path = os.path.join(db_dir, backup_name)
        shutil.copy2(DB_PATH, backup_path)
        _cleanup_old_backups(db_dir, keep=5)

        return {
            "overwritten": False,
            "backup_path": backup_path,
        }
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backup failed: {exc}",
        ) from exc

