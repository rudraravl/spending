import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Account, Base, BudgetSetting, BudgetCategory, BudgetPeriod, Category, CategoryBudget, Subcategory, Transaction
from services.zbb_service import assign_amount, get_month_overview, move_money, set_budget_start_month, set_rollover_mode


class TestZbbService(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.Session = sessionmaker(bind=engine)
        self.session = self.Session()

        food = Category(name="Food")
        other = Category(name="Other")
        self.session.add_all([food, other])
        self.session.flush()
        self.food_id = int(food.id)
        self.other_id = int(other.id)
        grocery = Subcategory(name="Grocery", category_id=food.id)
        unc = Subcategory(name="Uncategorized", category_id=other.id)
        self.session.add_all(
            [
                grocery,
                unc,
            ]
        )
        self.session.flush()
        self.food_subcategory_id = int(grocery.id)
        self.session.add(Account(name="Checking", type="checking", is_budget_account=True, reported_balance=1000.0))
        self.session.add(BudgetSetting(id=1, rollover_mode="strict"))
        self.session.commit()

    def tearDown(self):
        self.session.close()

    def test_rta_equation_holds(self):
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        total_available = sum(float(r["available"]) for r in out["rows"])
        lhs = float(out["liquid_pool"])
        rhs = total_available + float(out["ready_to_assign"])
        self.assertAlmostEqual(lhs, rhs, places=6)

    def test_move_money_conserves_total_assigned(self):
        out0 = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        row_food = next(r for r in out0["rows"] if str(r["category_name"]) == "Food")
        row_other = next(r for r in out0["rows"] if str(r["category_name"]) == "Other")

        # Directly seed assigned values for this test.
        period = self.session.query(BudgetPeriod).filter(BudgetPeriod.year == 2026, BudgetPeriod.month == 3).first()
        food_budget_category = self.session.query(BudgetCategory).filter(BudgetCategory.name == "Food").first()
        other_budget_category = self.session.query(BudgetCategory).filter(BudgetCategory.name == "Other").first()
        food_row = (
            self.session.query(CategoryBudget)
            .filter(CategoryBudget.budget_period_id == period.id, CategoryBudget.budget_category_id == food_budget_category.id)
            .first()
        )
        other_row = (
            self.session.query(CategoryBudget)
            .filter(CategoryBudget.budget_period_id == period.id, CategoryBudget.budget_category_id == other_budget_category.id)
            .first()
        )
        food_row.assigned = 300.0
        other_row.assigned = 200.0
        self.session.commit()

        out1 = move_money(
            self.session,
            2026,
            3,
            from_category_id=int(row_food["category_id"]),
            to_category_id=int(row_other["category_id"]),
            amount=50.0,
        )
        self.session.commit()
        food_after = next(r for r in out1["rows"] if str(r["category_name"]) == "Food")
        other_after = next(r for r in out1["rows"] if str(r["category_name"]) == "Other")
        self.assertAlmostEqual(float(food_after["assigned"]), 250.0, places=6)
        self.assertAlmostEqual(float(other_after["assigned"]), 250.0, places=6)

    def test_flexible_rollover_clamps_negative_category(self):
        # March overspend in Food
        self.session.add(
            Transaction(
                date=date(2026, 3, 10),
                amount=-120.0,
                merchant="Store",
                account_id=1,
                category_id=self.food_id,
                subcategory_id=self.food_subcategory_id,
            )
        )
        self.session.commit()

        set_rollover_mode(self.session, "flexible")
        march = get_month_overview(self.session, 2026, 3)
        april = get_month_overview(self.session, 2026, 4)
        self.session.commit()

        march_food = next(r for r in march["rows"] if str(r["category_name"]) == "Food")
        april_food = next(r for r in april["rows"] if str(r["category_name"]) == "Food")
        self.assertLess(float(march_food["available"]), 0.0)
        self.assertGreaterEqual(float(april_food["rollover"]), 0.0)

    def test_credit_card_payment_row_is_created_and_visible(self):
        self.session.add(Account(name="Visa", type="credit", is_budget_account=False))
        self.session.commit()
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        payment_rows = [r for r in out["rows"] if str(r.get("system_kind") or "") == "cc_payment"]
        self.assertGreaterEqual(len(payment_rows), 1)

    def test_liquid_pool_is_net_of_credit_balances(self):
        self.session.add(Account(name="Visa", type="credit", is_budget_account=False, reported_balance=-500.0))
        self.session.commit()
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        self.assertAlmostEqual(float(out["liquid_pool"]), 500.0, places=6)

    def test_cc_payment_activity_ignores_charges_counts_transfers_only(self):
        visa = Account(name="Visa", type="credit", is_budget_account=False)
        self.session.add(visa)
        self.session.commit()
        vid = int(visa.id)
        self.session.add(
            Transaction(
                date=date(2026, 3, 5),
                amount=-50.0,
                merchant="Grocery",
                account_id=vid,
                category_id=self.food_id,
                subcategory_id=self.food_subcategory_id,
                is_transfer=False,
            )
        )
        other_sub = self.session.query(Subcategory).filter(Subcategory.category_id == self.other_id).first()
        self.assertIsNotNone(other_sub)
        self.session.add(
            Transaction(
                date=date(2026, 3, 20),
                amount=50.0,
                merchant="Payment",
                account_id=vid,
                category_id=self.other_id,
                subcategory_id=int(other_sub.id),
                is_transfer=True,
            )
        )
        self.session.commit()
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        cc_row = next(r for r in out["rows"] if str(r.get("system_kind") or "") == "cc_payment")
        food_row = next(r for r in out["rows"] if str(r["category_name"]) == "Food")
        self.assertAlmostEqual(float(cc_row["activity"]), 50.0, places=6)
        self.assertAlmostEqual(float(food_row["activity"]), 50.0, places=6)
        self.assertAlmostEqual(float(cc_row["available"]), 0.0, places=6)

    def test_cc_available_includes_system_shift_assigned_unchanged(self):
        """$50 Food plan + $5 on card: Food Assigned stays 50; CC Available gains the $5 reserve."""
        visa = Account(name="Visa", type="credit", is_budget_account=False)
        self.session.add(visa)
        self.session.commit()
        vid = int(visa.id)
        get_month_overview(self.session, 2026, 3)
        self.session.commit()
        food_row = next(r for r in get_month_overview(self.session, 2026, 3)["rows"] if str(r["category_name"]) == "Food")
        assign_amount(self.session, 2026, 3, int(food_row["category_id"]), 50.0)
        self.session.commit()
        self.session.add(
            Transaction(
                date=date(2026, 3, 10),
                amount=-5.0,
                merchant="Snack",
                account_id=vid,
                category_id=self.food_id,
                subcategory_id=self.food_subcategory_id,
                is_transfer=False,
            )
        )
        self.session.commit()
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        food = next(r for r in out["rows"] if str(r["category_name"]) == "Food")
        cc = next(r for r in out["rows"] if str(r.get("system_kind") or "") == "cc_payment")
        self.assertAlmostEqual(float(food["assigned"]), 50.0, places=6)
        self.assertAlmostEqual(float(food["activity"]), 5.0, places=6)
        self.assertAlmostEqual(float(food["available"]), 45.0, places=6)
        self.assertAlmostEqual(float(cc["assigned"]), 0.0, places=6)
        self.assertAlmostEqual(float(cc["activity"]), 0.0, places=6)
        self.assertAlmostEqual(float(cc["available"]), 5.0, places=6)

    def test_assign_amount_rejects_when_rta_would_go_negative(self):
        out = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        food_row = next(r for r in out["rows"] if str(r["category_name"]) == "Food")
        cap = float(out["liquid_pool"]) + float(food_row["assigned"])
        with self.assertRaises(ValueError):
            assign_amount(self.session, 2026, 3, int(food_row["category_id"]), cap + 100.0)
        self.session.rollback()

    def test_rollover_includes_full_prior_month_not_only_prior_start(self):
        """Assigned in February must carry into March rollover (not only January→February start)."""
        feb = self.session.query(BudgetPeriod).filter(BudgetPeriod.year == 2026, BudgetPeriod.month == 2).first()
        if feb is None:
            get_month_overview(self.session, 2026, 2)
            self.session.commit()
            feb = self.session.query(BudgetPeriod).filter(BudgetPeriod.year == 2026, BudgetPeriod.month == 2).first()
        food_bc = self.session.query(BudgetCategory).filter(BudgetCategory.name == "Food").first()
        self.assertIsNotNone(food_bc)
        feb_row = (
            self.session.query(CategoryBudget)
            .filter(CategoryBudget.budget_period_id == feb.id, CategoryBudget.budget_category_id == food_bc.id)
            .first()
        )
        feb_row.assigned = 80.0
        self.session.commit()

        march = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        march_food = next(r for r in march["rows"] if str(r["category_name"]) == "Food")
        self.assertAlmostEqual(float(march_food["rollover"]), 80.0, places=6)

    def test_budget_start_cuts_ghost_rollover_from_pre_budget_months(self):
        """Spending in months before the genesis month must not roll into the first budget month."""
        other_sub = self.session.query(Subcategory).filter(Subcategory.category_id == self.other_id).first()
        self.assertIsNotNone(other_sub)
        self.session.add(
            Transaction(
                date=date(2026, 2, 10),
                amount=-75.0,
                merchant="Utility",
                account_id=1,
                category_id=self.other_id,
                subcategory_id=int(other_sub.id),
            )
        )
        self.session.commit()
        get_month_overview(self.session, 2026, 2)
        self.session.commit()

        march = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        other_row = next(r for r in march["rows"] if str(r["category_name"]) == "Other")
        self.assertLess(float(other_row["rollover"]), 0.0)

        set_budget_start_month(self.session, 2026, 3)
        march2 = get_month_overview(self.session, 2026, 3)
        self.session.commit()
        other_after = next(r for r in march2["rows"] if str(r["category_name"]) == "Other")
        self.assertAlmostEqual(float(other_after["rollover"]), 0.0, places=6)
        self.assertFalse(bool(march2.get("is_before_budget_start")))

    def test_months_before_budget_start_show_zero_envelopes(self):
        set_budget_start_month(self.session, 2026, 3)
        feb = get_month_overview(self.session, 2026, 2)
        self.session.commit()
        self.assertTrue(bool(feb.get("is_before_budget_start")))
        for r in feb["rows"]:
            self.assertAlmostEqual(float(r["available"]), 0.0, places=6)


if __name__ == "__main__":
    unittest.main()
