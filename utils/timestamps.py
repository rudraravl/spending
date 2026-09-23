"""Helpers for timestamps stored as UTC.

Every DateTime column is written in UTC (SQLite CURRENT_TIMESTAMP, utcnow,
datetime.now(timezone.utc)), but SQLite hands values back without tzinfo.
Serialized as-is, browsers parse them as local time, shifting them by the UTC
offset. Label them as UTC before they leave the backend.
"""

from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def utc_isoformat(value: datetime | None) -> str | None:
    return as_utc(value).isoformat() if value is not None else None
