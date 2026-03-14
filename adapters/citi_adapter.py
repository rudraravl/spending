"""
Citi Adapter - Parser for Citi CSV exports.

Expects columns: Status, Date, Description, Debit, Credit, Member Name
Citi format: Sign convention valid: positive for charges, negative for payments
"""

import pandas as pd
from adapters.generic_adapter import GenericAdapter


class CitiAdapter(GenericAdapter):
    """Citi Mastercard statement adapter."""
    
    def __init__(self):
        super().__init__(
            date_col='Date',
            amount_col='Debit',
            merchant_col='Description',
            date_format='%m/%d/%Y',
            has_header=True,
            auto_category='',
        )

    def _preprocess_dataframe(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """Merge Credit into Debit so amount_col has a value for credit-only rows."""
        dataframe = dataframe.copy()
        dataframe["Debit"] = dataframe["Debit"].fillna(dataframe["Credit"])
        return dataframe