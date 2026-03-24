"""
Generic Adapter - Accepts manual column mapping.

Cash-flow amount convention (see docs/AMOUNT_CONVENTION.md):
positive = inflow, negative = outflow.

After reading the amount column, we optionally negate so typical "charges shown as
positive" bank exports become negative outflows (`invert_amounts_for_cash_flow`,
default True). Adapters whose CSV already uses negative for charges (e.g. Chase)
set invert_amounts_for_cash_flow=False.
"""

import pandas as pd
from datetime import datetime
from adapters.base_adapter import BaseAdapter


class GenericAdapter(BaseAdapter):
    """
    Generic adapter that accepts manual column mapping.
    
    Usage:
        adapter = GenericAdapter(
            date_col='Date',
            amount_col='Amount',
            merchant_col='Description'
        )
        normalized_df = adapter.parse(raw_df)
    """
    
    def __init__(
        self,
        date_col,
        amount_col,
        merchant_col,
        date_format: str | None = None,
        has_header: bool = True,
        auto_category: str = "",
        *,
        invert_amounts_for_cash_flow: bool = True,
    ):
        """
        Initialize generic adapter with column mappings.

        Args:
            invert_amounts_for_cash_flow: If True (default), negate parsed amounts so
                typical positive charges become negative outflows.
        """
        self.date_col = date_col
        self.amount_col = amount_col
        self.merchant_col = merchant_col
        self.date_format = date_format
        self.has_header = has_header
        self.auto_category = auto_category
        self.invert_amounts_for_cash_flow = invert_amounts_for_cash_flow

    def _preprocess_dataframe(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """Override in subclasses to modify the raw dataframe before normalization. Default: no-op."""
        return dataframe

    def parse(self, file_path: str) -> pd.DataFrame:
        """
        Parse and normalize CSV data using specified columns.
        
        Args:
            file_path: Path to the CSV file to be parsed
            
        Returns:
            Normalized DataFrame with columns: date, amount, merchant
        """
        
        dataframe = pd.read_csv(file_path, header=0 if self.has_header else None)
        dataframe = self._preprocess_dataframe(dataframe)

        # Validate columns exist
        missing_cols = []
        for col in [self.date_col, self.amount_col, self.merchant_col]:
            if col not in dataframe.columns:
                missing_cols.append(col)
        
        if missing_cols:
            raise ValueError(f"Missing columns: {missing_cols}")
        
        # Create normalized dataframe
        result = pd.DataFrame()
        
        # Parse dates; if no explicit format is provided, let pandas infer.
        to_datetime_kwargs = {'errors': 'coerce'}
        if self.date_format:
            to_datetime_kwargs['format'] = self.date_format
        result['date'] = pd.to_datetime(dataframe[self.date_col], **to_datetime_kwargs).dt.date
        
        # Convert amounts to float
        result['amount'] = pd.to_numeric(
            dataframe[self.amount_col],
            errors='coerce'
        )
        
        # Extract merchant
        result['merchant'] = dataframe[self.merchant_col].astype(str).str.strip()
        
        # Remove rows with invalid data
        result = result.dropna(subset=['date', 'amount', 'merchant'])

        if self.invert_amounts_for_cash_flow:
            result = result.copy()
            result["amount"] = -result["amount"]

        return result.reset_index(drop=True)
