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


    def parse(self, file_path: str) -> pd.DataFrame:
        """
        Parse and normalize CSV data using specified columns.
        
        Args:
            file_path: Path to the CSV file to be parsed
            
        Returns:
            Normalized DataFrame with columns: date, amount, merchant
        """
        dataframe = pd.read_csv(file_path, header=0 if self.has_header else None)
        dataframe["debit"] = dataframe["Debit"].fillna(dataframe["Credit"])

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