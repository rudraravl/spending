"""Unit tests for server-side transaction search, sorting, and counting (used by table pagination)."""

import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, Category, Transaction
from services.transaction_service import count_transactions, get_transactions
from utils.filters import TransactionFilter


class TestTransactionListing(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)()
        s = self.session
        self.bank = Account(name="Bank", type="checking")
        self.card = Account(name="amex", type="credit")
        s.add_all([self.bank, self.card])
        self.food = Category(name="Food")
        self.bills = Category(name="bills")
        s.add_all([self.food, self.bills])
        s.flush()
        rows = [
            (date(2026, 9, 1), -5.0, "Kaldi's Coffee", None, self.card, self.food),
            (date(2026, 9, 2), -40.0, "Grocer", "coffee beans", self.bank, self.food),
            (date(2026, 9, 3), -120.0, "Electric Co", None, self.bank, self.bills),
            (date(2026, 9, 3), -5.0, "50% Off Deli", None, self.card, self.food),
            (date(2026, 9, 4), 2000.0, "Payroll", None, self.bank, None),
        ]
        for d, amt, merchant, notes, acct, cat in rows:
            s.add(Transaction(date=d, amount=amt, merchant=merchant, notes=notes,
                              account_id=acct.id, category_id=cat.id if cat else None))
        s.commit()

    def tearDown(self):
        self.session.close()

    def _merchants(self, **kwargs):
        return [t.merchant for t in get_transactions(self.session, **kwargs)]

    def test_default_order_is_newest_first(self):
        self.assertEqual(self._merchants()[0], "Payroll")

    def test_search_matches_merchant_or_notes_case_insensitively(self):
        self.assertEqual(sorted(self._merchants(search="COFFEE")), ["Grocer", "Kaldi's Coffee"])
        self.assertEqual(count_transactions(self.session, search="  coffee "), 2)

    def test_search_treats_like_wildcards_literally(self):
        self.assertEqual(self._merchants(search="%"), ["50% Off Deli"])
        self.assertEqual(count_transactions(self.session, search="_"), 0)

    def test_blank_search_is_ignored(self):
        self.assertEqual(count_transactions(self.session, search="   "), 5)

    def test_sort_by_amount_spans_all_rows(self):
        self.assertEqual(self._merchants(sort_by="amount", sort_desc=False)[0], "Electric Co")
        self.assertEqual(self._merchants(sort_by="amount", sort_desc=True)[0], "Payroll")

    def test_ties_break_newest_first_so_pages_are_stable(self):
        # Both -5.00 rows tie on amount; the newer one comes first either way.
        asc = self._merchants(sort_by="amount", sort_desc=False)
        self.assertLess(asc.index("50% Off Deli"), asc.index("Kaldi's Coffee"))
        pages = [
            t.id
            for offset in range(0, 5, 2)
            for t in get_transactions(self.session, sort_by="amount", sort_desc=False, limit=2, offset=offset)
        ]
        self.assertEqual(len(pages), 5)
        self.assertEqual(len(set(pages)), 5)

    def test_sort_by_related_names_is_case_insensitive(self):
        # "amex" sorts before "Bank"; its two rows tie, newest first.
        self.assertEqual(self._merchants(sort_by="account", sort_desc=False)[0], "50% Off Deli")
        by_category = self._merchants(sort_by="category", sort_desc=False)
        self.assertEqual(by_category[0], "Payroll")  # uncategorized (NULL) first
        self.assertEqual(by_category[1], "Electric Co")  # "bills" before "Food"

    def test_account_sort_works_with_account_type_filter_join(self):
        filters = TransactionFilter(exclude_account_types=["credit"])
        rows = get_transactions(self.session, filters=filters, sort_by="account")
        self.assertEqual({t.account_id for t in rows}, {self.bank.id})

    def test_count_matches_filters_and_transfer_flag(self):
        filters = TransactionFilter(account_id=self.card.id)
        self.assertEqual(count_transactions(self.session, filters=filters), 2)
        self.session.query(Transaction).filter(Transaction.merchant == "Grocer").update({"is_transfer": True})
        self.session.commit()
        self.assertEqual(count_transactions(self.session, include_transfers=False), 4)


if __name__ == "__main__":
    unittest.main()
