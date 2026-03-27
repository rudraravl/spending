#!/usr/bin/env python3
"""
Idempotent daily SimpleFIN sync runner.

Designed to be called by cron / systemd timer / launchd once per day.
Only syncs connections whose last_synced_at is older than --min-interval-hours
(default 20 hours, so a 24-hour cron job has leeway).

Usage from repo root (venv active):
    python -m backend.scripts.simplefin_sync_once

Or directly:
    python backend/scripts/simplefin_sync_once.py
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure repo root is on sys.path so domain packages resolve.
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from dotenv import load_dotenv
load_dotenv(Path(_REPO_ROOT) / ".env", override=False)

from db.database import get_session, close_session, init_db
from db.models import SimpleFINConnection
from services.simplefin_sync_service import sync_connection


def main() -> None:
    parser = argparse.ArgumentParser(description="Run SimpleFIN sync for due connections.")
    parser.add_argument(
        "--lookback-days", type=int, default=7,
        help="Number of days to look back for transactions (default: 7)",
    )
    parser.add_argument(
        "--min-interval-hours", type=float, default=20.0,
        help="Skip connections synced more recently than this (default: 20)",
    )
    args = parser.parse_args()

    init_db()

    session = get_session()
    try:
        conns = (
            session.query(SimpleFINConnection)
            .filter(SimpleFINConnection.status == "active")
            .all()
        )
        if not conns:
            print("No active SimpleFIN connections found.")
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=args.min_interval_hours)
        due = [c for c in conns if c.last_synced_at is None or c.last_synced_at < cutoff]

        if not due:
            print(f"All {len(conns)} connections synced within the last {args.min_interval_hours}h. Nothing to do.")
            return

        for conn in due:
            print(f"Syncing connection {conn.id} ({conn.label})...")
            try:
                result = sync_connection(session, conn.id, lookback_days=args.lookback_days)
                print(
                    f"  OK: {result.accounts_synced} accounts, "
                    f"{result.transactions_imported} new transactions."
                )
                if result.errors:
                    for err in result.errors:
                        print(f"  Warning: {err}")
            except Exception as exc:
                print(f"  ERROR: {exc}")

    finally:
        close_session(session)


if __name__ == "__main__":
    main()
