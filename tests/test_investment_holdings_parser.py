"""Unit tests for SimpleFIN holdings parsing and investment txn classifier."""

import unittest
from unittest.mock import MagicMock

from services.investment_txn_parser import classify_investment_transaction
from services.simplefin_client import _parse_holdings


class TestParseHoldings(unittest.TestCase):
    def test_nvda_snake_case(self) -> None:
        sample = [
            {
                "id": "HOL-f2854bba-92f5-4570-9354-e6fc4fa1c091",
                "created": 1774634342,
                "currency": "USD",
                "cost_basis": "0.00",
                "description": "NVIDIA Corp",
                "market_value": "112.49",
                "purchase_price": "96.52",
                "shares": "0.67",
                "symbol": "NVDA",
            }
        ]
        h = _parse_holdings(sample)
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0].symbol, "NVDA")
        self.assertEqual(float(h[0].market_value), 112.49)
        self.assertEqual(h[0].created, 1774634342)

    def test_kebab_case_keys(self) -> None:
        sample = [
            {
                "id": "HOL-1",
                "currency": "USD",
                "market-value": "10",
                "shares": "1",
                "symbol": "X",
                "description": "Test",
                "cost-basis": "5",
            }
        ]
        h = _parse_holdings(sample)
        self.assertEqual(float(h[0].market_value), 10.0)
        self.assertEqual(h[0].cost_basis, "5")

    def test_missing_holdings(self) -> None:
        self.assertEqual(_parse_holdings(None), [])
        self.assertEqual(_parse_holdings([]), [])


class _Txn:
    def __init__(self) -> None:
        self.is_transfer = True
        self.account_id = 1
        self.account = None
        self.merchant = ""


class TestInvestmentTxnParser(unittest.TestCase):
    def test_skips_transfer(self) -> None:
        self.assertIsNone(classify_investment_transaction(MagicMock(), _Txn()))



if __name__ == "__main__":
    unittest.main()
