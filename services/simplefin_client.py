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
import re
from datetime import date
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse, urlunparse

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
class SFINHolding:
    """Investment position line from SimpleFIN (e.g. Robinhood via bridge)."""

    id: str
    currency: str
    description: str
    market_value: str
    shares: str
    symbol: str | None
    cost_basis: str | None = None
    purchase_price: str | None = None
    created: int | None = None


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
    holdings: list[SFINHolding] = field(default_factory=list)


@dataclass
class SFINAccountSet:
    errors: list[SFINError] = field(default_factory=list)
    connections: list[SFINConnection] = field(default_factory=list)
    accounts: list[SFINAccount] = field(default_factory=list)

_RATE_LOCK = Lock()
_RATE_FILE = Path(__file__).resolve().parent.parent / "data" / ".simplefin_rate_usage.json"
_DEFAULT_DAILY_LIMIT = 24
_DEFAULT_SIMPLEFIN_ROOT_URL = "https://bridge.simplefin.org/simplefin"
_VERSION_RE = re.compile(r"^\d+\.\d+(?:\.\d+)?$|^\d+$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize(text: str) -> str:
    return html.escape(text, quote=True)


def _ensure_https(url: str) -> None:
    if not url.startswith("https://"):
        raise SimpleFINError("SimpleFIN requires HTTPS URLs; refusing to use an insecure URL.")


def _join_root_url(root_url: str, endpoint: str) -> str:
    return f"{root_url.rstrip('/')}/{endpoint.lstrip('/')}"


def _sanitize_root_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        raise SimpleFINError("Invalid SimpleFIN root URL.")
    host = parsed.hostname or ""
    if not host:
        raise SimpleFINError("Invalid SimpleFIN root URL host.")
    netloc = host
    if parsed.port is not None:
        netloc = f"{host}:{parsed.port}"
    cleaned = parsed._replace(netloc=netloc, params="", query="", fragment="")
    root = urlunparse(cleaned)
    return root.rstrip("/")


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


def resolve_simplefin_root_url(
    root_url: str | None = None,
    access_url: str | None = None,
) -> str:
    """
    Resolve the SimpleFIN root URL used for /info and /create verification.

    Priority:
      1) explicit ``root_url`` argument
      2) ``SIMPLEFIN_ROOT_URL`` env var
      3) derive from claimed access URL by stripping credentials
      4) protocol default bridge URL
    """
    candidate = (root_url or os.getenv("SIMPLEFIN_ROOT_URL") or "").strip()
    if candidate:
        _ensure_https(candidate)
        return _sanitize_root_url(candidate)

    if access_url:
        _ensure_https(access_url)
        return _sanitize_root_url(access_url)

    _ensure_https(_DEFAULT_SIMPLEFIN_ROOT_URL)
    return _DEFAULT_SIMPLEFIN_ROOT_URL


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


def _first_str(d: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = d.get(k)
        if v is None or v == "":
            continue
        return str(v)
    return None


def _parse_holdings(raw: Any) -> list[SFINHolding]:
    if not isinstance(raw, list):
        return []
    out: list[SFINHolding] = []
    for h in raw:
        if not isinstance(h, dict):
            continue
        hid = h.get("id")
        if hid is None:
            continue
        sym = _first_str(h, "symbol", "Symbol")
        sym_clean = sym.strip().upper() if sym else None
        if sym_clean == "":
            sym_clean = None
        desc_raw = _first_str(h, "description", "Description") or ""
        mv = _first_str(h, "market_value", "market-value", "MarketValue")
        sh = _first_str(h, "shares", "Shares")
        if mv is None:
            mv = "0"
        if sh is None:
            sh = "0"
        cur = _first_str(h, "currency", "Currency") or "USD"
        created_raw = h.get("created") or h.get("Created")
        created: int | None = None
        if created_raw is not None:
            try:
                created = int(created_raw)
            except (TypeError, ValueError):
                created = None
        out.append(
            SFINHolding(
                id=str(hid),
                currency=cur,
                description=_sanitize(desc_raw),
                market_value=mv,
                shares=sh,
                symbol=sym_clean,
                cost_basis=_first_str(h, "cost_basis", "cost-basis", "CostBasis"),
                purchase_price=_first_str(h, "purchase_price", "purchase-price", "PurchasePrice"),
                created=created,
            )
        )
    return out


def _parse_accounts(raw: list[dict[str, Any]]) -> list[SFINAccount]:
    out: list[SFINAccount] = []
    for a in raw:
        avail = _first_str(a, "available-balance", "available_balance", "AvailableBalance")
        out.append(SFINAccount(
            id=str(a["id"]),
            name=_sanitize(str(a.get("name", ""))),
            conn_id=str(a.get("conn_id", "")),
            currency=str(a.get("currency", "USD")),
            balance=str(a["balance"]),
            balance_date=int(a.get("balance-date", a.get("balance_date", 0))),
            available_balance=avail,
            transactions=_parse_transactions(a.get("transactions", [])),
            holdings=_parse_holdings(a.get("holdings", [])),
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


def get_info(root_url: str) -> list[str]:
    """
    Fetch protocol versions from GET /info and validate shape.
    """
    _ensure_https(root_url)
    url = _join_root_url(_sanitize_root_url(root_url), "/info")
    with httpx.Client(verify=True, timeout=30.0) as client:
        resp = client.get(url)
    if resp.status_code != 200:
        raise SimpleFINError(f"SimpleFIN /info failed with HTTP {resp.status_code}.")

    try:
        payload = resp.json()
    except Exception as exc:
        raise SimpleFINError("SimpleFIN /info returned non-JSON data.") from exc

    versions = payload.get("versions")
    if not isinstance(versions, list) or not versions:
        raise SimpleFINError("SimpleFIN /info response missing 'versions' array.")
    normalized = [str(v).strip() for v in versions if str(v).strip()]
    if not normalized:
        raise SimpleFINError("SimpleFIN /info returned empty protocol versions.")
    if any(not _VERSION_RE.match(v) for v in normalized):
        raise SimpleFINError("SimpleFIN /info returned invalid version format.")
    return normalized


def verify_create_endpoint(root_url: str) -> tuple[bool, int]:
    """
    Lightweight verification for GET /create endpoint presence.

    Returns (supported, status_code). ``supported`` is true for expected
    interactive/auth statuses and false for clear endpoint absence.
    """
    _ensure_https(root_url)
    url = _join_root_url(_sanitize_root_url(root_url), "/create")
    with httpx.Client(verify=True, timeout=30.0, follow_redirects=False) as client:
        resp = client.get(url)
    supported = resp.status_code in {200, 301, 302, 303, 307, 308, 401, 403}
    if not supported and resp.status_code >= 500:
        raise SimpleFINError(f"SimpleFIN /create failed with HTTP {resp.status_code}.")
    return supported, resp.status_code


def get_accounts(
    access_url: str,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    include_pending: bool = False,
    balances_only: bool = False,
    account_ids: list[str] | None = None,
) -> SFINAccountSet:
    account_set, _payload = get_accounts_with_payload(
        access_url,
        start_date=start_date,
        end_date=end_date,
        include_pending=include_pending,
        balances_only=balances_only,
        account_ids=account_ids,
    )
    return account_set


def get_accounts_with_payload(
    access_url: str,
    *,
    start_date: int | None = None,
    end_date: int | None = None,
    include_pending: bool = False,
    balances_only: bool = False,
    account_ids: list[str] | None = None,
) -> tuple[SFINAccountSet, dict[str, Any]]:
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
    return _parse_account_set(data), data
