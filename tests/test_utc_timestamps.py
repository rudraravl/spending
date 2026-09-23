"""API timestamps must carry a UTC offset so browsers don't read them as local time."""

import unittest
from datetime import datetime, timedelta, timezone

from backend.app.routers.simplefin import ConnectionOut, DailyBudgetOut
from backend.app.schemas import AccountOut
from utils.timestamps import as_utc, utc_isoformat

NAIVE_UTC = datetime(2026, 9, 23, 0, 53, 11)


class TestHelpers(unittest.TestCase):
    def test_naive_values_are_labelled_utc(self):
        self.assertEqual(as_utc(NAIVE_UTC), NAIVE_UTC.replace(tzinfo=timezone.utc))
        self.assertEqual(utc_isoformat(NAIVE_UTC), "2026-09-23T00:53:11+00:00")

    def test_aware_values_are_untouched(self):
        eastern = datetime(2026, 9, 22, 20, 53, tzinfo=timezone(timedelta(hours=-4)))
        self.assertIs(as_utc(eastern), eastern)

    def test_none_passes_through(self):
        self.assertIsNone(as_utc(None))
        self.assertIsNone(utc_isoformat(None))


class TestResponseModels(unittest.TestCase):
    def test_account_timestamps_serialize_with_offset(self):
        out = AccountOut(id=1, name="Card", type="credit", currency="USD", balance=0.0, last_synced_at=NAIVE_UTC)
        self.assertEqual(out.model_dump(mode="json")["last_synced_at"], "2026-09-23T00:53:11Z")

    def test_simplefin_connection_last_synced_serializes_with_offset(self):
        out = ConnectionOut(id=1, label="Prod", status="active", last_synced_at=NAIVE_UTC)
        self.assertIn("2026-09-23T00:53:11Z", out.model_dump_json())

    def test_missing_timestamp_stays_null(self):
        out = DailyBudgetOut(connection_id=1, used=0, limit=24)
        self.assertIsNone(out.model_dump(mode="json")["next_available_at"])


if __name__ == "__main__":
    unittest.main()
