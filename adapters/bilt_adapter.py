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
            date_col='Transaction Date',
            amount_col='Amount',
            merchant_col='Merchant Name',
            date_format='%m/%d/%Y',
            has_header=True,
            auto_category='',
        )
