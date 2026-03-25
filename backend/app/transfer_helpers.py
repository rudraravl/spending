from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.schemas import TransferMatchCandidateOut, TransferMatchTxnBrief
from services.transfer_matching_service import CardPaymentCandidatePair


def transfer_pair_to_candidate_out(
    session: Session,
    pair: CardPaymentCandidatePair,
) -> TransferMatchCandidateOut:
    d = pair.to_api_dict(session)
    return TransferMatchCandidateOut(
        asset_transaction_id=d["asset_transaction_id"],
        credit_transaction_id=d["credit_transaction_id"],
        canonical_amount=d["canonical_amount"],
        amount_delta=d["amount_delta"],
        date_delta_days=d["date_delta_days"],
        asset=TransferMatchTxnBrief(**d["asset"]),
        credit=TransferMatchTxnBrief(**d["credit"]),
    )
