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
from dataclasses import dataclass, field
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
from services.net_worth_service import capture_net_worth_snapshot
from services.zbb_service import recalc_activity_for_months
from utils.timestamps import local_date
from services.rule_service import apply_rules_to_transaction, list_rules
from services.simplefin_client import (
    SFINAccount,
    SFINAccountSet,
    SimpleFINAuthError,
    DailyBudgetUsage,
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
# SimpleFIN hard-caps /accounts ranges at 90 days and warns past 45.
RECOMMENDED_SIMPLEFIN_WINDOW_DAYS = 45
# SimpleFIN counts the range more strictly than start-date-to-now (89.9 elapsed
# days tripped the 90-day cap), so stay a few days inside the recommendation.
MAX_SYNC_WINDOW_DAYS = RECOMMENDED_SIMPLEFIN_WINDOW_DAYS - 3
# Re-fetch this many days before each account's covered-through point so
# transactions that post late (or are backdated by the institution) are caught.
SYNC_OVERLAP_DAYS = 10
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


def _posted_date(posted: int) -> date:
    """
    Local calendar date of a SimpleFIN `posted` timestamp.

    Institutions that only know the posting date encode it as midnight or noon UTC
    of that date; converting those to a US timezone would shift midnight back a day,
    so they keep their UTC date. Real timestamps are converted to local time.
    """
    if not posted:
        return date.today()
    utc = datetime.fromtimestamp(posted, tz=timezone.utc)
    if utc.minute == 0 and utc.second == 0 and utc.hour in (0, 12):
        return utc.date()
    return utc.astimezone().date()


def _account_covered_through(session: Session, account: Account) -> date | None:
    """
    Date through which this account's transactions are known to be imported:
    the later of its last SimpleFIN coverage point and its newest local
    transaction (e.g. a CSV import made after linking). None means the account
    has no history at all and needs a full-history bootstrap.
    """
    candidates: list[date] = []
    if account.sync_covered_through is not None:
        candidates.append(local_date(account.sync_covered_through))
    latest_local_txn_date = (
        session.query(Transaction.date)
        .filter(Transaction.account_id == account.id)
        .order_by(Transaction.date.desc())
        .limit(1)
        .scalar()
    )
    if latest_local_txn_date is not None:
        candidates.append(latest_local_txn_date)
    return max(candidates) if candidates else None


@dataclass
class _SyncWindowPlan:
    start_date: date
    # Local account id -> earliest date that account needs fetched. Accounts
    # absent from this map have no history and are bootstrapped separately.
    required_starts: dict[int, date]
    # (account, covered-through date) for accounts whose missing range starts
    # before the window SimpleFIN will serve; that gap cannot be synced.
    gaps: list[tuple[Account, date]]


def _plan_sync_window(
    session: Session,
    linked_accounts: list[Account],
    *,
    fallback_start_date: date,
    today: date | None = None,
) -> _SyncWindowPlan:
    """
    Pick the single start-date for an all-accounts /accounts call.

    Each linked account needs data from SYNC_OVERLAP_DAYS before the point it is
    already covered through. Coverage comes from SimpleFIN's balance-date (when
    the institution data was last refreshed), so a dormant account that is
    synced regularly stays current instead of dragging every request back to
    its last transaction, and an institution whose refresh has been failing is
    re-fetched from where its data actually stopped.

    The earliest requirement wins, clamped to MAX_SYNC_WINDOW_DAYS.
    """
    today = today or date.today()
    window_floor = today - timedelta(days=MAX_SYNC_WINDOW_DAYS)

    required_starts: dict[int, date] = {}
    covered_through: dict[int, date] = {}
    for account in linked_accounts:
        covered = _account_covered_through(session, account)
        if covered is None:
            continue
        covered_through[account.id] = covered
        required_starts[account.id] = min(covered, today) - timedelta(days=SYNC_OVERLAP_DAYS)

    start = min(required_starts.values()) if required_starts else fallback_start_date
    start = min(max(start, window_floor), today)

    gaps = [
        (account, covered_through[account.id])
        for account in linked_accounts
        if account.id in covered_through and covered_through[account.id] < start
    ]
    return _SyncWindowPlan(start_date=start, required_starts=required_starts, gaps=gaps)


def _data_as_of(sfin_account: SFINAccount, now: datetime) -> datetime:
    """When SimpleFIN last refreshed this account from the institution."""
    if sfin_account.balance_date:
        refreshed = datetime.fromtimestamp(sfin_account.balance_date, tz=timezone.utc)
        return min(refreshed, now)
    return now


def _existing_simplefin_external_ids(session: Session, external_ids: list[str]) -> set[str]:
    found: set[str] = set()
    # Chunked to stay under SQLite's bound-parameter limit.
    for i in range(0, len(external_ids), 500):
        chunk = external_ids[i : i + 500]
        found.update(
            ext_id
            for (ext_id,) in session.query(Transaction.external_id).filter(
                Transaction.source == TXN_SOURCE,
                Transaction.external_id.in_(chunk),
            )
        )
    return found


def _existing_identity_keys(
    session: Session, account_id: int, start: date, end: date
) -> set[tuple[date, float, str]]:
    """(date, amount, merchant) of the account's rows in [start, end], for legacy dedupe."""
    return {
        (d, float(amount), merchant)
        for d, amount, merchant in session.query(
            Transaction.date, Transaction.amount, Transaction.merchant
        ).filter(
            Transaction.account_id == account_id,
            Transaction.date >= start,
            Transaction.date <= end,
        )
    }


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


def _is_external_id_in_cached_snapshot(session: Session, external_id: str) -> bool:
    accounts, _connections, _errors, _captured_at = get_cached_accounts_snapshot(session)
    return any(
        _make_account_external_id(a.conn_id, a.account_id) == external_id for a in accounts
    )


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


def get_connection_daily_budget(session: Session, connection_id: int | None = None) -> DailyBudgetUsage:
    """
    Return SimpleFIN all-accounts request usage over the last 24 hours.
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

    # A stale link (remote account no longer returned by SimpleFIN, e.g. after
    # the institution was reconnected) has no Unlink button in the UI, so it
    # is replaced instead of blocking the new link.
    if (
        local_account.provider == PROVIDER_NAME
        and local_account.is_linked
        and local_account.external_id
        and local_account.external_id != ext_id
        and _is_external_id_in_cached_snapshot(session, local_account.external_id)
    ):
        raise ValueError(
            "This local account is already linked to a different SimpleFIN account. "
            "Unlink it first before linking a new one."
        )

    if local_account.external_id != ext_id:
        # Coverage belonged to the previous remote account; recompute from local
        # transactions (or bootstrap full history if there are none).
        local_account.sync_covered_through = None
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
    # New rows from this sync; seeds transfer detection so only fresh pairs are suggested.
    imported_transaction_ids: list[int] = field(default_factory=list)


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
        linked_accounts = (
            session.query(Account)
            .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
            .all()
        )
        plan = _plan_sync_window(
            session,
            linked_accounts,
            fallback_start_date=date.today() - timedelta(days=lookback_days),
        )
        auto_window = start_date is None
        if auto_window:
            start_date = plan.start_date
        # Both bounds are local midnights, matching how transaction dates are stored.
        # SimpleFIN's end-date is exclusive, so send the day after to include end_date.
        start_epoch = int(time.mktime(start_date.timetuple()))
        end_epoch = int(time.mktime((end_date + timedelta(days=1)).timetuple())) if end_date else None

        account_set, payload = get_accounts_with_payload(
            access_url,
            start_date=start_epoch,
            end_date=end_epoch,
            include_pending=include_pending,
        )
        _write_latest_accounts_snapshot(conn.id, payload, source="sync")

        ext_id_to_local: dict[str, Account] = {}
        for la in linked_accounts:
            if la.external_id:
                ext_id_to_local[la.external_id] = la

        result = SyncResult()
        error_messages: list[str] = []
        for err in account_set.errors:
            error_messages.append(f"[{err.code}] {err.message}")
        if auto_window:
            for gap_account, covered in plan.gaps:
                error_messages.append(
                    f"{gap_account.name}: no synced data since {covered.isoformat()}, and SimpleFIN "
                    f"only serves the last {MAX_SYNC_WINDOW_DAYS} days. Transactions from "
                    f"{covered.isoformat()} to {start_date.isoformat()} may be missing; "
                    "import a CSV to fill the gap."
                )
        # Errors scoped to a connection or account mean its data may be incomplete,
        # so its coverage is not advanced and the next sync re-fetches the range.
        errored_conn_ids = {e.conn_id for e in account_set.errors if e.conn_id and not e.account_id}
        errored_account_ids = {e.account_id for e in account_set.errors if e.account_id}

        other_category = ensure_category(session, "Other")
        other_subcategory = ensure_subcategory(session, "Uncategorized", other_category.id)
        rules = list_rules(session)
        touched_months: set[tuple[int, int]] = set()

        full_history_by_external_id: dict[str, SFINAccountSet] = {}

        for sfin_acct in account_set.accounts:
            ext_id = _make_account_external_id(sfin_acct.conn_id, sfin_acct.id)
            local_acct = ext_id_to_local.get(ext_id)
            if not local_acct:
                continue

            # First-time account bootstrap:
            # if the local account has no history (no transactions and never
            # synced), pull full history for this specific remote account (no
            # start-date bound). Empty accounts are only bootstrapped once.
            #
            # Some aggregators return transactions on the all-accounts response but omit
            # them on ?account=<id> fetches (balance still present). Always prefer the
            # response with the longer transaction list; use the per-account row for
            # reported balance when available.
            account_for_import = sfin_acct
            needs_bootstrap = local_acct.id not in plan.required_starts
            if needs_bootstrap:
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

            # Dedupe lookups for the whole batch up front instead of two queries per row.
            remote_txns = [
                (
                    txn,
                    _make_txn_external_id(account_for_import.conn_id, account_for_import.id, txn.id),
                    _posted_date(txn.posted),
                )
                for txn in account_for_import.transactions
            ]
            seen_ext_ids = _existing_simplefin_external_ids(session, [ext for _, ext, _ in remote_txns])
            seen_identities: set[tuple[date, float, str]] = set()
            if remote_txns:
                txn_dates = [d for _, _, d in remote_txns]
                seen_identities = _existing_identity_keys(session, local_acct.id, min(txn_dates), max(txn_dates))

            new_txns: list[Transaction] = []
            for txn, txn_ext_id, txn_date in remote_txns:
                if txn_ext_id in seen_ext_ids:
                    continue

                txn_amount = _normalize_simplefin_amount(txn.amount)
                txn_merchant = txn.description

                # Migration-safe fallback dedupe:
                # when switching from CSV/manual imports, avoid inserting an
                # additional row if the transaction already exists by identity.
                identity = (txn_date, txn_amount, txn_merchant)
                if identity in seen_identities:
                    continue
                seen_ext_ids.add(txn_ext_id)
                seen_identities.add(identity)

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
                apply_rules_to_transaction(session, new_txn, rules)
                if local_acct.type == "investment":
                    classify_investment_transaction(session, new_txn)
                new_txns.append(new_txn)
                touched_months.add((txn_date.year, txn_date.month))

            if new_txns:
                session.flush()
            result.transactions_imported += len(new_txns)
            result.imported_transaction_ids.extend(t.id for t in new_txns)

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

            now = datetime.now(timezone.utc)
            local_acct.last_synced_at = now
            # Advance coverage only when this fetch reached back to what the account
            # needed (a clamped automatic window is as far as SimpleFIN goes, and its
            # gap was reported above) and ran to the present.
            window_reached_account = (
                needs_bootstrap
                or auto_window
                or start_date <= plan.required_starts[local_acct.id]
            )
            account_errored = (
                sfin_acct.id in errored_account_ids or sfin_acct.conn_id in errored_conn_ids
            )
            if end_date is None and window_reached_account and not account_errored:
                local_acct.sync_covered_through = _data_as_of(account_for_import, now)

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

        if touched_months:
            recalc_activity_for_months(session, touched_months)

        # Record one aggregate net-worth point per sync run so the dashboard can
        # plot trend history over time.
        capture_net_worth_snapshot(
            session,
            captured_at=now,
            simplefin_sync_run_id=run.id,
        )

        session.commit()
        return result

    except SimpleFINError as exc:
        # Provider errors happen before an account's rows are imported, so accounts
        # already processed (and their coverage) are kept.
        now = datetime.now(timezone.utc)
        conn.last_error = str(exc)
        conn.status = "error"
        run.finished_at = now
        run.status = "error"
        run.error_message = str(exc)
        session.commit()
        raise

    except Exception as exc:
        # Possibly a failed flush, which leaves the session unusable: roll back
        # before recording the failure (committing would raise and hide the error).
        started_at = run.started_at
        session.rollback()
        now = datetime.now(timezone.utc)
        conn = get_connection(session, conn.id)
        conn.last_error = str(exc)
        conn.status = "error"
        session.add(
            SimpleFINSyncRun(
                connection_id=conn.id,
                started_at=started_at,
                finished_at=now,
                status="error",
                error_message=str(exc),
            )
        )
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
