from __future__ import annotations

import os
import sqlite3

from fastapi import APIRouter, HTTPException, status

from backend.app.startup import (
    cleanup_old_backups,
    copy_db_to,
    create_timestamped_backup,
    list_backups,
    today_backup_prefix,
)
from db.database import DB_PATH

router = APIRouter(tags=["backups"])


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

    try:
        today_backups = list_backups(db_dir, today_backup_prefix())
        if today_backups:
            newest = max(today_backups, key=os.path.getmtime)
            copy_db_to(newest)  # overwrite existing backup
            return {
                "overwritten": True,
                "backup_path": newest,
            }

        backup_path = create_timestamped_backup(db_dir)
        cleanup_old_backups(db_dir)

        return {
            "overwritten": False,
            "backup_path": backup_path,
        }
    except (OSError, sqlite3.Error) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backup failed: {exc}",
        ) from exc
