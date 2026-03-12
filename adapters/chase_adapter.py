"""
Chase Adapter - Parser for Chase Mastercard CSV exports.

Expects columns: Transaction Date, Post Date, Description, Category, Type, Amount
Chase format: Need to swap the sign of the amount to get positive for charges and negative for payments.
"""

import pandas as pd
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
        )

    
    def parse(self, file_path: str) -> pd.DataFrame:
        """Parse Chase CSV and normalize amounts (flip sign)."""
        result = super().parse(file_path)
        # Chase uses negative for charges, positive for payments
        # Flip the sign to match convention
        result['amount'] = -result['amount']
        return result