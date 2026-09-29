"""Symbol parsing and performance math for investment accounts."""

import unittest
from datetime import date, datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import (
    Account,
    Base,
    InvestmentHoldingSnapshot,
    InvestmentSyncSnapshot,
    Transaction,
)
from services.investment_performance import get_portfolio_performance
from services.investment_service import holding_cost_basis
from services.investment_txn_parser import classify_investment_transaction


def _session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _snap(s, acct, day, balance, holdings):
    snap = InvestmentSyncSnapshot(
        account_id=acct.id,
        captured_at=datetime(2026, 1, day, 12, tzinfo=timezone.utc),
        reported_balance=balance,
        positions_value=sum(h[2] for h in holdings),
        cash_balance=balance - sum(h[2] for h in holdings),
        currency="USD",
    )
    s.add(snap)
    s.flush()
    for sym, shares, mv in holdings:
        s.add(
            InvestmentHoldingSnapshot(
                snapshot_id=snap.id, external_holding_id=sym, symbol=sym, description=f"{sym} Fund",
                shares=shares, market_value=mv, currency="USD",
            )
        )


class TestPerformance(unittest.TestCase):
    def test_deposit_is_not_counted_as_gain(self) -> None:
        s = _session()
        acct = Account(name="Brokerage", type="investment", currency="USD")
        s.add(acct)
        s.flush()
        _snap(s, acct, 1, 1000, [("AAA", 10, 1000)])  # $100/share
        _snap(s, acct, 2, 1100, [("AAA", 10, 1100)])  # +$100 market
        _snap(s, acct, 3, 2600, [("AAA", 10, 1100)] )  # +$1500 deposit, no market move
        perf = get_portfolio_performance(s)
        self.assertEqual([p["gain"] for p in perf["series"]], [0.0, 100.0, 100.0])
        self.assertAlmostEqual(perf["series"][-1]["twr"], 0.10, places=3)

    def test_rounded_share_count_artifact_is_ignored(self) -> None:
        s = _session()
        acct = Account(name="Crypto", type="investment", currency="USD")
        s.add(acct)
        s.flush()
        _snap(s, acct, 1, 400, [("BTC", 0.01, 400)])  # rounded shares -> bogus $40k price
        _snap(s, acct, 2, 410, [("BTC", 0.0056, 410)])  # real shares -> $73k price
        perf = get_portfolio_performance(s)
        self.assertEqual(perf["series"][-1]["gain"], 0.0)

    def test_cost_basis_falls_back_to_purchase_price(self) -> None:
        h = InvestmentHoldingSnapshot(shares=2, market_value=300, cost_basis=0.0, purchase_price=100.0)
        self.assertEqual(holding_cost_basis(h), 200.0)
        h.cost_basis = 150.0
        self.assertEqual(holding_cost_basis(h), 150.0)
        self.assertIsNone(holding_cost_basis(InvestmentHoldingSnapshot(shares=1, cost_basis=0.0, purchase_price=0.0)))


class TestSymbolParsing(unittest.TestCase):
    def _classify(self, merchant, amount):
        s = _session()
        acct = Account(name="B", type="investment", currency="USD")
        s.add(acct)
        s.flush()
        snap = InvestmentSyncSnapshot(
            account_id=acct.id, captured_at=datetime(2026, 1, 1), reported_balance=1, positions_value=1,
            cash_balance=0, currency="USD",
        )
        s.add(snap)
        s.flush()
        s.add(
            InvestmentHoldingSnapshot(
                snapshot_id=snap.id, external_holding_id="x", symbol="RKLB", description="Rocket Lab Corporation",
                shares=1, market_value=1, currency="USD",
            )
        )
        txn = Transaction(date=date(2026, 1, 2), amount=amount, merchant=merchant, account_id=acct.id, is_transfer=False)
        s.add(txn)
        s.flush()
        return classify_investment_transaction(s, txn)

    def test_dividend_symbol(self) -> None:
        r = self._classify("Cash dividend of $0.50 from VONG", 0.5)
        self.assertEqual((r.kind, r.parsed_symbol), ("dividend", "VONG"))

    def test_buy_by_ticker_and_by_name(self) -> None:
        self.assertEqual(self._classify("buy 0.125727 shares of QUAL for $190.89 each", -24).parsed_symbol, "QUAL")
        r = self._classify("buy 2.000000 shares of Rocket Lab Corporation for $118.20 each", -236.4)
        self.assertEqual((r.kind, r.parsed_symbol, r.confidence), ("buy", "RKLB", "high"))
        self.assertEqual(self._classify("buy 0.002792 BTC for $71616.13 each", -199.97).parsed_symbol, "BTC")

    def test_interest_has_no_symbol(self) -> None:
        self.assertIsNone(self._classify("Interest earned of $2.52.", 2.52).parsed_symbol)


if __name__ == "__main__":
    unittest.main()
