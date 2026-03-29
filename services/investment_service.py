"""
Read-side helpers for investment portfolio API.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

from db.models import (
    Account,
    InvestmentHoldingSnapshot,
    InvestmentManualPosition,
    InvestmentSyncSnapshot,
    Transaction,
)

UNKNOWN_LABEL = "Unknown investment"
CASH_ALLOCATION_LABEL = "Cash"
RECON_EPS = 0.02


@dataclass
class LatestSnapshotBundle:
    snapshot: InvestmentSyncSnapshot | None
    holdings: list[InvestmentHoldingSnapshot]


def get_latest_snapshot_bundle(session: Session, account_id: int) -> LatestSnapshotBundle:
    snap = (
        session.query(InvestmentSyncSnapshot)
        .filter(InvestmentSyncSnapshot.account_id == account_id)
        .order_by(desc(InvestmentSyncSnapshot.captured_at), desc(InvestmentSyncSnapshot.id))
        .first()
    )
    if not snap:
        return LatestSnapshotBundle(None, [])
    holdings = (
        session.query(InvestmentHoldingSnapshot)
        .filter(InvestmentHoldingSnapshot.snapshot_id == snap.id)
        .all()
    )
    return LatestSnapshotBundle(snap, holdings)


def get_history_series(session: Session, account_id: int, *, limit: int = 365) -> list[dict[str, Any]]:
    rows = (
        session.query(InvestmentSyncSnapshot)
        .filter(InvestmentSyncSnapshot.account_id == account_id)
        .order_by(desc(InvestmentSyncSnapshot.captured_at), desc(InvestmentSyncSnapshot.id))
        .limit(limit)
        .all()
    )
    acct = session.query(Account).filter(Account.id == account_id).first()
    rh_crypto = bool(acct and getattr(acct, "is_robinhood_crypto", False))
    rows.reverse()
    return [
        {
            "captured_at": r.captured_at.isoformat() if r.captured_at else None,
            "total_value": r.positions_value if rh_crypto else r.reported_balance,
            "cash_balance": 0.0 if rh_crypto else r.cash_balance,
            "positions_value": r.positions_value,
            "currency": r.currency,
        }
        for r in rows
    ]


def _holding_to_dict(h: InvestmentHoldingSnapshot) -> dict[str, Any]:
    cost = h.cost_basis
    mv = h.market_value
    gain_pct = None
    if cost is not None and cost > 0 and mv is not None:
        gain_pct = (mv - cost) / cost
    return {
        "external_holding_id": h.external_holding_id,
        "symbol": h.symbol,
        "description": h.description,
        "shares": h.shares,
        "market_value": mv,
        "cost_basis": cost,
        "purchase_price": h.purchase_price,
        "currency": h.currency,
        "gain_pct": gain_pct,
    }


def get_portfolio_detail(session: Session, account_id: int) -> dict[str, Any] | None:
    acct = session.query(Account).filter(Account.id == account_id).first()
    if not acct or acct.type != "investment":
        return None

    rh_crypto = bool(getattr(acct, "is_robinhood_crypto", False))
    bundle = get_latest_snapshot_bundle(session, account_id)
    snap = bundle.snapshot
    manual = (
        session.query(InvestmentManualPosition)
        .filter(InvestmentManualPosition.account_id == account_id)
        .order_by(desc(InvestmentManualPosition.as_of_date))
        .all()
    )
    holdings_mv = sum((h.market_value or 0.0) for h in bundle.holdings)
    manual_mv = sum((m.cost_basis_total or 0.0) for m in manual)

    recent_txns = (
        session.query(Transaction)
        .options(joinedload(Transaction.investment_classification))
        .filter(Transaction.account_id == account_id)
        .order_by(desc(Transaction.date), desc(Transaction.id))
        .limit(40)
        .all()
    )

    activity: list[dict[str, Any]] = []
    for t in recent_txns:
        ic = t.investment_classification
        activity.append(
            {
                "transaction_id": t.id,
                "date": t.date.isoformat() if t.date else None,
                "amount": float(t.amount),
                "merchant": t.merchant,
                "is_transfer": bool(t.is_transfer),
                "kind": ic.kind if ic else None,
                "parsed_symbol": ic.parsed_symbol if ic else None,
                "confidence": ic.confidence if ic else None,
            }
        )

    if rh_crypto:
        positions_value = holdings_mv + manual_mv
        cash_balance = 0.0
        total_value = positions_value
        residual = 0.0
    else:
        positions_value = snap.positions_value if snap else 0.0
        cash_balance = snap.cash_balance if snap else 0.0
        total_value = snap.reported_balance if snap else (acct.reported_balance or 0.0)
        residual = 0.0
        if snap:
            residual = snap.reported_balance - holdings_mv - snap.cash_balance
            if abs(residual) < RECON_EPS:
                residual = 0.0

    return {
        "account": {
            "id": acct.id,
            "name": acct.name,
            "type": acct.type,
            "currency": acct.currency,
            "institution_name": acct.institution_name,
            "is_robinhood_crypto": rh_crypto,
        },
        "latest_snapshot": (
            {
                "captured_at": snap.captured_at.isoformat() if snap.captured_at else None,
                "reported_balance": snap.reported_balance,
                "positions_value": snap.positions_value,
                "cash_balance": 0.0 if rh_crypto else snap.cash_balance,
                "currency": snap.currency,
                "reconciliation_residual": residual,
            }
            if snap
            else None
        ),
        "totals": {
            "total_value": total_value,
            "cash_balance": cash_balance,
            "positions_value": holdings_mv + manual_mv if rh_crypto else positions_value,
        },
        "holdings": [_holding_to_dict(h) for h in bundle.holdings],
        "manual_positions": [
            {
                "id": m.id,
                "symbol": m.symbol,
                "quantity": m.quantity,
                "cost_basis_total": m.cost_basis_total,
                "as_of_date": m.as_of_date.isoformat() if m.as_of_date else None,
                "notes": m.notes,
            }
            for m in manual
        ],
        "activity": activity,
    }


def _rollup_symbol_row(symbol_key: str, market_value: float, shares: float, cost_basis: float | None) -> dict[str, Any]:
    gain_pct = None
    if cost_basis is not None and cost_basis > 0:
        gain_pct = (market_value - cost_basis) / cost_basis
    return {
        "symbol": symbol_key,
        "market_value": market_value,
        "shares": shares,
        "cost_basis": cost_basis,
        "gain_pct": gain_pct,
    }


def get_investments_summary(session: Session) -> dict[str, Any]:
    accounts = session.query(Account).filter(Account.type == "investment").order_by(Account.name).all()
    return _build_summary_clean(session, accounts)


def _build_summary_clean(session: Session, accounts: list[Account]) -> dict[str, Any]:
    """Single pass: custodian totals from latest snap; allocation from holdings + manual + cash row."""
    account_summaries: list[dict[str, Any]] = []
    global_symbols: dict[str, dict[str, float]] = {}
    total_reported = 0.0
    total_cash = 0.0
    unknown_mv = 0.0

    for acct in accounts:
        bundle = get_latest_snapshot_bundle(session, acct.id)
        snap = bundle.snapshot
        manual_list = (
            session.query(InvestmentManualPosition)
            .filter(InvestmentManualPosition.account_id == acct.id)
            .all()
        )
        holdings_mv = sum((h.market_value or 0.0) for h in bundle.holdings)
        manual_mv = sum((m.cost_basis_total or 0.0) for m in manual_list)
        rh_crypto = bool(getattr(acct, "is_robinhood_crypto", False))

        if rh_crypto:
            acct_total = holdings_mv + manual_mv
            total_reported += acct_total
            cash_for_row: float | None = None
        else:
            acct_total = snap.reported_balance if snap else (acct.reported_balance or 0.0)
            if snap:
                total_reported += snap.reported_balance
                total_cash += snap.cash_balance
            elif acct.reported_balance is not None:
                total_reported += float(acct.reported_balance)
            cash_for_row = snap.cash_balance if snap else None

        acct_unknown = 0.0
        for h in bundle.holdings:
            mv = h.market_value or 0.0
            sh = h.shares or 0.0
            cb = h.cost_basis
            if not h.symbol or not str(h.symbol).strip():
                unknown_mv += mv
                acct_unknown += mv
                continue
            key = str(h.symbol).strip().upper()
            bucket = global_symbols.setdefault(key, {"market_value": 0.0, "shares": 0.0, "cost_basis": 0.0})
            bucket["market_value"] += mv
            bucket["shares"] += sh
            if cb is not None:
                bucket["cost_basis"] += float(cb)

        for m in manual_list:
            cb = m.cost_basis_total or 0.0
            sym = (m.symbol or "").strip().upper()
            if not sym:
                unknown_mv += cb
                acct_unknown += cb
                continue
            bucket = global_symbols.setdefault(sym, {"market_value": 0.0, "shares": 0.0, "cost_basis": 0.0})
            bucket["market_value"] += cb
            bucket["shares"] += m.quantity or 0.0
            if cb:
                bucket["cost_basis"] += cb

        account_summaries.append(
            {
                "account_id": acct.id,
                "name": acct.name,
                "institution_name": acct.institution_name,
                "currency": acct.currency,
                "total_value": acct_total,
                "cash_balance": cash_for_row,
                "positions_count": len(bundle.holdings),
                "unknown_on_account": acct_unknown,
                "last_snapshot_at": snap.captured_at.isoformat() if snap and snap.captured_at else None,
            }
        )

    allocation: list[dict[str, Any]] = []
    for sym, b in global_symbols.items():
        mv = b["market_value"]
        sh = b["shares"]
        cb_raw = b["cost_basis"]
        cb = cb_raw if cb_raw > 0 else None
        allocation.append(_rollup_symbol_row(sym, mv, sh, cb))

    if unknown_mv > RECON_EPS:
        allocation.append(
            {
                "symbol": UNKNOWN_LABEL,
                "market_value": unknown_mv,
                "shares": 0.0,
                "cost_basis": None,
                "gain_pct": None,
            }
        )

    allocation.append(
        {
            "symbol": CASH_ALLOCATION_LABEL,
            "market_value": total_cash,
            "shares": 0.0,
            "cost_basis": None,
            "gain_pct": None,
        }
    )

    allocation.sort(key=lambda r: r["market_value"], reverse=True)
    grand_total = total_reported
    if grand_total > RECON_EPS:
        for row in allocation:
            row["percent_of_grand_total"] = row["market_value"] / grand_total
    else:
        for row in allocation:
            row["percent_of_grand_total"] = None

    day_change_pct = None
    if len(accounts) == 1:
        hist = get_history_series(session, accounts[0].id, limit=2)
        if len(hist) >= 2:
            a, b = hist[-2]["total_value"], hist[-1]["total_value"]
            if a and abs(a) > RECON_EPS:
                day_change_pct = (b - a) / a

    return {
        "grand_total": grand_total,
        "total_cash": total_cash,
        "accounts": account_summaries,
        "allocation": allocation,
        "day_change_pct": day_change_pct,
    }
