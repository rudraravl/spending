"""
BILT Adapter - Parser for BILT Mastercard CSV exports.

Expects columns: Transaction Date, Amount, Merchant Name
BILT format: Sign convention not yet verified.
"""

import pandas as pd
from adapters.generic_adapter import GenericAdapter


class BiltAdapter(GenericAdapter):
    """BILT Mastercard statement adapter."""
    
    def __init__(self):
        super().__init__(
            date_col="Transaction Date",
            amount_col="Amount",
            merchant_col="Description",
            # Bilt CSV exports use ISO dates like 2026-03-16
            date_format="%Y-%m-%d",
            has_header=True,
            auto_category="",
        )
