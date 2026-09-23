"""Category deletion, foreign-key enforcement, SimpleFIN dates, investment parsing and daily net worth."""

import unittest
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import db.database  # noqa: F401  (registers the foreign-key PRAGMA listener)
from db.models import (
    Account,
    Base,
    BudgetCategory,
    Category,
    InvestmentSyncSnapshot,
    RecurringSeries,
    Rule,
    Subcategory,
    Transaction,
    TransactionSplit,
)
from services.account_service import delete_account
from services.category_service import delete_category, delete_subcategory
from services.investment_txn_parser import classify_investment_transaction
from services.net_worth_service import compute_daily_net_worth, net_worth_history
from services.simplefin_sync_service import _posted_date
from services.transaction_service import create_transfer


class _Base(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.s = sessionmaker(bind=engine, autoflush=False)()
        other = Category(name="Other")
        food = Category(name="Food")
        self.s.add_all([other, food])
        self.s.flush()
        self.unc = Subcategory(name="Uncategorized", category_id=other.id)
        self.groceries = Subcategory(name="Groceries", category_id=food.id)
        self.dining = Subcategory(name="Dining", category_id=food.id)
        self.s.add_all([self.unc, self.groceries, self.dining])
        self.bank = Account(name="Bank", type="checking")
        self.s.add(self.bank)
        self.s.commit()
        self.other, self.food = other, food

    def tearDown(self):
        self.s.close()

    def _txn(self, sub, day=date(2026, 1, 5), amount=-10.0, account=None):
        t = Transaction(
            date=day,
            amount=amount,
            merchant="M",
            account_id=(account or self.bank).id,
            category_id=sub.category_id,
            subcategory_id=sub.id,
        )
        self.s.add(t)
        self.s.flush()
        return t


class TestForeignKeys(_Base):
    def test_enforced_on_every_sqlite_engine(self):
        self.assertEqual(self.s.execute(text("PRAGMA foreign_keys")).scalar(), 1)

    def test_orphan_insert_is_rejected(self):
        self.s.add(Transaction(date=date(2026, 1, 1), amount=1.0, merchant="x", account_id=999))
        with self.assertRaises(IntegrityError):
            self.s.flush()


class TestCategoryDeletion(_Base):
    def test_delete_category_moves_everything_to_uncategorized(self):
        txn = self._txn(self.groceries)
        split_txn = self._txn(self.unc)
        self.s.add(TransactionSplit(transaction_id=split_txn.id, category_id=self.food.id, subcategory_id=self.dining.id, amount=-10.0))
        self.s.add(Rule(priority=1, field="merchant", operator="contains", value="m", category_id=self.food.id, subcategory_id=self.groceries.id))
        self.s.add(RecurringSeries(merchant_norm="m", amount_anchor_cents=1000, category_id=self.food.id, subcategory_id=self.dining.id))
        self.s.add(BudgetCategory(name="Eating", txn_category_id=self.food.id, txn_subcategory_id=self.dining.id))
        self.s.commit()
        txn_id, food_id = txn.id, self.food.id

        delete_category(self.s, self.food)
        self.s.commit()

        moved = self.s.get(Transaction, txn_id)
        self.assertEqual((moved.category_id, moved.subcategory_id), (self.other.id, self.unc.id))
        split = self.s.query(TransactionSplit).one()
        self.assertEqual((split.category_id, split.subcategory_id), (self.other.id, self.unc.id))
        self.assertEqual(self.s.query(RecurringSeries).one().subcategory_id, self.unc.id)
        self.assertEqual(self.s.query(Rule).count(), 0)
        envelope = self.s.query(BudgetCategory).filter(BudgetCategory.name == "Eating").one()
        self.assertIsNone(envelope.txn_category_id)
        self.assertIsNone(envelope.txn_subcategory_id)
        self.assertEqual(self.s.query(Subcategory).filter(Subcategory.category_id == food_id).count(), 0)
        self.assertIsNone(self.s.get(Category, food_id))

    def test_delete_subcategory_leaves_siblings(self):
        gone = self._txn(self.groceries)
        kept = self._txn(self.dining)
        self.s.commit()
        delete_subcategory(self.s, self.groceries)
        self.s.commit()
        self.assertEqual(self.s.get(Transaction, gone.id).subcategory_id, self.unc.id)
        self.assertEqual(self.s.get(Transaction, kept.id).subcategory_id, self.dining.id)

    def test_protected_rows_cannot_be_deleted(self):
        with self.assertRaises(ValueError):
            delete_category(self.s, self.other)
        with self.assertRaises(ValueError):
            delete_subcategory(self.s, self.unc)


class TestAccountDeletionWithEnvelope(_Base):
    def test_credit_payment_envelope_goes_with_the_account(self):
        card = Account(name="Card", type="credit")
        self.s.add(card)
        self.s.flush()
        self.s.add(BudgetCategory(name="Card Payment", is_system=True, system_kind="cc_payment", linked_account_id=card.id))
        self.s.commit()
        delete_account(self.s, card.id)
        self.s.commit()
        self.assertEqual(self.s.query(BudgetCategory).count(), 0)


class TestSimplefinPostedDate(unittest.TestCase):
    def test_date_only_stamps_keep_their_utc_date(self):
        for hour in (0, 12):
            stamp = int(datetime(2026, 5, 1, hour, tzinfo=timezone.utc).timestamp())
            self.assertEqual(_posted_date(stamp), date(2026, 5, 1))

    def test_real_times_use_local_date(self):
        moment = datetime(2026, 5, 1, 3, 17, 5, tzinfo=timezone.utc)
        self.assertEqual(_posted_date(int(moment.timestamp())), moment.astimezone().date())


class TestInvestmentParser(_Base):
    def test_buy_ending_in_each_is_not_ach(self):
        acct = Account(name="Brokerage", type="investment")
        self.s.add(acct)
        self.s.flush()
        txn = Transaction(date=date(2026, 4, 1), amount=-201.6, merchant="buy 0.31 shares of IVV for $650.00 each", account_id=acct.id)
        self.s.add(txn)
        self.s.flush()
        self.assertEqual(classify_investment_transaction(self.s, txn).kind, "buy")


class TestDailyNetWorth(_Base):
    def test_backcasts_from_reported_balance(self):
        self.bank.reported_balance = 1000.0
        self.bank.reported_balance_at = datetime(2026, 1, 10, 17, tzinfo=timezone.utc)
        self._txn(self.groceries, day=date(2026, 1, 8), amount=-100.0)
        self._txn(self.groceries, day=date(2026, 1, 3), amount=-50.0)
        rows = {r.day: r.total_value for r in compute_daily_net_worth(self.s, date(2026, 1, 1), date(2026, 1, 12))}
        self.assertEqual(rows[date(2026, 1, 1)], 1150.0)
        self.assertEqual(rows[date(2026, 1, 5)], 1100.0)
        self.assertEqual(rows[date(2026, 1, 8)], 1000.0)
        self.assertEqual(rows[date(2026, 1, 12)], 1000.0)

    def test_transfer_in_transit_does_not_dip(self):
        savings = Account(name="Savings", type="savings")
        self.s.add(savings)
        self.s.flush()
        self._txn(self.unc, day=date(2026, 1, 1), amount=500.0)
        group = create_transfer(self.s, self.bank.id, savings.id, 200.0, date(2026, 1, 5))
        legs = self.s.query(Transaction).filter(Transaction.transfer_group_id == group.id).all()
        next(t for t in legs if t.account_id == savings.id).date = date(2026, 1, 8)
        self.s.flush()
        values = {r.total_value for r in compute_daily_net_worth(self.s, date(2026, 1, 1), date(2026, 1, 10))}
        self.assertEqual(values, {500.0})

    def test_investments_follow_snapshots_not_buys(self):
        acct = Account(name="Brokerage", type="investment")
        self.s.add(acct)
        self.s.flush()
        for day, value in ((date(2026, 1, 2), 1000.0), (date(2026, 1, 6), 1300.0)):
            self.s.add(InvestmentSyncSnapshot(
                account_id=acct.id, captured_at=datetime(day.year, day.month, day.day, 17),
                reported_balance=value, positions_value=value, cash_balance=0.0,
            ))
        buy = Transaction(date=date(2026, 1, 4), amount=-400.0, merchant="buy 1 share of X for $400 each", account_id=acct.id)
        self.s.add(buy)
        self.s.flush()
        classify_investment_transaction(self.s, buy)
        self.s.flush()
        rows = {r.day: r.total_value for r in compute_daily_net_worth(self.s, date(2026, 1, 1), date(2026, 1, 7))}
        self.assertEqual(rows[date(2026, 1, 1)], 1000.0)
        self.assertEqual(rows[date(2026, 1, 4)], 1000.0)
        self.assertEqual(rows[date(2026, 1, 6)], 1300.0)
        self.assertEqual(rows[date(2026, 1, 7)], 1300.0)

    def test_history_is_stored_and_refreshed_when_data_changes(self):
        today = date.today()
        self._txn(self.unc, day=today - timedelta(days=3), amount=100.0)
        self.s.commit()
        first = net_worth_history(self.s, start=today - timedelta(days=5), end=today + timedelta(days=5))
        self.s.commit()
        self.assertEqual(first[0]["date"], (today - timedelta(days=3)).isoformat())  # clamped to first data
        self.assertEqual(first[-1]["date"], today.isoformat())  # clamped to today
        self._txn(self.unc, day=today - timedelta(days=1), amount=50.0)
        self.s.commit()
        second = net_worth_history(self.s, start=today - timedelta(days=5), end=today)
        self.assertEqual(second[-1]["total_value"], 150.0)


if __name__ == "__main__":
    unittest.main()
