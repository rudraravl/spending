"""
SimpleFIN HTTP client – thin wrapper around the SimpleFIN Protocol v2.

Responsibilities:
  * Token claim flow (Base64-decode token -> POST -> get Access URL)
  * GET /accounts with optional query params
  * HTTPS-only enforcement and TLS verification
  * Structured parsing of the v2 Account Set response
  * Error sanitization for UI display
"""

from __future__ import annotations

import base64
import html
import hashlib
import json
import os
from datetime import date
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

import httpx


class SimpleFINError(Exception):
    """User-safe error raised by the SimpleFIN client."""


class SimpleFINAuthError(SimpleFINError):
    """Raised on 403 responses (revoked access, bad credentials, compromised token)."""


# ---------------------------------------------------------------------------
# Data classes mirroring the SimpleFIN v2 protocol
# ---------------------------------------------------------------------------

@dataclass
class SFINError:
    code: str
    message: str
    conn_id: str | None = None
    account_id: str | None = None


@dataclass
class SFINConnection:
    conn_id: str
    name: str
    org_id: str
    org_url: str | None = None
    sfin_url: str | None = None


@dataclass
class SFINTransaction:
    id: str
    posted: int
    amount: str
    description: str
    transacted_at: int | None = None
    pending: bool = False


@dataclass
class SFINAccount:
    id: str
    name: str
    conn_id: str
    currency: str
    balance: str
    balance_date: int
    available_balance: str | None = None
    transactions: list[SFINTransaction] = field(default_factory=list)


@dataclass
class SFINAccountSet:
    errors: list[SFINError] = field(default_factory=list)
    connections: list[SFINConnection] = field(default_factory=list)
    accounts: list[SFINAccount] = field(default_factory=list)

_RATE_LOCK = Lock()
_RATE_FILE = Path(__file__).resolve().parent.parent / "data" / ".simplefin_rate_usage.json"
_DEFAULT_DAILY_LIMIT = 20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize(text: str) -> str:
    return html.escape(text, quote=True)


def _ensure_https(url: str) -> None:
    if not url.startswith("https://"):
        raise SimpleFINError("SimpleFIN requires HTTPS URLs; refusing to use an insecure URL.")


def _get_daily_limit() -> int:
    raw = os.getenv("SIMPLEFIN_MAX_REQUESTS_PER_DAY")
    if raw is None:
        return _DEFAULT_DAILY_LIMIT
    try:
        parsed = int(raw)
    except ValueError:
        return _DEFAULT_DAILY_LIMIT
    return max(1, parsed)


def _access_scope_key(access_url: str) -> str:
    parsed = urlparse(access_url)
    # Include username + host + path and hash so the on-disk key never stores credentials.
    basis = f"{parsed.username or ''}|{parsed.hostname or ''}|{parsed.path or ''}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def _account_bucket(account_ids: list[str] | None) -> str:
    if not account_ids:
        return "all_accounts"
    if len(account_ids) == 1:
        return f"account:{account_ids[0]}"
    # Multiple account filters are semantically close to all-accounts fanout.
    return "all_accounts"


def _enforce_daily_budget(access_url: str, account_ids: list[str] | None) -> None:
    today = date.today().isoformat()
    scope = _access_scope_key(access_url)
    bucket = _account_bucket(account_ids)
    limit = _get_daily_limit()

    with _RATE_LOCK:
        data: dict[str, Any] = {}
        if _RATE_FILE.exists():
            try:
                data = json.loads(_RATE_FILE.read_text())
            except Exception:
                data = {}

        day_data = data.setdefault(today, {})
        scope_data = day_data.setdefault(scope, {})
        used = int(scope_data.get(bucket, 0))
        if used >= limit:
            raise SimpleFINError(
                "SimpleFIN daily request budget reached for this connection. "
                "Try again later today or lower request frequency."
            )
        scope_data[bucket] = used + 1

        # Retain only recent days to keep file small.
        for key in list(data.keys()):
            if key != today:
                data.pop(key, None)

        _RATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _RATE_FILE.write_text(json.dumps(data))


def get_daily_budget_usage(access_url: str, *, account_ids: list[str] | None = None) -> tuple[int, int]:
    """
    Return (used, limit) for today's local SimpleFIN request budget bucket.
    """
    today = date.today().isoformat()
    scope = _access_scope_key(access_url)
    bucket = _account_bucket(account_ids)
    limit = _get_daily_limit()

    with _RATE_LOCK:
        data: dict[str, Any] = {}
        if _RATE_FILE.exists():
            try:
                data = json.loads(_RATE_FILE.read_text())
            except Exception:
                data = {}
        used = int(data.get(today, {}).get(scope, {}).get(bucket, 0))
    return used, limit


def _parse_errors(raw: list[Any]) -> list[SFINError]:
    out: list[SFINError] = []
    for e in raw:
        if isinstance(e, dict):
            out.append(SFINError(
                code=str(e.get("code", "gen.")),
                message=_sanitize(str(e.get("msg", e.get("message", "Unknown error")))),
                conn_id=e.get("conn_id"),
                account_id=e.get("account_id"),
            ))
            continue
        out.append(SFINError(code="gen.", message=_sanitize(str(e))))
    return out


def _parse_connections(raw: list[dict[str, Any]]) -> list[SFINConnection]:
    out: list[SFINConnection] = []
    for c in raw:
        out.append(SFINConnection(
            conn_id=str(c["conn_id"]),
            name=_sanitize(str(c.get("name", ""))),
            org_id=str(c.get("org_id", "")),
            org_url=c.get("org_url"),
            sfin_url=c.get("sfin_url"),
        ))
    return out


def _parse_transactions(raw: list[dict[str, Any]]) -> list[SFINTransaction]:
    out: list[SFINTransaction] = []
    for t in raw:
        out.append(SFINTransaction(
            id=str(t["id"]),
            posted=int(t.get("posted", 0)),
            amount=str(t["amount"]),
            description=_sanitize(str(t.get("description", ""))),
            transacted_at=int(t["transacted_at"]) if t.get("transacted_at") else None,
            pending=bool(t.get("pending", False)),
        ))
    return out


def _parse_accounts(raw: list[dict[str, Any]]) -> list[SFINAccount]:
    out: list[SFINAccount] = []
    for a in raw:
        out.append(SFINAccount(
            id=str(a["id"]),
            name=_sanitize(str(a.get("name", ""))),
            conn_id=str(a.get("conn_id", "")),
            currency=str(a.get("currency", "USD")),
            balance=str(a["balance"]),
            balance_date=int(a.get("balance-date", 0)),
            available_balance=a.get("available-balance"),
            transactions=_parse_transactions(a.get("transactions", [])),
        ))
    return out


def _parse_account_set(data: dict[str, Any]) -> SFINAccountSet:
    errlist_raw = data.get("errlist", [])
    errors_raw = data.get("errors", [])
    normalized_errors: list[Any] = errlist_raw if isinstance(errlist_raw, list) else []
    if not normalized_errors and isinstance(errors_raw, list):
        normalized_errors = errors_raw

    return SFINAccountSet(
        errors=_parse_errors(normalized_errors),
        connections=_parse_connections(data.get("connections", [])),
        accounts=_parse_accounts(data.get("accounts", [])),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def claim_access_url(token: str) -> str:
    """
    Claim an Access URL from a SimpleFIN Token.

    The token is Base64-encoded. Decoding yields a claim URL.
    POST-ing to the claim URL returns the Access URL (with Basic Auth embedded).
    """
    try:
        claim_url = base64.b64decode(token).decode("utf-8")
    except Exception as exc:
        raise SimpleFINError("Invalid SimpleFIN token (could not Base64-decode).") from exc

    _ensure_https(claim_url)

    with httpx.Client(verify=True, timeout=30.0) as client:
        resp = client.post(claim_url)

    if resp.status_code == 403:
        raise SimpleFINAuthError(
            "Token claim failed (403). The token may have already been used or "
            "may be compromised. Please disable the token at your institution "
            "and create a new one."
        )
    if resp.status_code != 200:
        raise SimpleFINError(f"Token claim failed with HTTP {resp.status_code}.")

    access_url = resp.text.strip()
    _ensure_https(access_url)
    return access_url


def get_accounts(
    access_url: str,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    include_pending: bool = False,
    balances_only: bool = False,
    account_ids: list[str] | None = None,
) -> SFINAccountSet:
    """
    Fetch accounts (and optionally transactions) from a SimpleFIN server.

    ``access_url`` must include Basic Auth credentials
    (e.g. ``https://user:pass@host/simplefin``).
    """
    _ensure_https(access_url)
    _enforce_daily_budget(access_url, account_ids)

    params: list[tuple[str, str]] = [("version", "2")]
    if start_date is not None:
        params.append(("start-date", str(start_date)))
    if end_date is not None:
        params.append(("end-date", str(end_date)))
    if include_pending:
        params.append(("pending", "1"))
    if balances_only:
        params.append(("balances-only", "1"))
    if account_ids:
        for aid in account_ids:
            params.append(("account", aid))

    url = f"{access_url.rstrip('/')}/accounts"

    with httpx.Client(verify=True, timeout=60.0) as client:
        resp = client.get(url, params=params)

    if resp.status_code == 403:
        raise SimpleFINAuthError(
            "Access denied (403). Your SimpleFIN access may have been revoked. "
            "Please reconnect your institution."
        )
    if resp.status_code == 402:
        raise SimpleFINError("Payment required (402). Please check your SimpleFIN subscription.")
    if resp.status_code != 200:
        raise SimpleFINError(f"SimpleFIN request failed with HTTP {resp.status_code}.")

    data = resp.json()
    return _parse_account_set(data)
