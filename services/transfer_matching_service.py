"""
Heuristics to suggest card-payment transfer pairs (asset outflow + credit inflow).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session, joinedload

from db.models import Account, Transaction
from services.account_service import ASSET_ACCOUNT_TYPES

# Max |asset| vs |credit| difference for a suggested or auto-link pair
CARD_PAYMENT_AMOUNT_TOLERANCE = 0.05
# Legs must post within this many calendar days of each other
CARD_PAYMENT_DATE_WINDOW_DAYS = 1
# Wider window when querying DB around a seed date
SEARCH_PADDING_DAYS = 2


@dataclass
class CardPaymentCandidatePair:
    asset_transaction_id: int
    credit_transaction_id: int
    amount_delta: float
    date_delta_days: int
    canonical_amount: float

    def to_api_dict(
        self,
        session: Session,
    ) -> dict[str, Any]:
        a = (
            session.query(Transaction)
            .options(joinedload(Transaction.account))
            .filter(Transaction.id == self.asset_transaction_id)
            .first()
        )
        c = (
            session.query(Transaction)
            .options(joinedload(Transaction.account))
            .filter(Transaction.id == self.credit_transaction_id)
            .first()
        )
        if not a or not c:
            return {}
        return {
            "asset_transaction_id": self.asset_transaction_id,
            "credit_transaction_id": self.credit_transaction_id,
            "canonical_amount": self.canonical_amount,
            "amount_delta": self.amount_delta,
            "date_delta_days": self.date_delta_days,
            "asset": _txn_brief(a),
            "credit": _txn_brief(c),
        }


def _txn_brief(t: Transaction) -> dict[str, Any]:
    acct: Account | None = t.account
    return {
        "id": t.id,
        "date": t.date.isoformat(),
        "amount": float(t.amount),
        "merchant": t.merchant,
        "account_id": t.account_id,
        "account_name": acct.name if acct else None,
        "account_type": acct.type if acct else None,
    }


def _eligible_transfer_link_base_query(session: Session):
    return (
        session.query(Transaction)
        .options(joinedload(Transaction.account))
        .filter(Transaction.is_transfer.is_(False))
        .filter(Transaction.transfer_group_id.is_(None))
        .filter(~Transaction.splits.any())
    )


def _is_asset_card_payment_leg(txn: Transaction) -> bool:
    acct = txn.account
    if not acct or acct.type not in ASSET_ACCOUNT_TYPES:
        return False
    return float(txn.amount) < 0


def _is_credit_card_payment_leg(txn: Transaction) -> bool:
    acct = txn.account
    if not acct or acct.type != "credit":
        return False
    return float(txn.amount) > 0


def _amounts_compatible(mag_a: float, mag_b: float) -> bool:
    return abs(mag_a - mag_b) <= CARD_PAYMENT_AMOUNT_TOLERANCE


def _dates_compatible(d1: date, d2: date) -> bool:
    return abs((d1 - d2).days) <= CARD_PAYMENT_DATE_WINDOW_DAYS


def _pair_score(date_delta: int, amount_delta: float) -> tuple[int, float]:
    return (date_delta, amount_delta)


def _counterparts_for_seed(session: Session, seed: Transaction) -> list[Transaction]:
    seed_date = seed.date
    d_lo = seed_date - timedelta(days=SEARCH_PADDING_DAYS)
    d_hi = seed_date + timedelta(days=SEARCH_PADDING_DAYS)
    mag = abs(float(seed.amount))

    if _is_asset_card_payment_leg(seed):
        q = (
            _eligible_transfer_link_base_query(session)
            .join(Account)
            .filter(Account.type == "credit")
            .filter(Transaction.amount > 0)
            .filter(Transaction.date >= d_lo)
            .filter(Transaction.date <= d_hi)
            .filter(Transaction.id != seed.id)
        )
        others = q.all()
        return [o for o in others if _amounts_compatible(mag, abs(float(o.amount))) and _dates_compatible(seed.date, o.date)]

    if _is_credit_card_payment_leg(seed):
        q = (
            _eligible_transfer_link_base_query(session)
            .join(Account)
            .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
            .filter(Transaction.amount < 0)
            .filter(Transaction.date >= d_lo)
            .filter(Transaction.date <= d_hi)
            .filter(Transaction.id != seed.id)
        )
        others = q.all()
        return [o for o in others if _amounts_compatible(mag, abs(float(o.amount))) and _dates_compatible(seed.date, o.date)]

    return []


def _build_pair_objects(
    asset_txn: Transaction,
    credit_txn: Transaction,
) -> CardPaymentCandidatePair:
    mag_a = abs(float(asset_txn.amount))
    mag_c = abs(float(credit_txn.amount))
    canonical = max(mag_a, mag_c)
    amt_delta = abs(mag_a - mag_c)
    date_delta = abs((asset_txn.date - credit_txn.date).days)
    return CardPaymentCandidatePair(
        asset_transaction_id=asset_txn.id,
        credit_transaction_id=credit_txn.id,
        amount_delta=amt_delta,
        date_delta_days=date_delta,
        canonical_amount=canonical,
    )


def find_card_payment_pair_candidates(
    session: Session,
    *,
    seed_transaction_ids: list[int] | None = None,
    lookback_days: int = 365,
) -> list[CardPaymentCandidatePair]:
    """
    Suggest card payment transfer pairs. Either constrained to counterparts of seed
    ids (import flow) or full greedy scan over recent unmatched legs.
    """
    if seed_transaction_ids:
        seeds = (
            session.query(Transaction)
            .options(joinedload(Transaction.account))
            .filter(Transaction.id.in_(seed_transaction_ids))
            .all()
        )
        raw: list[tuple[Transaction, Transaction, float, int]] = []
        for s in seeds:
            for other in _counterparts_for_seed(session, s):
                if _is_asset_card_payment_leg(s) and _is_credit_card_payment_leg(other):
                    asset_txn, credit_txn = s, other
                elif _is_credit_card_payment_leg(s) and _is_asset_card_payment_leg(other):
                    asset_txn, credit_txn = other, s
                else:
                    continue
                pair = _build_pair_objects(asset_txn, credit_txn)
                score = _pair_score(pair.date_delta_days, pair.amount_delta)
                raw.append((asset_txn, credit_txn, score[0], score[1]))
        raw.sort(key=lambda x: (x[2], x[3]))
        used: set[int] = set()
        out: list[CardPaymentCandidatePair] = []
        for asset_txn, credit_txn, _, _ in raw:
            if asset_txn.id in used or credit_txn.id in used:
                continue
            if not (asset_txn.id in seed_transaction_ids or credit_txn.id in seed_transaction_ids):
                continue
            used.add(asset_txn.id)
            used.add(credit_txn.id)
            out.append(_build_pair_objects(asset_txn, credit_txn))
        return out

    # Full scan: recent eligible legs only
    since = date.today() - timedelta(days=lookback_days)
    asset_legs = (
        _eligible_transfer_link_base_query(session)
        .join(Account)
        .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
        .filter(Transaction.amount < 0)
        .filter(Transaction.date >= since)
        .all()
    )
    credit_legs = (
        _eligible_transfer_link_base_query(session)
        .join(Account)
        .filter(Account.type == "credit")
        .filter(Transaction.amount > 0)
        .filter(Transaction.date >= since)
        .all()
    )
    raw_pairs: list[tuple[Transaction, Transaction, int, float]] = []
    for a in asset_legs:
        mag_a = abs(float(a.amount))
        for c in credit_legs:
            mag_c = abs(float(c.amount))
            if not _amounts_compatible(mag_a, mag_c):
                continue
            if not _dates_compatible(a.date, c.date):
                continue
            pair = _build_pair_objects(a, c)
            raw_pairs.append((a, c, pair.date_delta_days, pair.amount_delta))
    raw_pairs.sort(key=lambda x: (x[2], x[3]))
    used_ids: set[int] = set()
    result: list[CardPaymentCandidatePair] = []
    for a, c, _, _ in raw_pairs:
        if a.id in used_ids or c.id in used_ids:
            continue
        used_ids.add(a.id)
        used_ids.add(c.id)
        result.append(_build_pair_objects(a, c))
    return result
