"""Unit tests for card-payment transfer matching and linking."""

import unittest
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, Category, Subcategory, Transaction, TransactionSplit
from services.transfer_matching_service import find_card_payment_pair_candidates
from services.trasaction_service import link_transactions_as_transfer


def _seed_other(session):
    c = Category(name="Other")
    session.add(c)
    session.flush()
    s = Subcategory(name="Uncategorized", category_id=c.id)
    session.add(s)
    session.flush()
    return c.id, s.id


class TestTransferLinking(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.session = self.Session()
        self.cat_id, self.sub_id = _seed_other(self.session)
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_link_sets_transfer_and_canonical_max(self):
        s = self.session
        bank = Account(name="Bank", type="checking")
        card = Account(name="Card", type="credit")
        s.add_all([bank, card])
        s.flush()
        t1 = Transaction(
            date=date(2025, 1, 1),
            amount=-100.0,
            merchant="ACH",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t2 = Transaction(
            date=date(2025, 1, 1),
            amount=99.98,
            merchant="Payment",
            account_id=card.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t1, t2])
        s.commit()
        a_id, b_id = t1.id, t2.id
        link_transactions_as_transfer(s, a_id, b_id)
        ob = s.get(Transaction, a_id)
        oc = s.get(Transaction, b_id)
        self.assertIsNotNone(ob.transfer_group_id)
        self.assertEqual(ob.transfer_group_id, oc.transfer_group_id)
        self.assertTrue(ob.is_transfer and oc.is_transfer)
        self.assertEqual(ob.amount, -100.0)
        self.assertEqual(oc.amount, 100.0)
        self.assertIsNone(ob.category_id)
        self.assertIsNone(oc.category_id)

    def test_link_preserves_each_leg_date(self):
        s = self.session
        chk = Account(name="ChkDate", type="checking")
        inv = Account(name="InvDate", type="investment")
        s.add_all([chk, inv])
        s.flush()
        d_out = date(2025, 6, 1)
        d_in = date(2025, 6, 5)
        t_out = Transaction(
            date=d_out,
            amount=-40.0,
            merchant="ACH out",
            account_id=chk.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_in = Transaction(
            date=d_in,
            amount=40.0,
            merchant="Settled",
            account_id=inv.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t_out, t_in])
        s.commit()
        link_transactions_as_transfer(s, t_out.id, t_in.id)
        o_out = s.get(Transaction, t_out.id)
        o_in = s.get(Transaction, t_in.id)
        self.assertEqual(o_out.date, d_out)
        self.assertEqual(o_in.date, d_in)

    def test_link_allows_non_credit_accounts(self):
        s = self.session
        b1 = Account(name="B1", type="checking")
        b2 = Account(name="B2", type="investment")
        s.add_all([b1, b2])
        s.flush()
        t1 = Transaction(
            date=date(2025, 1, 1),
            amount=-50.0,
            merchant="x",
            account_id=b1.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t2 = Transaction(
            date=date(2025, 1, 1),
            amount=50.0,
            merchant="y",
            account_id=b2.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t1, t2])
        s.commit()
        group = link_transactions_as_transfer(s, t1.id, t2.id)
        self.assertIsNotNone(group.id)

    def test_link_rejects_same_sign_legs(self):
        s = self.session
        b1 = Account(name="B1x", type="checking")
        b2 = Account(name="B2x", type="investment")
        s.add_all([b1, b2])
        s.flush()
        t1 = Transaction(
            date=date(2025, 1, 1),
            amount=-50.0,
            merchant="x",
            account_id=b1.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t2 = Transaction(
            date=date(2025, 1, 1),
            amount=-50.0,
            merchant="y",
            account_id=b2.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t1, t2])
        s.commit()
        with self.assertRaises(ValueError):
            link_transactions_as_transfer(s, t1.id, t2.id)

    def test_link_rejects_splits(self):
        s = self.session
        bank = Account(name="Bank2", type="checking")
        card = Account(name="Card2", type="credit")
        s.add_all([bank, card])
        s.flush()
        t = Transaction(
            date=date(2025, 2, 1),
            amount=-25.0,
            merchant="splitme",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add(t)
        s.flush()
        t.splits.append(
            TransactionSplit(
                category_id=self.cat_id,
                subcategory_id=self.sub_id,
                amount=-25.0,
            )
        )
        t2 = Transaction(
            date=date(2025, 2, 1),
            amount=25.0,
            merchant="cc",
            account_id=card.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add(t2)
        s.commit()
        with self.assertRaises(ValueError):
            link_transactions_as_transfer(s, t.id, t2.id)

    def test_find_candidates_full_scan(self):
        s = self.session
        bank = Account(name="Chk", type="checking")
        card = Account(name="Visa", type="credit")
        s.add_all([bank, card])
        s.flush()
        today = datetime.now().date()
        d_bank = today - timedelta(days=2)
        d_cc = today - timedelta(days=1)
        t_bank = Transaction(
            date=d_bank,
            amount=-250.0,
            merchant="BANK OF X",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_cc = Transaction(
            date=d_cc,
            amount=250.01,
            merchant="AUTOPAY",
            account_id=card.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t_bank, t_cc])
        s.commit()
        pairs = find_card_payment_pair_candidates(s, seed_transaction_ids=None, lookback_days=365)
        self.assertEqual(len(pairs), 1)
        self.assertEqual({pairs[0].asset_transaction_id, pairs[0].credit_transaction_id}, {t_bank.id, t_cc.id})

    def test_ambiguous_one_bank_two_cc_credits_returns_both(self):
        """Bank -$3 with CC +$2.97 and +$3: both are within $0.03 — suggest both pairs."""
        s = self.session
        bank = Account(name="AmbBank", type="checking")
        card = Account(name="AmbVisa", type="credit")
        s.add_all([bank, card])
        s.flush()
        today = datetime.now().date()
        t_bank = Transaction(
            date=today,
            amount=-3.0,
            merchant="ACH DEBIT",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_cc1 = Transaction(
            date=today,
            amount=2.97,
            merchant="PAYMENT",
            account_id=card.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_cc2 = Transaction(
            date=today,
            amount=3.0,
            merchant="PAYMENT",
            account_id=card.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t_bank, t_cc1, t_cc2])
        s.commit()
        pairs = find_card_payment_pair_candidates(s, seed_transaction_ids=None, lookback_days=365)
        self.assertEqual(len(pairs), 2)
        credits = {p.credit_transaction_id for p in pairs}
        self.assertEqual(credits, {t_cc1.id, t_cc2.id})
        for p in pairs:
            self.assertEqual(p.asset_transaction_id, t_bank.id)

    def test_find_candidates_respects_date_window(self):
        s = self.session
        bank = Account(name="Chk2", type="checking")
        card2 = Account(name="Visa2", type="credit")
        s.add_all([bank, card2])
        s.flush()
        t_bank = Transaction(
            date=date(2025, 4, 1),
            amount=-100.0,
            merchant="out",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_cc = Transaction(
            date=date(2025, 4, 12),
            amount=100.0,
            merchant="in",
            account_id=card2.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t_bank, t_cc])
        s.commit()
        pairs = find_card_payment_pair_candidates(s, seed_transaction_ids=None, lookback_days=365)
        self.assertEqual(len(pairs), 0)

    def test_seed_mode_includes_cross_pair(self):
        s = self.session
        bank = Account(name="Chk3", type="checking")
        card3 = Account(name="Visa3", type="credit")
        s.add_all([bank, card3])
        s.flush()
        t_bank = Transaction(
            date=date(2025, 5, 10),
            amount=-75.0,
            merchant="bill",
            account_id=bank.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        t_cc = Transaction(
            date=date(2025, 5, 10),
            amount=75.0,
            merchant="pmt",
            account_id=card3.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
        )
        s.add_all([t_bank, t_cc])
        s.commit()
        pairs = find_card_payment_pair_candidates(s, seed_transaction_ids=[t_bank.id], lookback_days=365)
        self.assertEqual(len(pairs), 1)


if __name__ == "__main__":
    unittest.main()
