"""Unit tests for SimpleFIN sync start-date planning and coverage tracking."""

import unittest
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, SimpleFINConnection, Transaction
from services import simplefin_sync_service as svc
from services.simplefin_client import SFINAccount, SFINAccountSet, SFINError, SFINTransaction

TODAY = date(2026, 9, 22)
CONN_ID = "CONN-1"


def _utc(d: date) -> datetime:
    return datetime.combine(d, time(12), tzinfo=timezone.utc)


class _Base(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)()

    def tearDown(self):
        self.session.close()

    def _linked(self, name, remote_id, *, covered=None, txn_dates=()):
        acct = Account(
            name=name,
            type="credit",
            is_linked=True,
            provider=svc.PROVIDER_NAME,
            external_id=svc._make_account_external_id(CONN_ID, remote_id),
            sync_covered_through=_utc(covered) if covered else None,
        )
        self.session.add(acct)
        self.session.flush()
        for i, d in enumerate(txn_dates):
            self.session.add(
                Transaction(date=d, amount=-1.0 - i, merchant=f"m{i}", account_id=acct.id)
            )
        self.session.flush()
        return acct


class TestPlanSyncWindow(_Base):
    def _plan(self, accounts, fallback=TODAY - timedelta(days=7)):
        return svc._plan_sync_window(
            self.session, accounts, fallback_start_date=fallback, today=TODAY
        )

    def test_dormant_account_does_not_drag_start_back(self):
        # Last transaction months ago, but synced yesterday: nothing to re-fetch.
        crypto = self._linked("Crypto", "a1", covered=TODAY - timedelta(days=1),
                              txn_dates=[date(2026, 3, 25)])
        plan = self._plan([crypto])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=1 + svc.SYNC_OVERLAP_DAYS))
        self.assertEqual(plan.gaps, [])

    def test_earliest_account_requirement_wins(self):
        fresh = self._linked("Fresh", "a1", covered=TODAY)
        stale = self._linked("Stale", "a2", covered=TODAY - timedelta(days=20))
        plan = self._plan([fresh, stale])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=20 + svc.SYNC_OVERLAP_DAYS))

    def test_uses_latest_local_transaction_without_coverage(self):
        # e.g. history imported from CSV, then linked, never synced.
        csv = self._linked("CSV", "a1", txn_dates=[TODAY - timedelta(days=15), TODAY - timedelta(days=5)])
        plan = self._plan([csv])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=5 + svc.SYNC_OVERLAP_DAYS))

    def test_newer_local_transaction_beats_older_coverage(self):
        acct = self._linked("Mixed", "a1", covered=TODAY - timedelta(days=30),
                            txn_dates=[TODAY - timedelta(days=2)])
        plan = self._plan([acct])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=2 + svc.SYNC_OVERLAP_DAYS))

    def test_clamps_to_window_and_reports_gap(self):
        old = self._linked("Old", "a1", covered=TODAY - timedelta(days=100))
        fresh = self._linked("Fresh", "a2", covered=TODAY)
        plan = self._plan([old, fresh])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=svc.MAX_SYNC_WINDOW_DAYS))
        self.assertEqual([(a.name, d) for a, d in plan.gaps], [("Old", TODAY - timedelta(days=100))])

    def test_overlap_only_past_floor_is_not_a_gap(self):
        # Covered inside the window, but covered - overlap falls before the floor.
        acct = self._linked("Edge", "a1", covered=TODAY - timedelta(days=svc.MAX_SYNC_WINDOW_DAYS - 2))
        plan = self._plan([acct])
        self.assertEqual(plan.start_date, TODAY - timedelta(days=svc.MAX_SYNC_WINDOW_DAYS))
        self.assertEqual(plan.gaps, [])

    def test_accounts_without_history_are_left_for_bootstrap(self):
        empty = self._linked("Empty", "a1")
        fallback = TODAY - timedelta(days=7)
        plan = self._plan([empty], fallback=fallback)
        self.assertEqual(plan.required_starts, {})
        self.assertEqual(plan.start_date, fallback)

    def test_window_stays_within_recommended_range(self):
        self.assertLess(svc.MAX_SYNC_WINDOW_DAYS, svc.RECOMMENDED_SIMPLEFIN_WINDOW_DAYS)


class TestSyncCoverage(_Base):
    def setUp(self):
        super().setUp()
        self.session.add(SimpleFINConnection(label="Test", access_url_encrypted="x"))
        self.session.flush()
        self.balance_date = int(_utc(TODAY - timedelta(days=1)).timestamp())
        patches = [
            patch.object(svc, "decrypt", return_value="https://u:p@example.test/simplefin"),
            patch.object(svc, "_write_latest_accounts_snapshot"),
            patch.object(svc, "capture_net_worth_snapshot"),
            patch.object(svc, "apply_rules_to_transaction"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.get_accounts = patch.object(svc, "get_accounts").start()
        self.addCleanup(patch.stopall)
        self.get_accounts.return_value = SFINAccountSet()

    def _remote(self, remote_id, *, balance_date=None, txns=()):
        return SFINAccount(
            id=remote_id,
            name=remote_id,
            conn_id=CONN_ID,
            currency="USD",
            balance="0",
            balance_date=self.balance_date if balance_date is None else balance_date,
            transactions=list(txns),
        )

    def _sync(self, accounts, errors=(), **kwargs):
        account_set = SFINAccountSet(errors=list(errors), accounts=list(accounts))
        with patch.object(svc, "get_accounts_with_payload", return_value=(account_set, {})) as fetch:
            result = svc.sync_connection(self.session, **kwargs)
        return result, fetch

    def test_coverage_advances_to_institution_refresh_time(self):
        acct = self._linked("Card", "r1", covered=TODAY - timedelta(days=3), txn_dates=[TODAY - timedelta(days=3)])
        self._sync([self._remote("r1")])
        self.assertEqual(
            acct.sync_covered_through.replace(tzinfo=timezone.utc),
            datetime.fromtimestamp(self.balance_date, tz=timezone.utc),
        )

    def test_empty_account_is_bootstrapped_only_once(self):
        self._linked("Empty", "r1")
        self._sync([self._remote("r1")])
        self._sync([self._remote("r1")])
        self.assertEqual(self.get_accounts.call_count, 1)

    def test_errored_account_keeps_old_coverage(self):
        covered = TODAY - timedelta(days=3)
        acct = self._linked("Card", "r1", covered=covered, txn_dates=[covered])
        error = SFINError(code="con.auth", message="Reauthenticate", conn_id=CONN_ID)
        self._sync([self._remote("r1")], errors=[error])
        self.assertEqual(acct.sync_covered_through.date(), covered)

    def test_explicit_end_date_does_not_advance_coverage(self):
        covered = TODAY - timedelta(days=3)
        acct = self._linked("Card", "r1", covered=covered, txn_dates=[covered])
        self._sync([self._remote("r1")], start_date=TODAY - timedelta(days=30), end_date=TODAY - timedelta(days=20))
        self.assertEqual(acct.sync_covered_through.date(), covered)

    def test_gap_is_reported_as_warning(self):
        self._linked("Old", "r1", covered=date.today() - timedelta(days=100))
        result, _ = self._sync([self._remote("r1")])
        self.assertTrue(any("Old: no synced data since" in e for e in result.errors or []))

    def test_request_uses_planned_start(self):
        covered = date.today() - timedelta(days=2)
        self._linked("Card", "r1", covered=covered, txn_dates=[date(2026, 1, 1)])
        _, fetch = self._sync([self._remote("r1")])
        requested = date.fromtimestamp(fetch.call_args.kwargs["start_date"])
        self.assertEqual(requested, covered - timedelta(days=svc.SYNC_OVERLAP_DAYS))

    def test_imports_new_transactions(self):
        covered = date.today() - timedelta(days=2)
        acct = self._linked("Card", "r1", covered=covered, txn_dates=[covered])
        txn = SFINTransaction(id="t1", posted=int(_utc(date.today()).timestamp()), amount="-5.00", description="Coffee")
        result, _ = self._sync([self._remote("r1", txns=[txn])])
        self.assertEqual(result.transactions_imported, 1)
        self.assertEqual(
            self.session.query(Transaction).filter(Transaction.account_id == acct.id).count(), 2
        )


class TestRelinkResetsCoverage(_Base):
    def test_relink_to_different_remote_clears_coverage(self):
        acct = self._linked("Card", "old", covered=TODAY)
        with patch.object(svc, "_is_external_id_in_cached_snapshot", return_value=False):
            svc.link_account(self.session, CONN_ID, "new", acct.id)
        self.assertIsNone(acct.sync_covered_through)

    def test_relink_to_same_remote_keeps_coverage(self):
        acct = self._linked("Card", "same", covered=TODAY)
        svc.link_account(self.session, CONN_ID, "same", acct.id)
        self.assertIsNotNone(acct.sync_covered_through)


if __name__ == "__main__":
    unittest.main()
