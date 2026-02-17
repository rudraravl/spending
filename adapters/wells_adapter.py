"""
Wells Adapter - Parser for Wells Fargo CSV exports.

Expects columns: Date, Amount, Description
"""

import pandas as pd
from adapters.generic_adapter import GenericAdapter


class WellsAdapter(GenericAdapter):
    """Wells Fargo credit card statement adapter."""
    
    def __init__(self):
        super().__init__(
            date_col='Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
        )
