"""
Chase Adapter - Parser for Chase Mastercard CSV exports.

Expects columns: Transaction Date, Post Date, Description, Category, Type, Amount
Chase CSV: charges are typically negative, payments positive — already cash-flow; no extra invert.
"""

from adapters.generic_adapter import GenericAdapter


class ChaseAdapter(GenericAdapter):
    """Chase Mastercard statement adapter."""

    def __init__(self):
        super().__init__(
            date_col='Transaction Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
            has_header=True,
            auto_category='',
            invert_amounts_for_cash_flow=False,
        )