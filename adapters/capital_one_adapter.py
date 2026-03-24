"""
Capital One Adapter - Parser for Capital One CSV exports.

Expects columns including Transaction Date, Transaction Amount, Transaction Description,
and optional Balance (checking exports — top row is the most recent balance).
"""

import math

import pandas as pd

from adapters.generic_adapter import GenericAdapter


class CapitalOneAdapter(GenericAdapter):
    """Capital One statement adapter."""

    def __init__(self):
        super().__init__(
            date_col="Transaction Date",
            amount_col="Transaction Amount",
            merchant_col="Transaction Description",
            # Capital One uses 2-digit years (e.g. 03/19/26), not four digits.
            date_format="%m/%d/%y",
            has_header=True,
            auto_category="",
            invert_amounts_for_cash_flow=False,
        )

    def reported_balance_from_import(self, file_path: str) -> float | None:
        """First row of Balance column (newest transaction row in Capital One exports)."""
        try:
            df = pd.read_csv(file_path, header=0)
        except Exception:
            return None
        if "Balance" not in df.columns or len(df) == 0:
            return None
        try:
            fv = float(df["Balance"].iloc[0])
        except (TypeError, ValueError):
            return None
        if math.isnan(fv):
            return None
        return fv

    def _preprocess_dataframe(self, dataframe: pd.DataFrame) -> pd.DataFrame:
        """Map Capital One types to cash-flow: debits/purchases negative, credits positive."""
        dataframe = dataframe.copy()
        if "Transaction Type" in dataframe.columns and "Transaction Amount" in dataframe.columns:
            dataframe["Transaction Amount"] = pd.to_numeric(dataframe["Transaction Amount"], errors="coerce")
            is_credit = dataframe["Transaction Type"].astype(str).str.strip().str.lower() == "credit"
            # CSV amounts are typically positive; purchases/debits become negative outflows.
            dataframe.loc[~is_credit, "Transaction Amount"] *= -1
        elif "Transaction Amount" in dataframe.columns:
            # Some exports omit type; assume positive magnitudes are purchases/outflows.
            dataframe["Transaction Amount"] = -pd.to_numeric(
                dataframe["Transaction Amount"], errors="coerce"
            )
        return dataframe
