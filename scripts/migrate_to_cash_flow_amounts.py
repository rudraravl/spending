#!/usr/bin/env python3
"""
One-time migration: legacy card-style signs -> cash-flow canonical signs.

See docs/AMOUNT_CONVENTION.md. Backs up are your responsibility.

Recorded in _schema_migrations. To re-run after restoring an old DB backup, delete that row:
  DELETE FROM _schema_migrations WHERE id = 'cash_flow_amounts_v1';

Usage:
  python scripts/migrate_to_cash_flow_amounts.py --dry-run
  python scripts/migrate_to_cash_flow_amounts.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text

from db.database import engine

MIGRATION_ID = "cash_flow_amounts_v1"


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate transaction amounts to cash-flow convention.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print row counts only; no schema or data changes.",
    )
    args = parser.parse_args()

    with engine.connect() as conn:
        already = conn.execute(
            text(
                """
                SELECT 1 FROM sqlite_master
                WHERE type='table' AND name='_schema_migrations'
                """
            ),
        ).scalar()
        if already:
            already = conn.execute(
                text("SELECT 1 FROM _schema_migrations WHERE id = :id"),
                {"id": MIGRATION_ID},
            ).scalar()
        else:
            already = None

        n_txn = conn.execute(
            text("SELECT COUNT(*) FROM transactions WHERE is_transfer = 0"),
        ).scalar()
        n_txn = int(n_txn or 0)

        n_split = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM transaction_splits ts
                INNER JOIN transactions t ON t.id = ts.transaction_id
                WHERE t.is_transfer = 0
                """
            ),
        ).scalar()
        n_split = int(n_split or 0)

        print(f"Non-transfer transactions: {n_txn}")
        print(f"Split rows on those transactions: {n_split}")
        if already:
            print(f"Status: migration {MIGRATION_ID} already applied.")

        if args.dry_run:
            print("Dry run: no changes made.")
            return

        if already:
            print("Nothing to do.")
            return

    if n_txn == 0:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS _schema_migrations (
                        id TEXT PRIMARY KEY,
                        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """
                )
            )
            conn.execute(
                text("INSERT INTO _schema_migrations (id) VALUES (:id)"),
                {"id": MIGRATION_ID},
            )
        print("No transactions; recorded migration without flipping amounts.")
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS _schema_migrations (
                    id TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
        )
        conn.execute(
            text("UPDATE transactions SET amount = -amount WHERE is_transfer = 0"),
        )
        conn.execute(
            text(
                """
                UPDATE transaction_splits SET amount = -amount
                WHERE transaction_id IN (SELECT id FROM transactions WHERE is_transfer = 0)
                """
            ),
        )
        conn.execute(
            text("INSERT INTO _schema_migrations (id) VALUES (:id)"),
            {"id": MIGRATION_ID},
        )

    print("Migration committed.")


if __name__ == "__main__":
    main()
