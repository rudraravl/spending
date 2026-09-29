"""
Portfolio performance derived from sync snapshots.

SimpleFIN reports no cost basis and deposits/withdrawals do not appear as transactions, so raw value
change mixes market movement with money moved in or out. Instead we split each interval between two
consecutive snapshots into:

* market gain  = sum over held symbols of min(shares_before, shares_after) * (price_after - price_before)
                 (price = market_value / shares from that snapshot's holding row)
* income       = classified dividend / interest transactions dated inside the interval
* other flows  = whatever remains of the value change (deposits, withdrawals, unmatched activity)

Buys and sells only swap cash for shares, so they cancel out of the value change.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from db.models import (
    Account,
    InvestmentHoldingSnapshot,
    InvestmentSyncSnapshot,
    InvestmentTxnClassification,
    Transaction,
)

DAY = 86_400
INCOME_KINDS = ("dividend", "interest")


def _ts(dt: datetime) -> float:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def _prices(holdings: list[InvestmentHoldingSnapshot]) -> dict[str, tuple[float, float]]:
    """symbol -> (shares, price per share) for one snapshot."""
    out: dict[str, list[float]] = {}
    for h in holdings:
        sym = (h.symbol or "").strip().upper()
        if not sym or not h.shares or h.shares <= 0:
            continue
        b = out.setdefault(sym, [0.0, 0.0])
        b[0] += h.shares
        b[1] += h.market_value or 0.0
    return {s: (sh, mv / sh) for s, (sh, mv) in out.items() if sh > 0}


def get_portfolio_performance(session: Session) -> dict[str, Any]:
    accounts = session.query(Account).filter(Account.type == "investment").all()
    per_account: list[list[dict[str, Any]]] = []
    symbol_gain: dict[str, float] = defaultdict(float)
    symbol_income: dict[str, float] = defaultdict(float)
    first_ts: float | None = None

    for acct in accounts:
        crypto = bool(getattr(acct, "is_robinhood_crypto", False))
        snaps = (
            session.query(InvestmentSyncSnapshot)
            .filter(InvestmentSyncSnapshot.account_id == acct.id)
            .order_by(InvestmentSyncSnapshot.captured_at, InvestmentSyncSnapshot.id)
            .all()
        )
        if not snaps:
            continue
        # Keep the last snapshot of each UTC day; same-day repeats add nothing.
        by_day: dict[int, InvestmentSyncSnapshot] = {}
        for s in snaps:
            by_day[int(_ts(s.captured_at) // DAY)] = s
        snaps = [by_day[d] for d in sorted(by_day)]

        holdings_by_snap: dict[int, list[InvestmentHoldingSnapshot]] = defaultdict(list)
        for h in (
            session.query(InvestmentHoldingSnapshot)
            .filter(InvestmentHoldingSnapshot.snapshot_id.in_([s.id for s in snaps]))
            .all()
        ):
            holdings_by_snap[h.snapshot_id].append(h)

        income_rows = (
            session.query(Transaction.date, Transaction.amount, InvestmentTxnClassification.parsed_symbol)
            .join(InvestmentTxnClassification, InvestmentTxnClassification.transaction_id == Transaction.id)
            .filter(Transaction.account_id == acct.id, InvestmentTxnClassification.kind.in_(INCOME_KINDS))
            .all()
        )
        income = [
            (datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() + DAY, float(a), (sym or "").upper())
            for d, a, sym in income_rows
        ]  # +1 day: a txn dated D is visible in any snapshot taken after D began; count it up to the end of D

        rows: list[dict[str, Any]] = []
        cum_gain = 0.0
        prev = None
        for s in snaps:
            t = _ts(s.captured_at)
            value = s.positions_value if crypto else s.reported_balance
            px = _prices(holdings_by_snap.get(s.id, []))
            if prev is not None:
                t0, px0 = prev
                for sym, (sh1, p1) in px.items():
                    if sym in px0:
                        sh0, p0 = px0[sym]
                        # Custodians sometimes report share counts rounded (e.g. 0.01 BTC), which makes the
                        # implied price bogus; a share-count change plus a big price jump is that artifact.
                        if abs(sh1 - sh0) > 0.005 * sh0 and abs(p1 / p0 - 1) > 0.25:
                            continue
                        g = min(sh0, sh1) * (p1 - p0)
                        cum_gain += g
                        symbol_gain[sym] += g
                for it, amt, sym in income:
                    if t0 < it <= t + DAY and amt:
                        cum_gain += amt
                        if sym:
                            symbol_income[sym] += amt
            rows.append({"t": t, "day": int(t // DAY), "value": value, "gain": cum_gain})
            prev = (t, px)
            first_ts = t if first_ts is None else min(first_ts, t)
        per_account.append(rows)

    if not per_account:
        return {"series": [], "symbols": [], "start": None}

    # Combine accounts: carry each forward; start once every account with history has reported.
    start_day = max(rows[0]["day"] for rows in per_account)
    days = sorted({r["day"] for rows in per_account for r in rows if r["day"] >= start_day})
    idx = [0] * len(per_account)
    cur = [(rows[0]["value"], rows[0]["gain"]) for rows in per_account]
    series: list[dict[str, Any]] = []
    gain0: float | None = None
    twr = 1.0
    for d in days:
        for i, rows in enumerate(per_account):
            while idx[i] < len(rows) and rows[idx[i]]["day"] <= d:
                cur[i] = (rows[idx[i]]["value"], rows[idx[i]]["gain"])
                idx[i] += 1
        value = sum(v for v, _ in cur)
        gain = sum(g for _, g in cur)
        if gain0 is None:
            gain0 = gain
        elif series and series[-1]["value"] > 0:
            twr *= 1 + (gain - series[-1]["_gain"]) / series[-1]["value"]
        series.append(
            {
                "t": d * DAY * 1000,
                "value": round(value, 2),
                "gain": round(gain - gain0, 2),
                "twr": round(twr - 1, 6),
                "_gain": gain,
            }
        )
    for p in series:
        del p["_gain"]

    symbols = [
        {"symbol": s, "gain": round(symbol_gain[s], 2), "income": round(symbol_income.get(s, 0.0), 2)}
        for s in sorted(set(symbol_gain) | set(symbol_income))
    ]
    return {
        "series": series,
        "symbols": symbols,
        "start": series[0]["t"] if series else None,
    }
