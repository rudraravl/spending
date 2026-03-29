"""
Classify investment-account transactions for ledger-style activity (not share lots).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from db.models import Account, InvestmentTxnClassification, Transaction

if TYPE_CHECKING:
    pass

PARSER_VERSION = "1"

# Uppercase tickers 1–5 chars, optional exchange suffix
_TICKER_RE = re.compile(r"\b([A-Z]{1,5})(?:\.[A-Z]+)?\b")


def _extract_symbol(merchant: str) -> str | None:
    m = _TICKER_RE.search(merchant.upper())
    return m.group(1) if m else None


def classify_investment_transaction(session: Session, txn: Transaction) -> InvestmentTxnClassification | None:
    """
    Upsert classification for a transaction on an investment account.
    Returns None if account is not investment or txn is a transfer.
    """
    if txn.is_transfer:
        return None

    acct = txn.account
    if acct is None:
        acct = session.query(Account).filter(Account.id == txn.account_id).first()
    if not acct or acct.type != "investment":
        return None

    merchant = (txn.merchant or "").lower()
    amt = float(txn.amount)
    kind = "other"
    confidence = "low"
    parsed_symbol = _extract_symbol(txn.merchant or "")

    if "dividend" in merchant or "div " in merchant:
        kind = "dividend"
        confidence = "high"
    elif "interest" in merchant or "bond interest" in merchant:
        kind = "interest"
        confidence = "high"
    elif "fee" in merchant or "adr" in merchant or "margin interest" in merchant:
        kind = "fee"
        confidence = "high"
    elif "ach" in merchant and ("deposit" in merchant or "received" in merchant or amt > 0):
        kind = "deposit"
        confidence = "low"
    elif "ach" in merchant and ("withdraw" in merchant or "sent" in merchant or amt < 0):
        kind = "withdrawal"
        confidence = "low"
    elif re.search(r"\bbought\b|\bbuy\b", merchant):
        kind = "buy"
        confidence = "high" if parsed_symbol else "low"
    elif re.search(r"\bsold\b|\bsell\b", merchant):
        kind = "sell"
        confidence = "high" if parsed_symbol else "low"
    elif amt < 0 and parsed_symbol:
        kind = "buy"
        confidence = "low"
    elif amt > 0 and parsed_symbol and "stock" in merchant:
        kind = "sell"
        confidence = "low"

    existing = (
        session.query(InvestmentTxnClassification)
        .filter(InvestmentTxnClassification.transaction_id == txn.id)
        .first()
    )
    if existing:
        existing.kind = kind
        existing.parsed_symbol = parsed_symbol
        existing.confidence = confidence
        existing.parser_version = PARSER_VERSION
        return existing

    row = InvestmentTxnClassification(
        transaction_id=txn.id,
        kind=kind,
        parsed_symbol=parsed_symbol,
        confidence=confidence,
        parser_version=PARSER_VERSION,
    )
    session.add(row)
    return row


def reclassify_investment_transactions(
    session: Session,
    *,
    account_id: int | None = None,
) -> int:
    """Re-run parser for all investment transactions (non-transfer). Returns count updated."""
    q = (
        session.query(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .filter(Account.type == "investment", Transaction.is_transfer.is_(False))
    )
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    count = 0
    for txn in q.all():
        classify_investment_transaction(session, txn)
        count += 1
    return count
