"""
Chase Adapter - Parser for Chase Credit Card and Checking CSV exports.

Expects columns: Transaction Date, Post Date, Description, Category, Type, Amount
Chase CSV: charges are typically negative, payments positive — already cash-flow; no extra invert.
"""

import csv
import pandas as pd

from adapters.generic_adapter import GenericAdapter


class ChaseCreditCardAdapter(GenericAdapter):
    """Chase Mastercard statement adapter."""

    def __init__(self):
        super().__init__(
            date_col='Transaction Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
            has_header=True,
            auto_category='',
            invert_amounts_for_cash_flow=True,
        )

    
class ChaseCheckingAdapter(GenericAdapter):
    """Chase Checking statement adapter."""

    def __init__(self):
        super().__init__(
            date_col='Posting Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
            has_header=True,
            auto_category='',
            invert_amounts_for_cash_flow=False,
        )

    def _read_chase_csv(self, file_path: str) -> pd.DataFrame:
        """
        Chase checking exports can include ragged trailing commas on some rows.
        Read with the stdlib csv reader and force each row to header width so
        columns stay aligned even when rows have extra trailing delimiters.
        """
        with open(file_path, newline="", encoding="utf-8-sig") as csv_file:
            reader = csv.reader(csv_file)
            header = next(reader, [])
            header = [str(col).strip() for col in header]
            if len(header) == 0:
                return pd.DataFrame()

            rows: list[list[str]] = []
            for row in reader:
                if len(row) < len(header):
                    row = row + [""] * (len(header) - len(row))
                elif len(row) > len(header):
                    row = row[: len(header)]
                rows.append(row)

        return pd.DataFrame(rows, columns=header)

    def parse(self, file_path: str) -> pd.DataFrame:
        """
        Parse Chase checking CSV robustly, preserving rows with blank optional fields
        (e.g. missing Balance / Check or Slip #) while requiring date/amount/merchant.
        """
        dataframe = self._read_chase_csv(file_path)

        missing_cols = []
        for col in [self.date_col, self.amount_col, self.merchant_col]:
            if col not in dataframe.columns:
                missing_cols.append(col)
        if missing_cols:
            raise ValueError(f"Missing columns: {missing_cols}")

        result = pd.DataFrame()
        result["date"] = pd.to_datetime(
            dataframe[self.date_col], errors="coerce", format=self.date_format
        ).dt.date
        result["amount"] = pd.to_numeric(dataframe[self.amount_col], errors="coerce")
        result["merchant"] = dataframe[self.merchant_col].astype(str).str.strip()

        result = result.dropna(subset=["date", "amount", "merchant"])
        return result.reset_index(drop=True)

    def reported_balance_from_import(self, file_path: str) -> float | None:
        """
        Return the newest valid balance from the CSV Balance column.
        Chase exports are newest-first, so this is the first parseable value.
        """
        try:
            df = self._read_chase_csv(file_path)
        except Exception:
            return None
        if "Balance" not in df.columns or len(df) == 0:
            return None

        for raw_value in df["Balance"]:
            text = str(raw_value).strip().replace(",", "")
            if text == "" or text.lower() == "nan":
                continue
            try:
                return float(text)
            except (TypeError, ValueError):
                continue
        return None
