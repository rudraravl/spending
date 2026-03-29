"""
SimpleFIN sync orchestration service.

Connects the SimpleFIN HTTP client with the local database:
  * Discovery (balances-only fetch for account mapping)
  * Linking SimpleFIN accounts to local Account rows
  * Full transaction sync with deduplication
  * Balance + timestamp updates
  * Sync run audit trail
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, date, timezone, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session
from urllib.parse import urlparse

from db.models import Account, SimpleFINConnection, SimpleFINSyncRun, Transaction
from services.encryption import decrypt, encrypt
from services.import_service import ensure_category, ensure_subcategory
from services.investment_snapshot_service import record_investment_snapshot
from services.investment_txn_parser import classify_investment_transaction
from services.rule_service import apply_rules_to_transaction
from services.simplefin_client import (
    SFINAccountSet,
    SimpleFINAuthError,
    SimpleFINError,
    claim_access_url,
    get_info,
    get_daily_budget_usage,
    get_accounts,
    get_accounts_with_payload,
    resolve_simplefin_root_url,
    verify_create_endpoint,
)

DEFAULT_LOOKBACK_DAYS = 7
MAX_SIMPLEFIN_WINDOW_DAYS = 90
PROVIDER_NAME = "simplefin"
TXN_SOURCE = "simplefin"
_LATEST_ACCOUNTS_SNAPSHOT_PATH = Path(__file__).resolve().parent.parent / "data" / "simplefin_accounts_latest.json"


# ---------------------------------------------------------------------------
# External-ID helpers (globally unique across connections/accounts)
# ---------------------------------------------------------------------------

def _make_account_external_id(conn_id: str, sfin_account_id: str) -> str:
    return f"simplefin|{conn_id}|{sfin_account_id}"


def _make_txn_external_id(conn_id: str, sfin_account_id: str, txn_id: str) -> str:
    return f"simplefin_tx|{conn_id}|{sfin_account_id}|{txn_id}"


def _normalize_simplefin_amount(raw_amount: str) -> float:
    """
    Default SimpleFIN sign convention:
      - negative => charge / outflow
      - positive => credit / inflow
    """
    return float(raw_amount)


def _compute_sync_start_date_for_linked_accounts(
    session: Session,
    *,
    fallback_start_date: date,
) -> date:
    """
    Determine the global start date for a single /accounts call.

    For linked accounts that already have local transactions, use each account's
    most recent local transaction date as its required start. Since SimpleFIN
    accepts one start-date per request, use the earliest of those required dates
    so all linked accounts are covered. Clamp to protocol's 90-day max window.
    """
    linked_accounts = (
        session.query(Account)
        .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
        .all()
    )

    required_starts: list[date] = []
    for linked in linked_accounts:
        latest_local_txn_date = (
            session.query(Transaction.date)
            .filter(Transaction.account_id == linked.id)
            .order_by(Transaction.date.desc())
            .limit(1)
            .scalar()
        )
        if latest_local_txn_date is not None:
            required_starts.append(latest_local_txn_date)

    computed_start = min(required_starts) if required_starts else fallback_start_date
    max_window_floor = date.today() - timedelta(days=MAX_SIMPLEFIN_WINDOW_DAYS)
    return max(computed_start, max_window_floor)


def _get_singleton_connection_or_none(session: Session) -> SimpleFINConnection | None:
    return (
        session.query(SimpleFINConnection)
        .order_by(SimpleFINConnection.id.asc())
        .first()
    )


def _linked_map(session: Session) -> dict[str, int]:
    existing_map: dict[str, int] = {}
    linked = (
        session.query(Account)
        .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
        .all()
    )
    for acct in linked:
        if acct.external_id:
            existing_map[acct.external_id] = acct.id
    return existing_map


def _build_discovery_from_payload(
    session: Session,
    payload: dict[str, Any],
) -> tuple[list["DiscoveredAccount"], list["DiscoveredConnection"], list[dict]]:
    conn_name_map: dict[str, str] = {}
    for c in payload.get("connections", []) or []:
        if not isinstance(c, dict):
            continue
        cid = str(c.get("conn_id", ""))
        conn_name_map[cid] = str(c.get("name", ""))

    existing_map = _linked_map(session)

    discovered: list[DiscoveredAccount] = []
    for a in payload.get("accounts", []) or []:
        if not isinstance(a, dict):
            continue
        conn_id = str(a.get("conn_id", ""))
        sfin_account_id = str(a.get("id", ""))
        if not conn_id or not sfin_account_id:
            continue
        ext_id = _make_account_external_id(conn_id, sfin_account_id)
        try:
            balance = float(a.get("balance", 0))
        except (TypeError, ValueError):
            balance = 0.0
        try:
            balance_date = int(a.get("balance-date", 0) or 0)
        except (TypeError, ValueError):
            balance_date = 0
        discovered.append(
            DiscoveredAccount(
                conn_id=conn_id,
                conn_name=conn_name_map.get(conn_id, ""),
                account_id=sfin_account_id,
                name=str(a.get("name", "")),
                currency=str(a.get("currency", "USD")),
                balance=balance,
                balance_date=balance_date,
                local_account_id=existing_map.get(ext_id),
            )
        )

    discovered_connections: list[DiscoveredConnection] = []
    for c in payload.get("connections", []) or []:
        if not isinstance(c, dict):
            continue
        discovered_connections.append(
            DiscoveredConnection(
                conn_id=str(c.get("conn_id", "")),
                name=str(c.get("name", "")),
                org_id=str(c.get("org_id", "")),
                org_url=(str(c["org_url"]) if c.get("org_url") is not None else None),
                sfin_url=(str(c["sfin_url"]) if c.get("sfin_url") is not None else None),
            )
        )

    errors: list[dict] = []
    errlist = payload.get("errlist")
    if isinstance(errlist, list):
        for e in errlist:
            if isinstance(e, dict):
                errors.append(
                    {
                        "code": str(e.get("code", "gen.")),
                        "message": str(e.get("msg", e.get("message", "Unknown error"))),
                    }
                )
            else:
                errors.append({"code": "gen.", "message": str(e)})

    return discovered, discovered_connections, errors


def _write_latest_accounts_snapshot(
    connection_id: int,
    payload: dict[str, Any],
    *,
    source: str,
) -> None:
    snapshot = {
        "connection_id": connection_id,
        "source": source,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    try:
        _LATEST_ACCOUNTS_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        _LATEST_ACCOUNTS_SNAPSHOT_PATH.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2))
    except Exception:
        # Non-fatal: syncing/linking should still proceed if debug snapshot write fails.
        return


def get_cached_accounts_snapshot(
    session: Session,
) -> tuple[list["DiscoveredAccount"], list["DiscoveredConnection"], list[dict], str | None]:
    if not _LATEST_ACCOUNTS_SNAPSHOT_PATH.exists():
        return [], [], [], None
    try:
        raw = json.loads(_LATEST_ACCOUNTS_SNAPSHOT_PATH.read_text())
    except Exception:
        return [], [], [{"code": "cache.invalid", "message": "Cached snapshot could not be read."}], None
    payload = raw.get("payload")
    if not isinstance(payload, dict):
        return [], [], [{"code": "cache.invalid", "message": "Cached snapshot payload is invalid."}], None
    accounts, connections, errors = _build_discovery_from_payload(session, payload)
    captured_at = raw.get("captured_at")
    return accounts, connections, errors, str(captured_at) if captured_at else None


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

def create_connection_from_token(
    session: Session,
    token: str,
    label: str = "SimpleFIN",
) -> SimpleFINConnection:
    """Claim a SimpleFIN token and persist the resulting Access URL."""
    access_url = claim_access_url(token)
    return create_connection_from_access_url(session, access_url, label)


def create_connection_from_access_url(
    session: Session,
    access_url: str,
    label: str = "SimpleFIN",
) -> SimpleFINConnection:
    """Persist or replace the singleton SimpleFINConnection Access URL."""
    conn = _get_singleton_connection_or_none(session)
    if conn is None:
        conn = SimpleFINConnection(
            label=label,
            access_url_encrypted=encrypt(access_url),
            status="active",
        )
        session.add(conn)
    else:
        conn.label = label
        conn.access_url_encrypted = encrypt(access_url)
        conn.status = "active"
        conn.last_error = None
    session.commit()
    session.refresh(conn)
    return conn


def list_connections(session: Session) -> list[SimpleFINConnection]:
    conn = _get_singleton_connection_or_none(session)
    return [conn] if conn else []


def get_singleton_connection(session: Session) -> SimpleFINConnection:
    conn = _get_singleton_connection_or_none(session)
    if not conn:
        raise ValueError("SimpleFIN connection not configured yet.")
    return conn


def get_connection(session: Session, connection_id: int) -> SimpleFINConnection:
    conn = session.query(SimpleFINConnection).filter(
        SimpleFINConnection.id == connection_id
    ).first()
    if not conn:
        raise ValueError(f"SimpleFIN connection {connection_id} not found")
    return conn


def update_connection(
    session: Session,
    connection_id: int,
    *,
    label: str | None = None,
    status: str | None = None,
) -> SimpleFINConnection:
    conn = get_connection(session, connection_id)
    if label is not None:
        conn.label = label
    if status is not None:
        conn.status = status
    session.commit()
    session.refresh(conn)
    return conn


def delete_connection(session: Session, connection_id: int) -> None:
    conn = get_connection(session, connection_id)
    # Single-root behavior: unlink all SimpleFIN-linked local accounts without
    # making any remote /accounts request.
    linked = (
        session.query(Account)
        .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
        .all()
    )
    for acct in linked:
        acct.is_linked = False
        acct.provider = None
        acct.external_id = None
        acct.institution_name = None
    session.delete(conn)
    session.commit()


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

@dataclass
class DiscoveredAccount:
    conn_id: str
    conn_name: str
    account_id: str
    name: str
    currency: str
    balance: float
    balance_date: int
    local_account_id: int | None = None  # set if already linked


@dataclass
class DiscoveredConnection:
    conn_id: str
    name: str
    org_id: str
    org_url: str | None = None
    sfin_url: str | None = None


@dataclass
class ProtocolEndpointStatus:
    endpoint: str
    supported: bool
    detail: str


@dataclass
class ProtocolSupportSnapshot:
    root_url: str
    endpoints: list[ProtocolEndpointStatus]


def get_protocol_support_snapshot(
    session: Session,
    *,
    connection_id: int | None = None,
    root_url: str | None = None,
) -> ProtocolSupportSnapshot:
    """
    Return support details for the 4 required SimpleFIN endpoints.
    """
    access_url: str | None = None
    conn: SimpleFINConnection | None = None
    if connection_id is not None:
        conn = get_connection(session, connection_id)
    else:
        conn = _get_singleton_connection_or_none(session)
    if conn is not None:
        access_url = decrypt(conn.access_url_encrypted)

    resolved_root = resolve_simplefin_root_url(root_url=root_url, access_url=access_url)
    statuses: list[ProtocolEndpointStatus] = []

    # 1) GET /info
    versions = get_info(resolved_root)
    statuses.append(
        ProtocolEndpointStatus(
            endpoint="GET /info",
            supported=True,
            detail=f"Protocol versions: {', '.join(versions)}",
        )
    )

    # 2) GET /create
    create_supported, create_status = verify_create_endpoint(resolved_root)
    statuses.append(
        ProtocolEndpointStatus(
            endpoint="GET /create",
            supported=create_supported,
            detail=f"HTTP {create_status}",
        )
    )

    # 3) POST /claim/:token
    claim_url = f"{resolved_root.rstrip('/')}/claim/:token"
    parsed_claim = urlparse(claim_url)
    claim_supported = bool(parsed_claim.scheme == "https" and parsed_claim.netloc)
    statuses.append(
        ProtocolEndpointStatus(
            endpoint="POST /claim/:token",
            supported=claim_supported,
            detail="Claim URL contract available via SimpleFIN token decode.",
        )
    )

    # 4) GET /accounts
    statuses.append(
        ProtocolEndpointStatus(
            endpoint="GET /accounts",
            supported=bool(access_url),
            detail=(
                "Verified on explicit sync only (to preserve daily quota)."
                if access_url
                else "Requires an existing claimed connection."
            ),
        )
    )

    return ProtocolSupportSnapshot(root_url=resolved_root, endpoints=statuses)


def discover_accounts(
    session: Session,
    connection_id: int | None = None,
) -> tuple[list[DiscoveredAccount], list[DiscoveredConnection], list[dict]]:
    """
    Return last cached /accounts snapshot annotated with local mapping status.
    Does not call remote /accounts to avoid consuming daily quota.
    """
    _ = get_connection(session, connection_id) if connection_id is not None else get_singleton_connection(session)
    discovered, discovered_connections, errors, _captured_at = get_cached_accounts_snapshot(session)
    if not discovered and not discovered_connections and not errors:
        errors = [{
            "code": "cache.empty",
            "message": "No cached SimpleFIN accounts yet. Click Sync now to fetch from provider.",
        }]
    return discovered, discovered_connections, errors


def is_account_present_in_cached_snapshot(
    session: Session,
    conn_id: str,
    sfin_account_id: str,
) -> bool:
    accounts, _connections, _errors, _captured_at = get_cached_accounts_snapshot(session)
    return any(a.conn_id == conn_id and a.account_id == sfin_account_id for a in accounts)


def validate_discovered_account(
    session: Session,
    connection_id: int | None,
    conn_id: str,
    sfin_account_id: str,
) -> bool:
    """
    Validate that a remote account exists under this connection's Access URL.
    Uses a targeted /accounts?account=... request to reduce all-accounts quota pressure.
    """
    conn = get_connection(session, connection_id) if connection_id is not None else get_singleton_connection(session)
    access_url = decrypt(conn.access_url_encrypted)
    account_set = get_accounts(
        access_url,
        balances_only=True,
        account_ids=[sfin_account_id],
    )
    return any(a.id == sfin_account_id and a.conn_id == conn_id for a in account_set.accounts)


def get_connection_daily_budget(session: Session, connection_id: int | None = None) -> tuple[int, int]:
    """
    Return local daily SimpleFIN request usage for all-accounts bucket.
    """
    conn = get_connection(session, connection_id) if connection_id is not None else get_singleton_connection(session)
    access_url = decrypt(conn.access_url_encrypted)
    return get_daily_budget_usage(access_url)


# ---------------------------------------------------------------------------
# Account linking
# ---------------------------------------------------------------------------

def link_account(
    session: Session,
    conn_id: str,
    sfin_account_id: str,
    local_account_id: int,
    institution_name: str = "",
) -> Account:
    """
    Link an existing local Account to a specific remote SimpleFIN account.
    Enforces one-to-one mapping between local and remote accounts.
    """
    ext_id = _make_account_external_id(conn_id, sfin_account_id)

    remote_existing = (
        session.query(Account)
        .filter(Account.external_id == ext_id, Account.provider == PROVIDER_NAME)
        .first()
    )
    if remote_existing and remote_existing.id != local_account_id:
        raise ValueError(
            "This SimpleFIN account is already linked to another local account. "
            "Unlink it first before linking elsewhere."
        )

    local_account = session.query(Account).filter(Account.id == local_account_id).first()
    if not local_account:
        raise ValueError(f"Local account {local_account_id} not found.")

    if (
        local_account.provider == PROVIDER_NAME
        and local_account.is_linked
        and local_account.external_id
        and local_account.external_id != ext_id
    ):
        raise ValueError(
            "This local account is already linked to a different SimpleFIN account. "
            "Unlink it first before linking a new one."
        )

    local_account.is_linked = True
    local_account.provider = PROVIDER_NAME
    local_account.external_id = ext_id
    local_account.institution_name = institution_name
    session.commit()
    session.refresh(local_account)
    return local_account


def unlink_account(
    session: Session,
    local_account_id: int,
) -> Account:
    acct = session.query(Account).filter(Account.id == local_account_id).first()
    if not acct:
        raise ValueError(f"Local account {local_account_id} not found.")
    acct.is_linked = False
    acct.provider = None
    acct.external_id = None
    acct.institution_name = None
    session.commit()
    session.refresh(acct)
    return acct


# ---------------------------------------------------------------------------
# Transaction sync
# ---------------------------------------------------------------------------

@dataclass
class SyncResult:
    accounts_synced: int = 0
    transactions_imported: int = 0
    errors: list[str] | None = None


def sync_connection(
    session: Session,
    connection_id: int | None = None,
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    start_date: date | None = None,
    end_date: date | None = None,
    include_pending: bool = False,
) -> SyncResult:
    """
    Run a full sync for a single SimpleFIN connection:
      1. Fetch transactions from SimpleFIN
      2. Match to linked local accounts
      3. Deduplicate and insert new transactions
      4. Update balances and timestamps
      5. Record sync run
    """
    conn = get_connection(session, connection_id) if connection_id is not None else get_singleton_connection(session)
    access_url = decrypt(conn.access_url_encrypted)

    run = SimpleFINSyncRun(
        connection_id=conn.id,
        started_at=datetime.now(timezone.utc),
        status="running",
    )
    session.add(run)
    session.flush()

    try:
        if start_date is None:
            if conn.last_synced_at is not None:
                # Minimize API scope while allowing overlap for late-posting edits.
                fallback_start_date = conn.last_synced_at.date() - timedelta(days=15)
            else:
                fallback_start_date = date.today() - timedelta(days=lookback_days)
            start_date = _compute_sync_start_date_for_linked_accounts(
                session,
                fallback_start_date=fallback_start_date,
            )
        start_epoch = int(time.mktime(start_date.timetuple()))
        end_epoch = int(time.mktime(end_date.timetuple())) if end_date else None

        account_set, payload = get_accounts_with_payload(
            access_url,
            start_date=start_epoch,
            end_date=end_epoch,
            include_pending=include_pending,
        )
        _write_latest_accounts_snapshot(conn.id, payload, source="sync")

        linked_accounts = (
            session.query(Account)
            .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
            .all()
        )
        ext_id_to_local: dict[str, Account] = {}
        for la in linked_accounts:
            if la.external_id:
                ext_id_to_local[la.external_id] = la

        result = SyncResult()
        error_messages: list[str] = []
        for err in account_set.errors:
            error_messages.append(f"[{err.code}] {err.message}")

        other_category = ensure_category(session, "Other")
        other_subcategory = ensure_subcategory(session, "Uncategorized", other_category.id)

        local_has_txn_cache: dict[int, bool] = {}
        full_history_by_external_id: dict[str, SFINAccountSet] = {}

        for sfin_acct in account_set.accounts:
            ext_id = _make_account_external_id(sfin_acct.conn_id, sfin_acct.id)
            local_acct = ext_id_to_local.get(ext_id)
            if not local_acct:
                continue

            if local_acct.id not in local_has_txn_cache:
                local_has_txn_cache[local_acct.id] = (
                    session.query(Transaction.id)
                    .filter(Transaction.account_id == local_acct.id)
                    .first()
                    is not None
                )

            # First-time account bootstrap:
            # if the local account has no transactions yet, pull full history for this
            # specific remote account (no start-date bound).
            #
            # Some aggregators return transactions on the all-accounts response but omit
            # them on ?account=<id> fetches (balance still present). Always prefer the
            # response with the longer transaction list; use the per-account row for
            # reported balance when available.
            account_for_import = sfin_acct
            if not local_has_txn_cache[local_acct.id]:
                if ext_id not in full_history_by_external_id:
                    full_history_by_external_id[ext_id] = get_accounts(
                        access_url,
                        include_pending=include_pending,
                        account_ids=[sfin_acct.id],
                    )
                full_set = full_history_by_external_id[ext_id]
                matched = next(
                    (a for a in full_set.accounts if a.id == sfin_acct.id and a.conn_id == sfin_acct.conn_id),
                    None,
                )
                if matched is not None:
                    if len(matched.transactions) >= len(sfin_acct.transactions):
                        account_for_import = matched

            result.accounts_synced += 1

            # Update balance
            local_acct.reported_balance = float(account_for_import.balance)
            local_acct.reported_balance_at = datetime.now(timezone.utc)

            for txn in account_for_import.transactions:
                txn_ext_id = _make_txn_external_id(account_for_import.conn_id, account_for_import.id, txn.id)

                existing = (
                    session.query(Transaction)
                    .filter(
                        Transaction.source == TXN_SOURCE,
                        Transaction.external_id == txn_ext_id,
                    )
                    .first()
                )
                if existing:
                    continue

                txn_date = datetime.fromtimestamp(txn.posted, tz=timezone.utc).date() if txn.posted else date.today()
                txn_amount = _normalize_simplefin_amount(txn.amount)
                txn_merchant = txn.description

                # Migration-safe fallback dedupe:
                # when switching from CSV/manual imports, avoid inserting an
                # additional row if the transaction already exists by identity.
                existing_legacy = (
                    session.query(Transaction)
                    .filter(
                        Transaction.date == txn_date,
                        Transaction.amount == txn_amount,
                        Transaction.merchant == txn_merchant,
                        Transaction.account_id == local_acct.id,
                    )
                    .first()
                )
                if existing_legacy:
                    continue

                new_txn = Transaction(
                    date=txn_date,
                    amount=txn_amount,
                    merchant=txn_merchant,
                    account_id=local_acct.id,
                    category_id=other_category.id,
                    subcategory_id=other_subcategory.id,
                    source=TXN_SOURCE,
                    external_id=txn_ext_id,
                    status="pending" if txn.pending else "cleared",
                )
                session.add(new_txn)
                session.flush()
                apply_rules_to_transaction(session, new_txn)
                if local_acct.type == "investment":
                    classify_investment_transaction(session, new_txn)
                result.transactions_imported += 1

            holdings = list(account_for_import.holdings or [])
            if not holdings and sfin_acct.holdings:
                holdings = list(sfin_acct.holdings)
            if local_acct.type == "investment" or holdings:
                captured = datetime.now(timezone.utc)
                record_investment_snapshot(
                    session,
                    local_acct,
                    holdings,
                    reported_balance=float(account_for_import.balance),
                    currency=str(account_for_import.currency or "USD"),
                    sync_run_id=run.id,
                    captured_at=captured,
                )

            local_acct.last_synced_at = datetime.now(timezone.utc)

        now = datetime.now(timezone.utc)
        conn.last_synced_at = now
        conn.last_error = "; ".join(error_messages) if error_messages else None
        conn.status = "active"

        run.finished_at = now
        run.status = "success"
        run.accounts_synced = result.accounts_synced
        run.transactions_imported = result.transactions_imported

        if error_messages:
            result.errors = error_messages
            run.error_message = "; ".join(error_messages)

        session.commit()
        return result

    except (SimpleFINError, SimpleFINAuthError) as exc:
        now = datetime.now(timezone.utc)
        conn.last_error = str(exc)
        conn.status = "error"
        run.finished_at = now
        run.status = "error"
        run.error_message = str(exc)
        session.commit()
        raise

    except Exception as exc:
        now = datetime.now(timezone.utc)
        conn.last_error = str(exc)
        conn.status = "error"
        run.finished_at = now
        run.status = "error"
        run.error_message = str(exc)
        session.commit()
        raise SimpleFINError(f"Unexpected sync error: {exc}") from exc


def list_sync_runs(
    session: Session,
    connection_id: int | None,
    limit: int = 20,
) -> list[SimpleFINSyncRun]:
    conn = get_connection(session, connection_id) if connection_id is not None else get_singleton_connection(session)
    return (
        session.query(SimpleFINSyncRun)
        .filter(SimpleFINSyncRun.connection_id == conn.id)
        .order_by(SimpleFINSyncRun.id.desc())
        .limit(limit)
        .all()
    )
