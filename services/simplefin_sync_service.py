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

import time
from dataclasses import dataclass
from datetime import datetime, date, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from db.models import Account, SimpleFINConnection, SimpleFINSyncRun, Transaction
from services.encryption import decrypt, encrypt
from services.import_service import ensure_category, ensure_subcategory
from services.rule_service import apply_rules_to_transaction
from services.simplefin_client import (
    SFINAccountSet,
    SimpleFINAuthError,
    SimpleFINError,
    claim_access_url,
    get_daily_budget_usage,
    get_accounts,
)

DEFAULT_LOOKBACK_DAYS = 7
PROVIDER_NAME = "simplefin"
TXN_SOURCE = "simplefin"


# ---------------------------------------------------------------------------
# External-ID helpers (globally unique across connections/accounts)
# ---------------------------------------------------------------------------

def _make_account_external_id(conn_id: str, sfin_account_id: str) -> str:
    return f"simplefin|{conn_id}|{sfin_account_id}"


def _make_txn_external_id(conn_id: str, sfin_account_id: str, txn_id: str) -> str:
    return f"simplefin_tx|{conn_id}|{sfin_account_id}|{txn_id}"


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
    """Persist an already-claimed Access URL as a new SimpleFINConnection."""
    conn = SimpleFINConnection(
        label=label,
        access_url_encrypted=encrypt(access_url),
        status="active",
    )
    session.add(conn)
    session.commit()
    session.refresh(conn)
    return conn


def list_connections(session: Session) -> list[SimpleFINConnection]:
    return (
        session.query(SimpleFINConnection)
        .order_by(SimpleFINConnection.id.asc())
        .all()
    )


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
    # Unlink only accounts that belong to this connection's SimpleFIN namespace(s).
    access_url = decrypt(conn.access_url_encrypted)
    account_set = get_accounts(access_url, balances_only=True)
    conn_ids = {c.conn_id for c in account_set.connections}
    conn_ids.update(a.conn_id for a in account_set.accounts if a.conn_id)

    if conn_ids:
        linked = (
            session.query(Account)
            .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
            .all()
        )
        for acct in linked:
            external_id = acct.external_id or ""
            if any(external_id.startswith(f"simplefin|{cid}|") for cid in conn_ids):
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


def discover_accounts(
    session: Session,
    connection_id: int,
) -> tuple[list[DiscoveredAccount], list[dict]]:
    """
    Fetch balances-only from SimpleFIN and annotate with local mapping status.
    Returns (discovered_accounts, sanitized_errors).
    """
    conn = get_connection(session, connection_id)
    access_url = decrypt(conn.access_url_encrypted)

    account_set = get_accounts(access_url, balances_only=True)

    conn_name_map: dict[str, str] = {}
    for c in account_set.connections:
        conn_name_map[c.conn_id] = c.name

    existing_map: dict[str, int] = {}
    linked = (
        session.query(Account)
        .filter(Account.provider == PROVIDER_NAME, Account.is_linked.is_(True))
        .all()
    )
    for acct in linked:
        if acct.external_id:
            existing_map[acct.external_id] = acct.id

    discovered: list[DiscoveredAccount] = []
    for sa in account_set.accounts:
        ext_id = _make_account_external_id(sa.conn_id, sa.id)
        discovered.append(DiscoveredAccount(
            conn_id=sa.conn_id,
            conn_name=conn_name_map.get(sa.conn_id, ""),
            account_id=sa.id,
            name=sa.name,
            currency=sa.currency,
            balance=float(sa.balance),
            balance_date=sa.balance_date,
            local_account_id=existing_map.get(ext_id),
        ))

    errors = [{"code": e.code, "message": e.message} for e in account_set.errors]
    return discovered, errors


def validate_discovered_account(
    session: Session,
    connection_id: int,
    conn_id: str,
    sfin_account_id: str,
) -> bool:
    """
    Validate that a remote account exists under this connection's Access URL.
    Uses a targeted /accounts?account=... request to reduce all-accounts quota pressure.
    """
    conn = get_connection(session, connection_id)
    access_url = decrypt(conn.access_url_encrypted)
    account_set = get_accounts(
        access_url,
        balances_only=True,
        account_ids=[sfin_account_id],
    )
    return any(a.id == sfin_account_id and a.conn_id == conn_id for a in account_set.accounts)


def get_connection_daily_budget(session: Session, connection_id: int) -> tuple[int, int]:
    """
    Return local daily SimpleFIN request usage for all-accounts bucket.
    """
    conn = get_connection(session, connection_id)
    access_url = decrypt(conn.access_url_encrypted)
    return get_daily_budget_usage(access_url)


# ---------------------------------------------------------------------------
# Account linking
# ---------------------------------------------------------------------------

def link_account(
    session: Session,
    connection_id: int,
    conn_id: str,
    sfin_account_id: str,
    local_name: str,
    local_type: str,
    currency: str = "USD",
    institution_name: str = "",
) -> Account:
    """
    Create (or update) a local Account linked to a SimpleFIN external account.
    """
    local_name = local_name.strip()
    if not local_name:
        raise ValueError("Local account name is required.")

    ext_id = _make_account_external_id(conn_id, sfin_account_id)

    existing = (
        session.query(Account)
        .filter(Account.external_id == ext_id, Account.provider == PROVIDER_NAME)
        .first()
    )
    if existing:
        conflicting = (
            session.query(Account)
            .filter(Account.name == local_name, Account.id != existing.id)
            .first()
        )
        if conflicting:
            raise ValueError(
                f'Account name "{local_name}" is already in use. '
                "Choose a different local name."
            )
        existing.name = local_name
        existing.type = local_type
        existing.currency = currency
        existing.institution_name = institution_name
        existing.is_linked = True
        session.commit()
        session.refresh(existing)
        return existing

    conflicting = session.query(Account).filter(Account.name == local_name).first()
    if conflicting:
        raise ValueError(
            f'Account name "{local_name}" is already in use. '
            "Choose a different local name."
        )

    acct = Account(
        name=local_name,
        type=local_type,
        currency=currency,
        is_linked=True,
        provider=PROVIDER_NAME,
        external_id=ext_id,
        institution_name=institution_name,
    )
    session.add(acct)
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
    connection_id: int,
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
    conn = get_connection(session, connection_id)
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
                start_date = conn.last_synced_at.date() - timedelta(days=15)
            else:
                start_date = date.today() - timedelta(days=lookback_days)
        start_epoch = int(time.mktime(start_date.timetuple()))
        end_epoch = int(time.mktime(end_date.timetuple())) if end_date else None

        account_set = get_accounts(
            access_url,
            start_date=start_epoch,
            end_date=end_epoch,
            include_pending=include_pending,
        )

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
                txn_amount = float(txn.amount)
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
                result.transactions_imported += 1

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
    connection_id: int,
    limit: int = 20,
) -> list[SimpleFINSyncRun]:
    return (
        session.query(SimpleFINSyncRun)
        .filter(SimpleFINSyncRun.connection_id == connection_id)
        .order_by(SimpleFINSyncRun.id.desc())
        .limit(limit)
        .all()
    )
