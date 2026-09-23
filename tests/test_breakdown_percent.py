"""Unit tests for breakdown share-percent math (Views / Dashboard / Reports tables)."""

import unittest

import pandas as pd

from services.summary_service import _apply_signed_share, filter_dashboard_breakdowns


class TestBreakdownPercent(unittest.TestCase):
    def test_mixed_signs_share_within_direction(self):
        df = pd.DataFrame(
            {
                "category": ["Refunds", "Food", "Rent", "Income"],
                "total": [50.0, -300.0, -700.0, 2000.0],
            }
        )
        out = _apply_signed_share(df)

        # Biggest outflow first, then inflows biggest first.
        self.assertEqual(list(out["category"]), ["Rent", "Food", "Income", "Refunds"])
        pct = dict(zip(out["category"], out["percent"]))
        self.assertEqual(pct["Rent"], 70.0)
        self.assertEqual(pct["Food"], 30.0)
        self.assertAlmostEqual(pct["Income"] + pct["Refunds"], 100.0, places=1)
        self.assertTrue((out["percent"] >= 0).all())

    def test_only_outflows_sum_to_100(self):
        df = pd.DataFrame({"tag": ["a", "b", "c"], "total": [-1.0, -1.0, -2.0]})
        out = _apply_signed_share(df)
        self.assertEqual(list(out["tag"])[0], "c")
        self.assertEqual(list(out["percent"]), [50.0, 25.0, 25.0])

    def test_zero_total_rows_get_zero(self):
        df = pd.DataFrame({"tag": ["a", "b"], "total": [0.0, -10.0]})
        out = _apply_signed_share(df)
        self.assertEqual(dict(zip(out["tag"], out["percent"])), {"b": 100.0, "a": 0.0})

    def test_dashboard_filter_drops_income_and_handles_refund_category(self):
        cat = pd.DataFrame(
            {
                "category_id": [1, 2, 3],
                "category": ["Income", "Food", "Shopping"],
                "total": [3000.0, -400.0, 100.0],
                "count": [1, 5, 2],
                "percent": [0.0, 0.0, 0.0],
            }
        )
        sub = cat.assign(subcategory=["Pay", "Groceries", "Returns"])
        cat_out, sub_out = filter_dashboard_breakdowns(cat, sub)
        self.assertEqual(list(cat_out["category"]), ["Food", "Shopping"])
        self.assertEqual(list(cat_out["percent"]), [100.0, 100.0])
        self.assertEqual(list(sub_out["subcategory"]), ["Groceries", "Returns"])

    def test_empty_after_income_filter(self):
        cat = pd.DataFrame(
            {"category_id": [1], "category": ["Income"], "total": [10.0], "count": [1], "percent": [100.0]}
        )
        cat_out, _ = filter_dashboard_breakdowns(cat, cat.assign(subcategory=["Pay"]))
        self.assertEqual(len(cat_out), 0)


if __name__ == "__main__":
    unittest.main()
