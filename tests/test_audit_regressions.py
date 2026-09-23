"""Regressions found in the services audit. Sessions mirror db.database.SessionLocal (autoflush=False)."""

import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import (
    Account,
    Base,
    Category,
    InvestmentTxnClassification,
    Subcategory,
    Transaction,
    TransferGroup,
)
from services.account_service import delete_account
from services.investment_txn_parser import classify_investment_transaction
from services.simplefin_client import _parse_transactions
from services.summary_service import calculate_total
from services.transaction_service import create_transfer, delete_transaction, unlink_transfer_pair
from utils.filters import TransactionFilter


class _ProdSessionBase(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine, autoflush=False)
        s = self.Session()
        other = Category(name="Other")
        s.add(other)
        s.flush()
        s.add(Subcategory(name="Uncategorized", category_id=other.id))
        self.bank = Account(name="Bank", type="checking")
        self.card = Account(name="Card", type="credit")
        s.add_all([self.bank, self.card])
        s.commit()
        self.bank_id, self.card_id = self.bank.id, self.card.id
        s.close()

    def _fresh(self):
        return self.Session()

    def _transfer(self, day=5):
        s = self._fresh()
        group = create_transfer(s, self.bank_id, self.card_id, 50.0, date(2026, 1, day))
        ids = [t.id for t in s.query(Transaction).filter(Transaction.transfer_group_id == group.id)]
        s.close()
        return ids


class TestTransferGroupCleanup(_ProdSessionBase):
    def test_deleting_one_leg_keeps_the_peer(self):
        leg_a, leg_b = self._transfer()
        s = self._fresh()
        self.assertTrue(delete_transaction(s, leg_a))
        s.close()
        s = self._fresh()
        remaining = s.query(Transaction).all()
        self.assertEqual([t.id for t in remaining], [leg_b])
        self.assertFalse(remaining[0].is_transfer)
        self.assertEqual(s.query(TransferGroup).count(), 0)

    def test_unlink_removes_the_empty_group(self):
        leg_a, leg_b = self._transfer()
        s = self._fresh()
        unlink_transfer_pair(s, leg_a, leg_b)
        s.close()
        s = self._fresh()
        self.assertEqual(s.query(TransferGroup).count(), 0)
        self.assertEqual(s.query(Transaction).count(), 2)

    def test_deleting_an_account_keeps_the_other_accounts_leg(self):
        self._transfer()
        s = self._fresh()
        delete_account(s, self.bank_id)
        s.close()
        s = self._fresh()
        survivors = s.query(Transaction).all()
        self.assertEqual([t.account_id for t in survivors], [self.card_id])
        self.assertFalse(survivors[0].is_transfer)
        self.assertEqual(s.query(TransferGroup).count(), 0)


class TestCalculateTotalFilters(_ProdSessionBase):
    def test_excluded_account_types_are_excluded(self):
        s = self._fresh()
        inv = Account(name="Brokerage", type="investment")
        s.add(inv)
        s.flush()
        s.add_all([
            Transaction(date=date(2026, 1, 2), amount=-20.0, merchant="Coffee", account_id=self.bank_id),
            Transaction(date=date(2026, 1, 2), amount=-500.0, merchant="Buy VTI", account_id=inv.id),
        ])
        s.commit()
        total = calculate_total(s, TransactionFilter(exclude_account_types=("investment",)))
        self.assertEqual(total, -20.0)


class TestInvestmentClassification(_ProdSessionBase):
    def _txn(self, s, merchant, amount):
        inv = s.query(Account).filter(Account.type == "investment").first()
        if inv is None:
            inv = Account(name="Brokerage", type="investment")
            s.add(inv)
            s.flush()
        t = Transaction(date=date(2026, 1, 2), amount=amount, merchant=merchant, account_id=inv.id)
        t.account = inv
        s.add(t)
        return t

    def test_margin_interest_is_a_fee(self):
        s = self._fresh()
        row = classify_investment_transaction(s, self._txn(s, "MARGIN INTEREST", -3.0))
        self.assertEqual(row.kind, "fee")

    def test_reclassifying_before_flush_does_not_duplicate(self):
        s = self._fresh()
        t = self._txn(s, "Dividend AAPL", 1.0)
        classify_investment_transaction(s, t)
        classify_investment_transaction(s, t)
        s.commit()
        self.assertEqual(s.query(InvestmentTxnClassification).count(), 1)


class TestSimpleFINText(unittest.TestCase):
    def test_descriptions_are_not_html_escaped(self):
        [txn] = _parse_transactions([{"id": "1", "posted": 0, "amount": "-1", "description": "Trader Joe's & Co"}])
        self.assertEqual(txn.description, "Trader Joe's & Co")


if __name__ == "__main__":
    unittest.main()
