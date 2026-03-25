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
CARD_PAYMENT_AMOUNT_TOLERANCE = 0.03
# Legs must post within this many calendar days of each other
CARD_PAYMENT_DATE_WINDOW_DAYS = 8
# Wider window when querying DB around a seed date
SEARCH_PADDING_DAYS = 8


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


def _dedupe_pairs(pairs: list[CardPaymentCandidatePair]) -> list[CardPaymentCandidatePair]:
    """Keep unique (asset_id, credit_id); allow same leg in multiple pairs when ambiguous."""
    seen: set[tuple[int, int]] = set()
    out: list[CardPaymentCandidatePair] = []
    for p in pairs:
        key = (p.asset_transaction_id, p.credit_transaction_id)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


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
    ids (import flow) or full scan over recent unmatched legs.

    When multiple CC credits could match one bank debit (or vice versa), **every**
    valid pair is returned so the user can choose; we only dedupe identical
    (asset_id, credit_id) tuples.
    """
    seed_set = set(seed_transaction_ids) if seed_transaction_ids else None

    if seed_transaction_ids:
        seeds = (
            session.query(Transaction)
            .options(joinedload(Transaction.account))
            .filter(Transaction.id.in_(seed_transaction_ids))
            .all()
        )
        raw: list[CardPaymentCandidatePair] = []
        for s in seeds:
            for other in _counterparts_for_seed(session, s):
                if _is_asset_card_payment_leg(s) and _is_credit_card_payment_leg(other):
                    asset_txn, credit_txn = s, other
                elif _is_credit_card_payment_leg(s) and _is_asset_card_payment_leg(other):
                    asset_txn, credit_txn = other, s
                else:
                    continue
                pair = _build_pair_objects(asset_txn, credit_txn)
                if seed_set is not None and not (
                    asset_txn.id in seed_set or credit_txn.id in seed_set
                ):
                    continue
                raw.append(pair)
        raw.sort(key=lambda p: (p.date_delta_days, p.amount_delta))
        return _dedupe_pairs(raw)

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
    raw_pairs: list[CardPaymentCandidatePair] = []
    for a in asset_legs:
        mag_a = abs(float(a.amount))
        for c in credit_legs:
            mag_c = abs(float(c.amount))
            if not _amounts_compatible(mag_a, mag_c):
                continue
            if not _dates_compatible(a.date, c.date):
                continue
            raw_pairs.append(_build_pair_objects(a, c))
    raw_pairs.sort(key=lambda p: (p.date_delta_days, p.amount_delta))
    return _dedupe_pairs(raw_pairs)
