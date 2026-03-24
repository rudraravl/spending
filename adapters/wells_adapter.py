"""
Wells Adapter - Parser for Wells Fargo CSV exports.

Expects columns: Date (col 0), Amount (col 1), Description (col 5)
Wells CSV: charges negative, payments positive — already cash-flow; no extra invert.
"""

from adapters.generic_adapter import GenericAdapter


class WellsAdapter(GenericAdapter):
    """Wells Fargo credit card statement adapter."""

    def __init__(self):
        super().__init__(
            date_col=0,
            amount_col=1,
            merchant_col=4,
            has_header=False,
            date_format='%m/%d/%Y',  # 4-digit year (e.g. 2/13/2026)
            auto_category='',
            invert_amounts_for_cash_flow=False,
        )
