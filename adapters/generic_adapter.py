"""
Generic Adapter - Accepts manual column mapping.

Allows users to specify which columns correspond to date, amount, and merchant.
Amount sign convention: charges/expenses should be POSITIVE, payments/credits should be NEGATIVE.
If your CSV uses a different convention, override parse() to flip the sign."""

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
        date_format: str,
        has_header: bool,
        auto_category = "",
        
    ):
        """
        Initialize generic adapter with column mappings.
        
        Args:
            date_col: Name of the date column
            amount_col: Name of the amount column
            merchant_col: Name of the merchant/description column
            date_format: Date format string for parsing dates
        """
        self.date_col = date_col
        self.amount_col = amount_col
        self.merchant_col = merchant_col
        self.date_format = date_format
        self.has_header = has_header
        self.auto_category = auto_category
    
    def parse(self, file_path: str) -> pd.DataFrame:
        """
        Parse and normalize CSV data using specified columns.
        
        Args:
            file_path: Path to the CSV file to be parsed
            
        Returns:
            Normalized DataFrame with columns: date, amount, merchant
        """
        dataframe = pd.read_csv(file_path, header=0 if self.has_header else None)

        # Validate columns exist
        missing_cols = []
        for col in [self.date_col, self.amount_col, self.merchant_col]:
            if col not in dataframe.columns:
                missing_cols.append(col)
        
        if missing_cols:
            raise ValueError(f"Missing columns: {missing_cols}")
        
        # Create normalized dataframe
        result = pd.DataFrame()
        
        # Parse dates
        result['date'] = pd.to_datetime(
            dataframe[self.date_col],
            format=self.date_format,
            errors='coerce'
        ).dt.date
        
        # Convert amounts to float
        result['amount'] = pd.to_numeric(
            dataframe[self.amount_col],
            errors='coerce'
        )
        
        # Extract merchant
        result['merchant'] = dataframe[self.merchant_col].astype(str).str.strip()
        
        # Remove rows with invalid data
        result = result.dropna(subset=['date', 'amount', 'merchant'])
        
        return result.reset_index(drop=True)
