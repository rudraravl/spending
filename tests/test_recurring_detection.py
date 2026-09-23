import unittest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, RecurringSeries, Transaction
from services.recurring_service import (
    RecurringSeriesActionIn,
    _add_months,
    _merchant_key,
    apply_series_action,
    list_recurring_suggestions,
    list_series_occurrences,
)

TODAY = date(2026, 9, 23)


class TestMerchantKey(unittest.TestCase):
    def test_strips_per_transaction_noise(self):
        self.assertEqual(
            _merchant_key("APPLE.COM/BILL 866-712-7753 CAAPPLE PAY ENDING IN 5476MLV4GYYKT9A0"),
            _merchant_key("APPLE.COM/BILL"),
        )
        self.assertEqual(_merchant_key("SQ *CUPPA IRVING TXAPPLE PAY ENDING IN 0607000230"), "cuppa irving")
        self.assertEqual(_merchant_key("ORCA*00S8TJD 2063985346 WA"), "orca")
        self.assertEqual(_merchant_key("H-E-B #768 AUSTIN TX"), _merchant_key("H-E-B #425 AUSTIN TX"))
        self.assertEqual(_merchant_key("Zelle money sent to PRANAV GOVIL"), _merchant_key("PRANAV GOVIL"))


class _Base(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.s = sessionmaker(bind=engine, autoflush=False)()
        self.card_a = Account(name="Card A", type="credit")
        self.card_b = Account(name="Card B", type="credit")
        self.s.add_all([self.card_a, self.card_b])
        self.s.commit()

    def tearDown(self):
        self.s.close()

    def _txn(self, d, amount, merchant, account=None):
        t = Transaction(date=d, amount=amount, merchant=merchant, account_id=(account or self.card_a).id)
        self.s.add(t)
        return t

    def _monthly(self, start, n, amount, merchant, account=None, day_jitter=()):
        for i in range(n):
            jitter = day_jitter[i] if i < len(day_jitter) else 0
            self._txn(_add_months(start, i) + timedelta(days=jitter), amount, merchant, account)

    def _cards(self):
        self.s.commit()
        return list_recurring_suggestions(self.s, today=TODAY)


class TestDetection(_Base):
    def test_subscription_spanning_two_cards_is_one_series(self):
        self._monthly(date(2025, 9, 26), 9, -2.99, "APPLE.COM/BILL 866-712-7753 CAAPPLE PAY ENDING IN 5476ABC123", day_jitter=(0, 1, 0, 3))
        self._monthly(date(2026, 6, 27), 3, -2.99, "APPLE.COM/BILL", account=self.card_b)
        cards = self._cards()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].cadence_type, "monthly")
        self.assertEqual(cards[0].occurrence_count, 12)
        self.assertTrue(cards[0].is_active)
        self.assertEqual(cards[0].display_name, "APPLE.COM/BILL")

    def test_same_amount_at_different_merchants_is_not_a_series(self):
        for i, m in enumerate(["MTA*NYCT PAYGO NEW YORK NY", "Rio Mart", "APPLE.COM/BILL", "ORCA*00S8TJD 2063985346 WA"]):
            self._txn(date(2026, 3, 1) + timedelta(days=14 * i), -3.00, m)
        self.assertEqual(self._cards(), [])

    def test_frequent_visits_are_not_weekly_series(self):
        d = date(2026, 6, 1)
        for i in range(30):
            self._txn(d + timedelta(days=i * 2 + (i % 3)), -40.0 - (i % 5), "H-E-B #768 AUSTIN TX")
        self.assertEqual(self._cards(), [])

    def test_missed_month_does_not_break_series(self):
        for m in (1, 2, 3, 5, 6, 7, 8, 9):
            self._txn(date(2026, m, 5), -15.49, "NETFLIX.COM")
        cards = self._cards()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].occurrence_count, 8)
        self.assertEqual(cards[0].next_expected_date, date(2026, 10, 5))

    def test_two_subscriptions_from_one_biller_stay_separate(self):
        self._monthly(date(2026, 3, 3), 6, -0.99, "APPLE.COM/BILL")
        self._monthly(date(2026, 3, 20), 6, -10.99, "APPLE.COM/BILL")
        cards = self._cards()
        self.assertEqual(sorted(c.amount_anchor_cents for c in cards), [-1099, -99])

    def test_annual_requires_fixed_amount(self):
        self._txn(date(2024, 9, 10), -139.0, "Amazon Prime")
        self._txn(date(2025, 9, 12), -139.0, "Amazon Prime")
        self._txn(date(2025, 1, 10), -30.0, "Target")
        self._txn(date(2026, 1, 12), -35.0, "Target")
        cards = self._cards()
        self.assertEqual([(c.display_name, c.cadence_type) for c in cards], [("Amazon Prime", "annual")])

    def test_variable_monthly_bill(self):
        for i, amt in enumerate([-48.1, -52.7, -61.3, -55.0, -49.9]):
            self._txn(_add_months(date(2026, 4, 15), i), amt, "CITY OF AUSTIN UTILITIES")
        cards = self._cards()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].cadence_type, "monthly")

    def test_stale_suggestions_hidden_but_confirmed_kept(self):
        self._monthly(date(2025, 1, 4), 6, -1239.87, "BPS*BILT RENT NEW YORK NY")
        self.assertEqual(self._cards(), [])
        self.s.add(RecurringSeries(merchant_norm="bilt rent new york", amount_anchor_cents=-123987, status="confirmed"))
        cards = self._cards()
        self.assertEqual(len(cards), 1)
        self.assertFalse(cards[0].is_active)


class TestSavedState(_Base):
    def test_actions_survive_price_change(self):
        self._monthly(date(2026, 1, 8), 5, -9.99, "SPOTIFY USA")
        self.s.commit()
        card = list_recurring_suggestions(self.s, today=date(2026, 5, 20))[0]
        apply_series_action(
            self.s,
            RecurringSeriesActionIn(merchant_norm=card.merchant_norm, amount_anchor_cents=card.amount_anchor_cents),
            status_value="confirmed",
        )
        self._monthly(date(2026, 6, 8), 4, -11.49, "SPOTIFY USA")
        cards = self._cards()
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0].status, "confirmed")
        self.assertEqual(cards[0].amount_anchor_cents, -999)  # stable key for UI actions
        self.assertEqual(cards[0].amount_anchor, -11.49)
        occs = list_series_occurrences(
            self.s, RecurringSeriesActionIn(merchant_norm=cards[0].merchant_norm, amount_anchor_cents=-999)
        )
        self.assertEqual(len(occs), 9)
        self.assertEqual(self.s.query(RecurringSeries).count(), 1)

    def test_legacy_amount_only_rows_carry_over(self):
        self._monthly(date(2026, 3, 26), 6, -2.99, "APPLE.COM/BILL")
        self._monthly(date(2026, 3, 12), 6, -4.99, "Some Streaming")
        self.s.add_all(
            [
                RecurringSeries(merchant_norm="__any__", amount_anchor_cents=-299, status="confirmed", category_id=None),
                RecurringSeries(merchant_norm="__any__", amount_anchor_cents=-499, status="removed"),
            ]
        )
        cards = self._cards()
        self.assertEqual([(c.display_name, c.status) for c in cards], [("APPLE.COM/BILL", "confirmed")])


if __name__ == "__main__":
    unittest.main()
