"""
Base Adapter - Abstract interface for CSV parsers.

Each adapter must implement parse() to normalize CSV data to:
- date
- amount
- merchant

All other processing (deduplication, account assignment) happens in import_service.
"""

from abc import ABC, abstractmethod
import pandas as pd


class BaseAdapter(ABC):
    """Abstract base class for CSV adapters."""
    
    @abstractmethod
    def parse(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """
        Parse and normalize CSV data.
        
        Args:
            dataframe: Raw CSV data as pandas DataFrame
            
        Returns:
            Normalized DataFrame with columns: date, amount, merchant
        """
        pass
    
    def __repr__(self):
        return f"<{self.__class__.__name__}>"
