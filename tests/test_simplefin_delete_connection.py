"""Deleting a SimpleFIN connection requires it to be revoked on SimpleFIN first."""

import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import InvalidToken
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, SimpleFINConnection, Transaction
from services import simplefin_sync_service as svc
from services.simplefin_client import SFINAccountSet, SimpleFINAuthError, SimpleFINError


class TestDeleteConnection(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)()
        self.conn = SimpleFINConnection(label="SimpleFIN", access_url_encrypted="ciphertext")
        self.acct = Account(
            name="Checking",
            type="checking",
            is_linked=True,
            provider=svc.PROVIDER_NAME,
            external_id="CONN-1:a1",
            institution_name="Bank",
        )
        self.session.add_all([self.conn, self.acct])
        self.session.flush()
        self.session.add(Transaction(date=date(2026, 10, 1), amount=-5.0, merchant="m", account_id=self.acct.id))
        self.session.commit()

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.snapshot = Path(tmp.name) / "snapshot.json"
        self.snapshot.write_text("{}")
        patcher = patch.object(svc, "_LATEST_ACCOUNTS_SNAPSHOT_PATH", self.snapshot)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.session.close()

    def _delete(self, *, accounts_side_effect=None, decrypt_side_effect=None):
        with (
            patch.object(svc, "decrypt", return_value="https://u:p@x.test/s", side_effect=decrypt_side_effect),
            patch.object(svc, "get_accounts", side_effect=accounts_side_effect) as get_accounts,
        ):
            svc.delete_connection(self.session, self.conn.id)
        return get_accounts

    def _assert_kept(self):
        self.assertEqual(self.session.query(SimpleFINConnection).count(), 1)
        self.assertTrue(self.session.get(Account, self.acct.id).is_linked)
        self.assertTrue(self.snapshot.exists())

    def test_revoked_connection_is_deleted_and_accounts_unlinked(self):
        get_accounts = self._delete(accounts_side_effect=SimpleFINAuthError("403"))

        get_accounts.assert_called_once_with("https://u:p@x.test/s", balances_only=True)
        self.assertEqual(self.session.query(SimpleFINConnection).count(), 0)
        acct = self.session.get(Account, self.acct.id)
        self.assertFalse(acct.is_linked)
        self.assertIsNone(acct.provider)
        self.assertIsNone(acct.external_id)
        # The account and its history stay; only the link goes.
        self.assertEqual(self.session.query(Transaction).count(), 1)
        self.assertFalse(self.snapshot.exists())

    def test_still_active_connection_is_refused(self):
        with self.assertRaises(svc.ConnectionStillActiveError):
            self._delete(accounts_side_effect=lambda *a, **k: SFINAccountSet(errors=[], accounts=[]))
        self._assert_kept()

    def test_unverifiable_revocation_is_refused(self):
        with self.assertRaises(SimpleFINError):
            self._delete(accounts_side_effect=SimpleFINError("Could not connect to SimpleFIN."))
        self._assert_kept()

    def test_undecryptable_access_url_can_be_deleted(self):
        get_accounts = self._delete(decrypt_side_effect=InvalidToken())

        get_accounts.assert_not_called()
        self.assertEqual(self.session.query(SimpleFINConnection).count(), 0)


if __name__ == "__main__":
    unittest.main()
