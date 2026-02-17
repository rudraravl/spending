"""
Discover Adapter - Parser for Discover card CSV exports.

Expects columns: Trans. Date, Amount, Merchant Name
"""

import pandas as pd
from adapters.generic_adapter import GenericAdapter


class DiscoverAdapter(GenericAdapter):
    """Discover card statement adapter."""
    
    def __init__(self):
        super().__init__(
            date_col='Trans. Date',
            amount_col='Amount',
            merchant_col='Merchant Name',
            date_format='%m/%d/%Y',
        )
