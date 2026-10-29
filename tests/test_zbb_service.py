import unittest
from datetime import date
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, BudgetCategory, BudgetSetting, Category, Subcategory, Transaction
from services.zbb_service import (
    assign_amount,
    create_budget_category,
    delete_budget_category,
    get_month_overview,
    list_budget_categories,
    move_money,
    quick_assign,
    set_budget_start_month,
    set_rollover_mode,
    update_budget_category,
)


class TestZbbService(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.session = sessionmaker(bind=engine)()
        # Pin "today" so the Ready to Assign horizon is deterministic.
        patcher = mock.patch("services.zbb_service._today", return_value=date(2026, 3, 15))
        patcher.start()
        self.addCleanup(patcher.stop)

        food = Category(name="Food")
        other = Category(name="Other")
        income = Category(name="Income")
        self.session.add_all([food, other, income])
        self.session.flush()
        self.food_id, self.other_id, self.income_id = int(food.id), int(other.id), int(income.id)
        grocery = Subcategory(name="Grocery", category_id=food.id)
        dining = Subcategory(name="Dining", category_id=food.id)
        unc = Subcategory(name="Uncategorized", category_id=other.id)
        paycheck = Subcategory(name="Paycheck", category_id=income.id)
        self.session.add_all([grocery, dining, unc, paycheck])
        self.session.flush()
        self.grocery_id, self.dining_id = int(grocery.id), int(dining.id)
        self.unc_id, self.paycheck_id = int(unc.id), int(paycheck.id)

        checking = Account(name="Checking", type="checking", is_budget_account=True)
        visa = Account(name="Visa", type="credit", is_budget_account=True)
        brokerage = Account(name="Brokerage", type="investment", is_budget_account=False)
        self.session.add_all([checking, visa, brokerage])
        self.session.add(BudgetSetting(id=1, rollover_mode="strict", budget_start_year=2026, budget_start_month=3))
        self.session.flush()
        self.checking_id, self.visa_id, self.brokerage_id = int(checking.id), int(visa.id), int(brokerage.id)
        self._txn(date(2026, 2, 28), 1000.0, self.checking_id, self.income_id, self.paycheck_id)
        self.session.commit()

    def tearDown(self):
        self.session.close()

    # --- helpers -----------------------------------------------------------------------------

    def _txn(self, d, amount, account_id, category_id=None, subcategory_id=None, is_transfer=False):
        self.session.add(
            Transaction(
                date=d,
                amount=amount,
                merchant="m",
                account_id=account_id,
                category_id=category_id,
                subcategory_id=subcategory_id,
                is_transfer=is_transfer,
            )
        )
        self.session.flush()

    def _row(self, out, name):
        return next(r for r in out["rows"] if r["category_name"] == name)

    def _food(self):
        return int(self._row(get_month_overview(self.session, 2026, 3), "Food")["category_id"])

    def assertIdentity(self, out):
        """Cash on budget = Ready to Assign + Σ Available, evaluated at the horizon month."""
        hy, hm = out["horizon_year"], out["horizon_month"]
        horizon = out if (hy, hm) == (out["year"], out["month"]) else get_month_overview(self.session, hy, hm)
        total = sum(float(r["available"]) for r in horizon["rows"])
        self.assertAlmostEqual(float(out["cash_on_budget"]), total + float(out["ready_to_assign"]), places=6)

    # --- envelopes ---------------------------------------------------------------------------

    def test_first_run_seeds_envelopes_but_not_income(self):
        names = {c["name"] for c in list_budget_categories(self.session)}
        self.assertEqual(names, {"Food", "Other"})

    def test_deleted_envelope_is_not_recreated(self):
        other = next(c for c in list_budget_categories(self.session) if c["name"] == "Other")
        delete_budget_category(self.session, int(other["id"]))
        out = get_month_overview(self.session, 2026, 3)
        self.assertEqual([r["category_name"] for r in out["rows"]], ["Food"])

    def test_rename_keeps_mapping(self):
        food = self._food()
        update_budget_category(self.session, food, name="Groceries & Dining")
        bc = self.session.get(BudgetCategory, food)
        self.assertEqual(bc.txn_category_id, self.food_id)

    def test_duplicate_mapping_rejected(self):
        with self.assertRaises(ValueError):
            create_budget_category(self.session, name="Food 2", txn_category_id=self.food_id)

    def test_subcategory_envelope_takes_precedence(self):
        create_budget_category(
            self.session, name="Dining out", txn_category_id=self.food_id, txn_subcategory_id=self.dining_id
        )
        self._txn(date(2026, 3, 3), -30.0, self.checking_id, self.food_id, self.dining_id)
        self._txn(date(2026, 3, 4), -20.0, self.checking_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Dining out")["activity"], -30.0)
        self.assertAlmostEqual(self._row(out, "Food")["activity"], -20.0)
        self.assertIdentity(out)

    # --- Ready to Assign ---------------------------------------------------------------------

    def test_assigning_moves_money_out_of_rta(self):
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["ready_to_assign"], 1000.0)
        out = assign_amount(self.session, 2026, 3, self._food(), 300.0)
        self.assertAlmostEqual(out["ready_to_assign"], 700.0)
        self.assertAlmostEqual(self._row(out, "Food")["available"], 300.0)
        self.assertIdentity(out)

    def test_income_raises_rta(self):
        self._txn(date(2026, 3, 1), 500.0, self.checking_id, self.income_id, self.paycheck_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["ready_to_assign"], 1500.0)
        self.assertAlmostEqual(out["totals"]["income"], 500.0)

    def test_overspending_does_not_double_count(self):
        food = self._food()
        assign_amount(self.session, 2026, 3, food, 100.0)
        self._txn(date(2026, 3, 10), -150.0, self.checking_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Food")["available"], -50.0)
        # RTA only reflects the 100 assigned; the 50 overspend is flagged, not subtracted twice.
        self.assertAlmostEqual(out["ready_to_assign"], 900.0)
        self.assertAlmostEqual(out["totals"]["overspent"], 50.0)
        # Covering it from RTA zeroes the envelope and reduces RTA by exactly the overspend.
        out = move_money(self.session, 2026, 3, from_category_id=None, to_category_id=food, amount=50.0)
        self.assertAlmostEqual(self._row(out, "Food")["available"], 0.0)
        self.assertAlmostEqual(out["ready_to_assign"], 850.0)
        self.assertIdentity(out)

    def test_refunds_return_to_envelope(self):
        food = self._food()
        assign_amount(self.session, 2026, 3, food, 100.0)
        self._txn(date(2026, 3, 10), -80.0, self.checking_id, self.food_id, self.grocery_id)
        self._txn(date(2026, 3, 12), 30.0, self.checking_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Food")["available"], 50.0)
        self.assertAlmostEqual(out["ready_to_assign"], 900.0)
        self.assertIdentity(out)

    def test_card_charge_and_payment_leave_rta_unchanged(self):
        food = self._food()
        assign_amount(self.session, 2026, 3, food, 100.0)
        rta0 = get_month_overview(self.session, 2026, 3)["ready_to_assign"]
        self._txn(date(2026, 3, 5), -40.0, self.visa_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["ready_to_assign"], rta0)
        self.assertAlmostEqual(self._row(out, "Food")["available"], 60.0)
        self._txn(date(2026, 3, 20), -40.0, self.checking_id, is_transfer=True)
        self._txn(date(2026, 3, 20), 40.0, self.visa_id, is_transfer=True)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["ready_to_assign"], rta0)
        self.assertIdentity(out)

    def test_unbudgeted_spending_comes_out_of_rta(self):
        self._txn(date(2026, 3, 5), -25.0, self.checking_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["ready_to_assign"], 975.0)
        self.assertAlmostEqual(out["totals"]["unbudgeted"], -25.0)
        self.assertEqual(out["totals"]["uncategorized_count"], 1)
        self.assertIdentity(out)

    def test_off_budget_accounts_are_ignored(self):
        self._txn(date(2026, 3, 5), -500.0, self.brokerage_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Food")["activity"], 0.0)
        self.assertAlmostEqual(out["ready_to_assign"], 1000.0)

    def test_over_assigning_is_allowed_and_shows_negative_rta(self):
        out = assign_amount(self.session, 2026, 3, self._food(), 1200.0)
        self.assertAlmostEqual(out["ready_to_assign"], -200.0)

    def test_future_assignment_reduces_rta_everywhere(self):
        assign_amount(self.session, 2026, 4, self._food(), 100.0)
        self.assertAlmostEqual(get_month_overview(self.session, 2026, 3)["ready_to_assign"], 900.0)
        self.assertAlmostEqual(get_month_overview(self.session, 2026, 4)["ready_to_assign"], 900.0)

    # --- rollover ----------------------------------------------------------------------------

    def test_strict_carries_overspending_in_category(self):
        food = self._food()
        assign_amount(self.session, 2026, 3, food, 100.0)
        self._txn(date(2026, 3, 10), -150.0, self.checking_id, self.food_id, self.grocery_id)
        with mock.patch("services.zbb_service._today", return_value=date(2026, 4, 2)):
            april = get_month_overview(self.session, 2026, 4)
        self.assertAlmostEqual(self._row(april, "Food")["rollover"], -50.0)
        self.assertAlmostEqual(april["ready_to_assign"], 900.0)

    def test_flexible_resets_category_and_takes_from_next_month_rta(self):
        set_rollover_mode(self.session, "flexible")
        food = self._food()
        assign_amount(self.session, 2026, 3, food, 100.0)
        self._txn(date(2026, 3, 10), -150.0, self.checking_id, self.food_id, self.grocery_id)
        self.assertAlmostEqual(get_month_overview(self.session, 2026, 3)["ready_to_assign"], 900.0)
        with mock.patch("services.zbb_service._today", return_value=date(2026, 4, 2)):
            april = get_month_overview(self.session, 2026, 4)
            self.assertAlmostEqual(self._row(april, "Food")["rollover"], 0.0)
            self.assertAlmostEqual(april["totals"]["reset_overspending"], 50.0)
            self.assertAlmostEqual(april["ready_to_assign"], 850.0)
            self.assertIdentity(april)

    def test_positive_balances_roll_forward(self):
        assign_amount(self.session, 2026, 3, self._food(), 80.0)
        april = get_month_overview(self.session, 2026, 4)
        self.assertAlmostEqual(self._row(april, "Food")["rollover"], 80.0)

    def test_budget_start_ignores_earlier_activity(self):
        self._txn(date(2026, 2, 10), -75.0, self.checking_id, self.food_id, self.grocery_id)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Food")["rollover"], 0.0)
        feb = get_month_overview(self.session, 2026, 2)
        self.assertTrue(feb["is_before_budget_start"])
        with self.assertRaises(ValueError):
            assign_amount(self.session, 2026, 2, self._food(), 10.0)

    def test_moving_start_month_earlier_includes_history(self):
        self._txn(date(2026, 2, 10), -75.0, self.checking_id, self.food_id, self.grocery_id)
        set_budget_start_month(self.session, 2026, 2)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(self._row(out, "Food")["rollover"], -75.0)

    # --- bulk actions ------------------------------------------------------------------------

    def test_move_money_between_envelopes(self):
        food = self._food()
        other = int(self._row(get_month_overview(self.session, 2026, 3), "Other")["category_id"])
        assign_amount(self.session, 2026, 3, food, 300.0)
        out = move_money(self.session, 2026, 3, from_category_id=food, to_category_id=other, amount=50.0)
        self.assertAlmostEqual(self._row(out, "Food")["assigned"], 250.0)
        self.assertAlmostEqual(self._row(out, "Other")["assigned"], 50.0)
        self.assertAlmostEqual(out["ready_to_assign"], 700.0)

    def test_fund_targets_stops_when_rta_runs_out(self):
        food = self._food()
        other = int(self._row(get_month_overview(self.session, 2026, 3), "Other")["category_id"])
        update_budget_category(self.session, food, monthly_target=600.0)
        update_budget_category(self.session, other, monthly_target=600.0)
        out = get_month_overview(self.session, 2026, 3)
        self.assertAlmostEqual(out["totals"]["underfunded"], 1200.0)
        out = quick_assign(self.session, 2026, 3, strategy="targets")
        self.assertAlmostEqual(self._row(out, "Food")["assigned"], 600.0)
        self.assertAlmostEqual(self._row(out, "Other")["assigned"], 400.0)
        self.assertAlmostEqual(out["ready_to_assign"], 0.0)

    def test_copy_last_month(self):
        assign_amount(self.session, 2026, 3, self._food(), 120.0)
        out = quick_assign(self.session, 2026, 4, strategy="last_month")
        self.assertAlmostEqual(self._row(out, "Food")["assigned"], 120.0)

    def test_average_spending_uses_prior_three_months(self):
        set_budget_start_month(self.session, 2026, 1)
        food = self._food()
        for m, spent in ((1, 90.0), (2, 30.0)):
            self._txn(date(2026, m, 10), -spent, self.checking_id, self.food_id, self.grocery_id)
        out = quick_assign(self.session, 2026, 3, strategy="avg_spent", category_ids=[food])
        # (90 + 30 + 0) / 3; envelopes outside category_ids are left alone.
        self.assertAlmostEqual(self._row(out, "Food")["assigned"], 40.0)
        self.assertAlmostEqual(self._row(out, "Other")["assigned"], 0.0)
        self.assertIdentity(out)

    def test_clear_returns_assigned_to_rta(self):
        assign_amount(self.session, 2026, 3, self._food(), 300.0)
        out = quick_assign(self.session, 2026, 3, strategy="clear")
        self.assertAlmostEqual(out["totals"]["assigned"], 0.0)
        self.assertAlmostEqual(out["ready_to_assign"], 1000.0)


if __name__ == "__main__":
    unittest.main()
