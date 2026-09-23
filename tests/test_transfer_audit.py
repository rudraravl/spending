"""Regression tests from the transfer-linking audit: leg integrity, notes, confidence, duplicates, sync detection."""

import unittest
from datetime import date, datetime, time, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, Category, SimpleFINConnection, Subcategory, Transaction
from backend.app.routers import simplefin as simplefin_router
from services import simplefin_sync_service as sync_svc
from services.simplefin_client import SFINAccount, SFINAccountSet, SFINTransaction
from services.transfer_matching_service import find_transfer_match_candidates
from services.transaction_service import (
    create_transfer,
    link_transactions_as_transfer,
    unlink_transfer_pair,
    update_transaction,
)

LINK_NOTE = "Linked as transfer."


class _Base(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.s = sessionmaker(bind=engine)()
        other = Category(name="Other")
        self.s.add(other)
        self.s.flush()
        unc = Subcategory(name="Uncategorized", category_id=other.id)
        self.s.add(unc)
        self.s.flush()
        self.cat_id, self.sub_id = other.id, unc.id
        self.bank = Account(name="360 Checking", type="checking", institution_name="Capital One")
        self.card = Account(name="Venture X", type="credit", institution_name="Capital One")
        self.brokerage = Account(name="Robinhood", type="investment", institution_name="Robinhood")
        self.s.add_all([self.bank, self.card, self.brokerage])
        self.s.commit()

    def tearDown(self):
        self.s.close()

    def _txn(self, account, amount, merchant, d=date(2026, 9, 8), **kw):
        t = Transaction(
            date=d,
            amount=amount,
            merchant=merchant,
            account_id=account.id,
            category_id=self.cat_id,
            subcategory_id=self.sub_id,
            **kw,
        )
        self.s.add(t)
        self.s.commit()
        return t

    def _linked_pair(self):
        out = self._txn(self.bank, -200.0, "CAPITAL ONE")
        inn = self._txn(self.card, 200.0, "CAPITAL ONE MOBILE PYMT")
        link_transactions_as_transfer(self.s, out.id, inn.id)
        return out, inn


class TestLinkedLegIntegrity(_Base):
    def test_changing_a_linked_legs_amount_is_rejected(self):
        out, inn = self._linked_pair()
        with self.assertRaisesRegex(ValueError, "linked transfer"):
            update_transaction(self.s, out.id, amount=-150.0)
        self.s.rollback()
        self.assertEqual(self.s.get(Transaction, out.id).amount, -200.0)

    def test_moving_a_linked_leg_to_another_account_is_rejected(self):
        out, inn = self._linked_pair()
        with self.assertRaisesRegex(ValueError, "linked transfer"):
            update_transaction(self.s, out.id, account_id=self.card.id)

    def test_unchanged_amount_and_account_are_allowed(self):
        # The transactions table re-sends every field when saving a row.
        out, _ = self._linked_pair()
        update_transaction(self.s, out.id, amount=-200.0, account_id=self.bank.id, merchant="Card payment")
        self.assertEqual(self.s.get(Transaction, out.id).merchant, "Card payment")

    def test_date_and_notes_edits_are_allowed(self):
        out, _ = self._linked_pair()
        update_transaction(self.s, out.id, date_=date(2026, 9, 9), notes="autopay")
        self.assertEqual(self.s.get(Transaction, out.id).date, date(2026, 9, 9))


class TestLinkNotes(_Base):
    def test_relinking_does_not_stack_notes(self):
        out, inn = self._linked_pair()
        unlink_transfer_pair(self.s, out.id, inn.id)
        link_transactions_as_transfer(self.s, out.id, inn.id)
        self.assertEqual(self.s.get(Transaction, out.id).notes.count(LINK_NOTE), 1)

    def test_unlink_removes_link_note_but_keeps_user_notes(self):
        out = self._txn(self.bank, -50.0, "XFER", notes="rent share")
        inn = self._txn(self.brokerage, 50.0, "DEPOSIT")
        link_transactions_as_transfer(self.s, out.id, inn.id)
        unlink_transfer_pair(self.s, out.id, inn.id)
        self.assertEqual(self.s.get(Transaction, out.id).notes, "rent share")
        self.assertIsNone(self.s.get(Transaction, inn.id).notes)


class TestCandidateConfidence(_Base):
    def _only_candidate(self, seeds=None):
        pairs = find_transfer_match_candidates(self.s, seed_transaction_ids=seeds)
        self.assertEqual(len(pairs), 1)
        return pairs[0]

    def test_payment_wording_and_institution_is_high_confidence(self):
        self._txn(self.bank, -585.64, "CAPITAL ONE", d=date(2026, 9, 22))
        self._txn(self.card, 585.64, "CAPITAL ONE ONLINE PYMT", d=date(2026, 9, 21))
        pair = self._only_candidate()
        self.assertEqual(pair.confidence, "high")
        self.assertTrue(pair.reasons)

    def test_refund_matching_a_bank_debit_by_chance_is_low_confidence(self):
        self._txn(self.bank, -42.10, "TRADER JOES")
        self._txn(self.card, 42.10, "AMAZON MKTPL REFUND")
        self.assertEqual(self._only_candidate().confidence, "low")

    def test_higher_confidence_sorts_first(self):
        self._txn(self.bank, -42.10, "TRADER JOES", d=date(2026, 9, 8))
        self._txn(self.card, 42.10, "AMAZON MKTPL REFUND", d=date(2026, 9, 8))
        self._txn(self.bank, -900.0, "CAPITAL ONE", d=date(2026, 9, 1))
        self._txn(self.card, 900.0, "CAPITAL ONE MOBILE PYMT", d=date(2026, 9, 4))
        pairs = find_transfer_match_candidates(self.s)
        self.assertEqual([p.confidence for p in pairs], ["high", "low"])


class TestDuplicateOfManualTransfer(_Base):
    def test_real_legs_matching_a_manual_transfer_are_flagged(self):
        group = create_transfer(self.s, self.bank.id, self.card.id, 300.0, date(2026, 9, 5))
        self._txn(self.bank, -300.0, "CAPITAL ONE", d=date(2026, 9, 6))
        self._txn(self.card, 300.0, "CAPITAL ONE MOBILE PYMT", d=date(2026, 9, 6))
        pair = find_transfer_match_candidates(self.s)[0]
        self.assertEqual(pair.duplicate_of_transfer_group_id, group.id)
        self.assertEqual(pair.confidence, "low")

    def test_unrelated_manual_transfer_is_not_flagged(self):
        create_transfer(self.s, self.bank.id, self.brokerage.id, 300.0, date(2026, 9, 5))
        self._txn(self.bank, -300.0, "CAPITAL ONE", d=date(2026, 9, 6))
        self._txn(self.card, 300.0, "CAPITAL ONE MOBILE PYMT", d=date(2026, 9, 6))
        pair = find_transfer_match_candidates(self.s)[0]
        self.assertIsNone(pair.duplicate_of_transfer_group_id)


class TestSyncReportsImportedIds(_Base):
    def test_sync_returns_ids_of_imported_transactions(self):
        self.card.is_linked = True
        self.card.provider = sync_svc.PROVIDER_NAME
        self.card.external_id = sync_svc._make_account_external_id("C1", "r1")
        self.card.sync_covered_through = datetime(2026, 9, 1, tzinfo=timezone.utc)
        self.s.add(SimpleFINConnection(label="t", access_url_encrypted="x"))
        self.s.commit()
        posted = int(datetime.combine(date(2026, 9, 8), time(12), tzinfo=timezone.utc).timestamp())
        remote = SFINAccount(
            id="r1", name="card", conn_id="C1", currency="USD", balance="0", balance_date=posted,
            transactions=[SFINTransaction(id="t1", posted=posted, amount="200.00", description="PYMT")],
        )
        with patch.object(sync_svc, "decrypt", return_value="https://u:p@x.test/s"), \
                patch.object(sync_svc, "_write_latest_accounts_snapshot"), \
                patch.object(sync_svc, "capture_net_worth_snapshot"), \
                patch.object(sync_svc, "apply_rules_to_transaction"), \
                patch.object(sync_svc, "get_accounts_with_payload",
                             return_value=(SFINAccountSet(accounts=[remote]), {})):
            result = sync_svc.sync_connection(self.s)
        imported = self.s.query(Transaction).filter(Transaction.merchant == "PYMT").one()
        self.assertEqual(result.imported_transaction_ids, [imported.id])


class TestSyncEndpointSuggestsTransfers(_Base):
    def _call_sync(self, imported_ids):
        result = sync_svc.SyncResult(accounts_synced=2, transactions_imported=len(imported_ids),
                                     imported_transaction_ids=imported_ids)
        with patch.object(simplefin_router, "sync_connection", return_value=result):
            return simplefin_router.api_sync(simplefin_router.SyncIn(), session=self.s)

    def test_candidates_for_new_transactions_are_returned(self):
        out = self._txn(self.bank, -200.0, "CAPITAL ONE")
        inn = self._txn(self.card, 200.0, "CAPITAL ONE MOBILE PYMT")
        response = self._call_sync([inn.id])
        self.assertEqual(response.imported_transaction_ids, [inn.id])
        self.assertEqual(len(response.transfer_candidates), 1)
        candidate = response.transfer_candidates[0]
        self.assertEqual((candidate.asset_transaction_id, candidate.credit_transaction_id), (out.id, inn.id))
        self.assertEqual(candidate.confidence, "high")

    def test_old_unlinked_pairs_are_not_resuggested(self):
        # Pairs the user skipped earlier shouldn't pop up again on unrelated syncs.
        self._txn(self.bank, -200.0, "CAPITAL ONE")
        self._txn(self.card, 200.0, "CAPITAL ONE MOBILE PYMT")
        unrelated = self._txn(self.bank, -12.0, "COFFEE")
        self.assertEqual(self._call_sync([unrelated.id]).transfer_candidates, [])

    def test_no_new_transactions_means_no_candidates(self):
        self.assertEqual(self._call_sync([]).transfer_candidates, [])


if __name__ == "__main__":
    unittest.main()
