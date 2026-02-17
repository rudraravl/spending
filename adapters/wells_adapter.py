"""
Wells Adapter - Parser for Wells Fargo CSV exports.

Expects columns: Date (col 0), Amount (col 1), Description (col 5)
Wells format: Charges are negative, payments/credits are positive.
This adapter normalizes to: Charges positive, payments negative.
"""

import pandas as pd
from adapters.generic_adapter import GenericAdapter


class WellsAdapter(GenericAdapter):
    """Wells Fargo credit card statement adapter."""
    
    def __init__(self):
        super().__init__(
            date_col=0,
            amount_col=1,
            merchant_col=4,
            has_header=False,
            date_format='%m/%d/%Y',
            auto_category='',
        )
    
    def parse(self, file_path: str) -> pd.DataFrame:
        """Parse Wells Fargo CSV and normalize amounts (flip sign)."""
        result = super().parse(file_path)
        # Wells uses negative for charges, positive for payments
        # Flip the sign to match our convention
        result['amount'] = -result['amount']
        return result
