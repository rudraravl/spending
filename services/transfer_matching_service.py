"""
Heuristics to suggest transfer pairs to link: card payments (asset outflow + credit
inflow) and moves between asset accounts (e.g. checking ↔ investment).
"""

from __future__ import annotations

import re
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

from sqlalchemy.orm import Session, joinedload

from db.models import Account, Transaction
from services.account_service import ASSET_ACCOUNT_TYPES

# Max |asset| vs |credit| difference for a suggested or auto-link pair
CARD_PAYMENT_AMOUNT_TOLERANCE = 0.03
# Legs must post within this many calendar days of each other
CARD_PAYMENT_DATE_WINDOW_DAYS = 8
# Wider window when querying DB around a seed date
SEARCH_PADDING_DAYS = 8


TransferCandidateKind = Literal["card_payment", "asset_transfer"]
TransferConfidence = Literal["high", "medium", "low"]
_CONFIDENCE_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}
# Descriptions banks use for payments and moves between accounts.
_TRANSFER_WORDING = re.compile(
    r"\b(payment|pymt|pmt|autopay|auto pay|epay|transfer|xfer|trnsfr|ach|deposit|withdrawal|thank you|zelle)\b",
    re.IGNORECASE,
)


@dataclass
class CardPaymentCandidatePair:
    """Outflow leg id first (negative amount), inflow leg second (positive amount)."""

    asset_transaction_id: int
    credit_transaction_id: int
    amount_delta: float
    date_delta_days: int
    canonical_amount: float
    kind: TransferCandidateKind = "card_payment"
    confidence: TransferConfidence = "medium"
    reasons: list[str] = field(default_factory=list)
    # An existing transfer between the same accounts for the same amount; linking
    # this pair too would count the money twice (typically a manual transfer).
    duplicate_of_transfer_group_id: int | None = None

    def to_api_dict(
        self,
        session: Session,
    ) -> dict[str, Any]:
        # Candidates were just loaded (with accounts) by find_transfer_match_candidates,
        # so these resolve from the identity map instead of two queries per pair.
        opts = [joinedload(Transaction.account)]
        a = session.get(Transaction, self.asset_transaction_id, options=opts)
        c = session.get(Transaction, self.credit_transaction_id, options=opts)
        if not a or not c:
            return {}
        return {
            "kind": self.kind,
            "asset_transaction_id": self.asset_transaction_id,
            "credit_transaction_id": self.credit_transaction_id,
            "canonical_amount": self.canonical_amount,
            "amount_delta": self.amount_delta,
            "date_delta_days": self.date_delta_days,
            "confidence": self.confidence,
            "reasons": list(self.reasons),
            "duplicate_of_transfer_group_id": self.duplicate_of_transfer_group_id,
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


def _is_asset_inflow_leg(txn: Transaction) -> bool:
    """Positive amount on a checking/savings/cash/investment account (e.g. brokerage deposit)."""
    acct = txn.account
    if not acct or acct.type not in ASSET_ACCOUNT_TYPES:
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
    seed_acct_id = seed.account_id

    if _is_asset_card_payment_leg(seed):
        out: list[Transaction] = []
        q_credit = (
            _eligible_transfer_link_base_query(session)
            .join(Account)
            .filter(Account.type == "credit")
            .filter(Transaction.amount > 0)
            .filter(Transaction.date >= d_lo)
            .filter(Transaction.date <= d_hi)
            .filter(Transaction.id != seed.id)
        )
        for o in q_credit.all():
            if _amounts_compatible(mag, abs(float(o.amount))) and _dates_compatible(seed.date, o.date):
                out.append(o)
        q_asset_in = (
            _eligible_transfer_link_base_query(session)
            .join(Account)
            .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
            .filter(Transaction.amount > 0)
            .filter(Transaction.date >= d_lo)
            .filter(Transaction.date <= d_hi)
            .filter(Transaction.id != seed.id)
            .filter(Transaction.account_id != seed_acct_id)
        )
        for o in q_asset_in.all():
            if _amounts_compatible(mag, abs(float(o.amount))) and _dates_compatible(seed.date, o.date):
                out.append(o)
        return out

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

    if _is_asset_inflow_leg(seed):
        q = (
            _eligible_transfer_link_base_query(session)
            .join(Account)
            .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
            .filter(Transaction.amount < 0)
            .filter(Transaction.date >= d_lo)
            .filter(Transaction.date <= d_hi)
            .filter(Transaction.id != seed.id)
            .filter(Transaction.account_id != seed_acct_id)
        )
        others = q.all()
        return [o for o in others if _amounts_compatible(mag, abs(float(o.amount))) and _dates_compatible(seed.date, o.date)]

    return []


def _build_pair_objects(
    outflow_txn: Transaction,
    inflow_txn: Transaction,
    *,
    kind: TransferCandidateKind = "card_payment",
) -> CardPaymentCandidatePair:
    mag_out = abs(float(outflow_txn.amount))
    mag_in = abs(float(inflow_txn.amount))
    canonical = max(mag_out, mag_in)
    amt_delta = abs(mag_out - mag_in)
    date_delta = abs((outflow_txn.date - inflow_txn.date).days)
    return CardPaymentCandidatePair(
        asset_transaction_id=outflow_txn.id,
        credit_transaction_id=inflow_txn.id,
        amount_delta=amt_delta,
        date_delta_days=date_delta,
        canonical_amount=canonical,
        kind=kind,
    )


def _pairs_by_amount_and_date(
    outflows: list[Transaction],
    inflows: list[Transaction],
    *,
    kind: TransferCandidateKind,
    skip_same_account: bool,
) -> list[CardPaymentCandidatePair]:
    """
    Every (outflow, inflow) with compatible magnitude and date. Inflows are sorted by
    magnitude so each outflow only visits inflows within the amount tolerance,
    instead of comparing every outflow against every inflow.
    """
    ordered = sorted(inflows, key=lambda t: abs(float(t.amount)))
    mags = [abs(float(t.amount)) for t in ordered]
    pairs: list[CardPaymentCandidatePair] = []
    for o in outflows:
        mag_o = abs(float(o.amount))
        lo = bisect_left(mags, mag_o - CARD_PAYMENT_AMOUNT_TOLERANCE - 1e-9)
        hi = bisect_right(mags, mag_o + CARD_PAYMENT_AMOUNT_TOLERANCE + 1e-9)
        for i in ordered[lo:hi]:
            if skip_same_account and o.account_id == i.account_id:
                continue
            if not _amounts_compatible(mag_o, abs(float(i.amount))):
                continue
            if not _dates_compatible(o.date, i.date):
                continue
            pairs.append(_build_pair_objects(o, i, kind=kind))
    return pairs


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
                    pair_kind: TransferCandidateKind = "card_payment"
                elif _is_credit_card_payment_leg(s) and _is_asset_card_payment_leg(other):
                    asset_txn, credit_txn = other, s
                    pair_kind = "card_payment"
                elif _is_asset_card_payment_leg(s) and _is_asset_inflow_leg(other):
                    asset_txn, credit_txn = s, other
                    pair_kind = "asset_transfer"
                elif _is_asset_inflow_leg(s) and _is_asset_card_payment_leg(other):
                    asset_txn, credit_txn = other, s
                    pair_kind = "asset_transfer"
                else:
                    continue
                pair = _build_pair_objects(asset_txn, credit_txn, kind=pair_kind)
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
    raw_pairs = _pairs_by_amount_and_date(asset_legs, credit_legs, kind="card_payment", skip_same_account=False)
    raw_pairs.sort(key=lambda p: (p.date_delta_days, p.amount_delta))
    return _dedupe_pairs(raw_pairs)


def _find_asset_to_asset_pair_candidates_full_scan(
    session: Session,
    *,
    lookback_days: int,
) -> list[CardPaymentCandidatePair]:
    since = date.today() - timedelta(days=lookback_days)
    outflows = (
        _eligible_transfer_link_base_query(session)
        .join(Account)
        .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
        .filter(Transaction.amount < 0)
        .filter(Transaction.date >= since)
        .all()
    )
    inflows = (
        _eligible_transfer_link_base_query(session)
        .join(Account)
        .filter(Account.type.in_(list(ASSET_ACCOUNT_TYPES)))
        .filter(Transaction.amount > 0)
        .filter(Transaction.date >= since)
        .all()
    )
    raw_pairs = _pairs_by_amount_and_date(outflows, inflows, kind="asset_transfer", skip_same_account=True)
    raw_pairs.sort(key=lambda p: (p.date_delta_days, p.amount_delta))
    return _dedupe_pairs(raw_pairs)


def _mentions_account(merchant: str | None, account: Account | None) -> str | None:
    """Name of `account` (or its institution) if the description mentions it."""
    if not merchant or not account:
        return None
    text = merchant.lower()
    for label in (account.institution_name, account.name):
        if label and len(label.strip()) >= 4 and label.strip().lower() in text:
            return label.strip()
    return None


def _existing_transfer_duplicate(session: Session, outflow: Transaction, inflow: Transaction) -> Transaction | None:
    """Outflow leg of an already-linked transfer between the same accounts and amount, if any."""
    magnitude = abs(float(outflow.amount))
    lo = min(outflow.date, inflow.date) - timedelta(days=CARD_PAYMENT_DATE_WINDOW_DAYS)
    hi = max(outflow.date, inflow.date) + timedelta(days=CARD_PAYMENT_DATE_WINDOW_DAYS)
    linked_outflows = (
        session.query(Transaction)
        .filter(Transaction.is_transfer.is_(True))
        .filter(Transaction.transfer_group_id.isnot(None))
        .filter(Transaction.account_id == outflow.account_id)
        .filter(Transaction.amount < 0)
        .filter(Transaction.date >= lo, Transaction.date <= hi)
        .all()
    )
    for leg in linked_outflows:
        if not _amounts_compatible(abs(float(leg.amount)), magnitude):
            continue
        peer_on_inflow_account = (
            session.query(Transaction.id)
            .filter(Transaction.transfer_group_id == leg.transfer_group_id)
            .filter(Transaction.id != leg.id)
            .filter(Transaction.account_id == inflow.account_id)
            .first()
        )
        if peer_on_inflow_account:
            return leg
    return None


def _assess_pairs(session: Session, pairs: list[CardPaymentCandidatePair]) -> None:
    """
    Rate how likely each pair is a real transfer. Amount and date alone produce
    coincidences (a card refund equal to a grocery debit, a paycheck equal to
    rent); descriptions that say "payment"/"transfer" or name the other account
    are what separate real transfers from those.
    """
    ids = {i for p in pairs for i in (p.asset_transaction_id, p.credit_transaction_id)}
    if not ids:
        return
    by_id = {
        t.id: t
        for t in session.query(Transaction)
        .options(joinedload(Transaction.account))
        .filter(Transaction.id.in_(ids))
        .all()
    }
    for p in pairs:
        outflow = by_id.get(p.asset_transaction_id)
        inflow = by_id.get(p.credit_transaction_id)
        if outflow is None or inflow is None:
            continue
        reasons: list[str] = []
        wording = any(_TRANSFER_WORDING.search(t.merchant or "") for t in (outflow, inflow))
        if wording:
            reasons.append("Description looks like a payment or transfer")
        mentioned = _mentions_account(outflow.merchant, inflow.account) or _mentions_account(
            inflow.merchant, outflow.account
        )
        if mentioned:
            reasons.append(f"Description mentions {mentioned}")
        exact = p.amount_delta < 0.005
        reasons.append("Same amount" if exact else f"Amounts differ by ${p.amount_delta:.2f}")
        reasons.append(
            "Same day" if p.date_delta_days == 0
            else f"{p.date_delta_days} day{'s' if p.date_delta_days != 1 else ''} apart"
        )

        duplicate = _existing_transfer_duplicate(session, outflow, inflow)
        if duplicate is not None:
            p.duplicate_of_transfer_group_id = duplicate.transfer_group_id
            reasons.insert(0, f"Matches a transfer already recorded on {duplicate.date.isoformat()}")
            p.confidence = "low"
        elif (wording or mentioned) and exact and p.date_delta_days <= 3:
            p.confidence = "high"
        elif wording or mentioned:
            p.confidence = "medium"
        else:
            p.confidence = "low"
        p.reasons = reasons


def _candidate_sort_key(p: CardPaymentCandidatePair) -> tuple[int, int, float]:
    return (_CONFIDENCE_RANK[p.confidence], p.date_delta_days, p.amount_delta)


def find_transfer_match_candidates(
    session: Session,
    *,
    seed_transaction_ids: list[int] | None = None,
    lookback_days: int = 365,
) -> list[CardPaymentCandidatePair]:
    """
    Suggested pairs to link as transfers: card payments (asset outflow + credit inflow), and
    on a full scan (no seed ids), also asset-to-asset pairs with opposite signed amounts.
    """
    pairs = find_card_payment_pair_candidates(
        session,
        seed_transaction_ids=seed_transaction_ids,
        lookback_days=lookback_days,
    )
    if not seed_transaction_ids:
        pairs = pairs + _find_asset_to_asset_pair_candidates_full_scan(
            session,
            lookback_days=lookback_days,
        )
    _assess_pairs(session, pairs)
    # Most likely first; within a confidence level, closest dates and amounts first.
    pairs.sort(key=_candidate_sort_key)
    return pairs
