"""
Base Adapter - Abstract interface for CSV parsers.

Each adapter must implement parse() to normalize CSV data to:
- date (datetime.date)
- amount (float) - CONVENTION: charges/expenses are POSITIVE, payments/credits are NEGATIVE
- merchant (string)

All other processing (deduplication, account assignment) happens in import_service.
"""

from abc import ABC, abstractmethod
import pandas as pd


class BaseAdapter(ABC):
    """Abstract base class for CSV adapters."""
    
    @abstractmethod
    def parse(self, file_path: str) -> pd.DataFrame:
        """
        Parse and normalize CSV data.
        
        Args:
            file_path: Path to CSV file
            
        Returns:
            Normalized DataFrame with columns: date, amount, merchant
        """
        pass

    def reported_balance_from_import(self, file_path: str) -> float | None:
        """
        If the CSV includes a bank/custodian-reported balance for asset accounts
        (e.g. checking Balance column), return it; otherwise None.
        """
        return None

    def __repr__(self):
        return f"<{self.__class__.__name__}>"
