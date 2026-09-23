"""Unit tests for the local SimpleFIN request budget (rolling 24h, per-quota buckets)."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx

from services import simplefin_client as client
from services.simplefin_client import SimpleFINError

ACCESS_URL = "https://user:secret@bridge.example.test/simplefin"
DAY = 24 * 60 * 60
T0 = 1_790_000_000.0


class _BudgetTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.rate_file = Path(tmp.name) / "rate.json"
        self.now = T0
        for p in (
            patch.object(client, "_RATE_FILE", self.rate_file),
            patch.object(client.time, "time", side_effect=lambda: self.now),
            patch.dict(os.environ, {"SIMPLEFIN_MAX_REQUESTS_PER_DAY": "3"}),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _reserve(self, account_ids=None):
        return client._reserve_request(ACCESS_URL, client._request_buckets(account_ids))

    def _used(self, account_ids=None):
        return client.get_daily_budget_usage(ACCESS_URL, account_ids=account_ids).used


class TestRollingWindow(_BudgetTest):
    def test_requests_age_out_after_24_hours_not_at_midnight(self):
        self._reserve()
        self.now += 12 * 3600
        self._reserve()
        self.assertEqual(self._used(), 2)
        self.now = T0 + DAY + 1  # first request has aged out, second has not
        self.assertEqual(self._used(), 1)

    def test_exhausted_budget_raises_and_reports_next_slot(self):
        for offset in (0, 60, 120):
            self.now = T0 + offset
            self._reserve()
        usage = client.get_daily_budget_usage(ACCESS_URL)
        self.assertEqual((usage.used, usage.limit), (3, 3))
        self.assertEqual(usage.next_available_at, datetime.fromtimestamp(T0 + DAY, tz=timezone.utc))
        with self.assertRaises(SimpleFINError):
            self._reserve()
        self.assertEqual(self._used(), 3)  # the refused request was not charged
        self.now = T0 + DAY + 1
        self._reserve()  # the oldest slot freed up, and is now used again
        self.assertEqual(
            client.get_daily_budget_usage(ACCESS_URL).next_available_at,
            datetime.fromtimestamp(T0 + 60 + DAY, tz=timezone.utc),
        )

    def test_no_next_slot_while_budget_remains(self):
        self._reserve()
        self.assertIsNone(client.get_daily_budget_usage(ACCESS_URL).next_available_at)


class TestQuotaBuckets(_BudgetTest):
    def test_single_account_requests_have_their_own_quota(self):
        self._reserve(["acct-1"])
        self._reserve(["acct-1"])
        self.assertEqual(self._used(), 0)
        self.assertEqual(self._used(["acct-1"]), 2)
        self.assertEqual(self._used(["acct-2"]), 0)

    def test_multi_account_request_charges_each_account(self):
        self._reserve(["acct-1", "acct-2", "acct-1"])
        self.assertEqual(self._used(["acct-1"]), 1)
        self.assertEqual(self._used(["acct-2"]), 1)
        self.assertEqual(self._used(), 0)

    def test_different_access_urls_are_tracked_separately(self):
        self._reserve()
        other = client.get_daily_budget_usage("https://u2:s@bridge.example.test/simplefin")
        self.assertEqual(other.used, 0)

    def test_file_never_stores_credentials(self):
        self._reserve()
        self.assertNotIn("secret", self.rate_file.read_text())


class TestLegacyFile(_BudgetTest):
    def test_legacy_daily_counts_are_charged_at_last_write(self):
        scope = client._access_scope_key(ACCESS_URL)
        self.rate_file.write_text(json.dumps({"2026-09-22": {scope: {"all_accounts": 2}}}))
        os.utime(self.rate_file, (T0 - 3600, T0 - 3600))
        self.assertEqual(self._used(), 2)
        self.now = T0 - 3600 + DAY + 1
        self.assertEqual(self._used(), 0)

    def test_corrupt_file_is_treated_as_empty(self):
        self.rate_file.write_text("{not json")
        self.assertEqual(self._used(), 0)
        self._reserve()
        self.assertEqual(self._used(), 1)


class TestRequestCharging(_BudgetTest):
    def _get(self, **side_effect):
        with patch.object(httpx.Client, "get", **side_effect):
            return client.get_accounts(ACCESS_URL)

    def test_successful_request_is_charged_once(self):
        resp = httpx.Response(200, json={"errors": [], "accounts": []})
        self._get(return_value=resp)
        self.assertEqual(self._used(), 1)

    def test_http_error_response_is_still_charged(self):
        with self.assertRaises(SimpleFINError):
            self._get(return_value=httpx.Response(500))
        self.assertEqual(self._used(), 1)

    def test_connection_failure_is_refunded(self):
        with self.assertRaises(SimpleFINError):
            self._get(side_effect=httpx.ConnectError("dns failure"))
        self.assertEqual(self._used(), 0)

    def test_read_timeout_stays_charged(self):
        # The request was sent; SimpleFIN may have counted it.
        with self.assertRaises(httpx.ReadTimeout):
            self._get(side_effect=httpx.ReadTimeout("slow"))
        self.assertEqual(self._used(), 1)


if __name__ == "__main__":
    unittest.main()
