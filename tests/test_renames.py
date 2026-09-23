"""Renaming categories, subcategories and tags keeps every association (links are by id)."""

import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import db.database  # noqa: F401  (registers the foreign-key PRAGMA listener)
from db.models import (
    Account,
    Base,
    BudgetCategory,
    Category,
    Rule,
    Subcategory,
    Tag,
    Transaction,
    TransactionSplit,
)
from services.category_service import rename_category, rename_subcategory, rename_tag


class RenameTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.s = sessionmaker(bind=engine, autoflush=False)()
        self.other = Category(name="Other")
        self.income = Category(name="Income")
        self.food = Category(name="Food")
        self.travel = Category(name="Travel")
        self.s.add_all([self.other, self.income, self.food, self.travel])
        self.s.flush()
        self.unc = Subcategory(name="Uncategorized", category_id=self.other.id)
        self.groceries = Subcategory(name="Groceries", category_id=self.food.id)
        self.dining = Subcategory(name="Dining", category_id=self.food.id)
        self.s.add_all([self.unc, self.groceries, self.dining])
        self.trip = Tag(name="Trip")
        self.work = Tag(name="Work")
        bank = Account(name="Bank", type="checking")
        self.s.add_all([self.trip, self.work, bank])
        self.s.flush()
        self.txn = Transaction(
            date=date(2026, 1, 5),
            amount=-12.0,
            merchant="HEB",
            account_id=bank.id,
            category_id=self.food.id,
            subcategory_id=self.groceries.id,
        )
        self.txn.tags.append(self.trip)
        self.s.add(self.txn)
        self.s.flush()
        self.s.add_all(
            [
                TransactionSplit(
                    transaction_id=self.txn.id,
                    category_id=self.food.id,
                    subcategory_id=self.groceries.id,
                    amount=-12.0,
                ),
                Rule(
                    priority=1,
                    field="merchant",
                    operator="contains",
                    value="heb",
                    category_id=self.food.id,
                    subcategory_id=self.groceries.id,
                ),
                BudgetCategory(name="Food", txn_category_id=self.food.id),
            ]
        )
        self.s.commit()

    def tearDown(self):
        self.s.close()

    def test_category_rename_keeps_links_and_renames_auto_envelope(self):
        rename_category(self.s, self.food, "  Groceries & Dining ")
        self.s.commit()
        self.s.expire_all()
        txn = self.s.get(Transaction, self.txn.id)
        self.assertEqual(txn.category.name, "Groceries & Dining")
        self.assertEqual(txn.subcategory_id, self.groceries.id)
        self.assertEqual(self.s.query(TransactionSplit).one().category_id, self.food.id)
        self.assertEqual(self.s.query(Rule).one().category_id, self.food.id)
        self.assertEqual(self.s.query(BudgetCategory).one().name, "Groceries & Dining")

    def test_category_rename_leaves_hand_renamed_envelope(self):
        env = self.s.query(BudgetCategory).one()
        env.name = "Eating"
        self.s.commit()
        rename_category(self.s, self.food, "Meals")
        self.s.commit()
        self.assertEqual(self.s.query(BudgetCategory).one().name, "Eating")

    def test_category_rename_rejects_duplicates_and_protected(self):
        with self.assertRaises(ValueError):
            rename_category(self.s, self.food, "travel")  # case-insensitive clash
        with self.assertRaises(ValueError):
            rename_category(self.s, self.income, "Salary")  # looked up by name elsewhere
        with self.assertRaises(ValueError):
            rename_category(self.s, self.food, "Other")  # would shadow the required category
        with self.assertRaises(ValueError):
            rename_category(self.s, self.food, "   ")

    def test_category_case_only_rename_allowed(self):
        rename_category(self.s, self.food, "FOOD")
        self.s.commit()
        self.assertEqual(self.s.get(Category, self.food.id).name, "FOOD")

    def test_subcategory_rename_keeps_links(self):
        rename_subcategory(self.s, self.groceries, "Supermarket")
        self.s.commit()
        self.s.expire_all()
        self.assertEqual(self.s.get(Transaction, self.txn.id).subcategory.name, "Supermarket")
        self.assertEqual(self.s.query(Rule).one().subcategory_id, self.groceries.id)

    def test_subcategory_rename_rejects_sibling_clash_and_protected(self):
        with self.assertRaises(ValueError):
            rename_subcategory(self.s, self.groceries, "dining")
        with self.assertRaises(ValueError):
            rename_subcategory(self.s, self.unc, "Misc")

    def test_tag_rename_keeps_links(self):
        rename_tag(self.s, self.trip, "Vacation")
        self.s.commit()
        self.s.expire_all()
        self.assertEqual([t.name for t in self.s.get(Transaction, self.txn.id).tags], ["Vacation"])
        with self.assertRaises(ValueError):
            rename_tag(self.s, self.trip, "work")


if __name__ == "__main__":
    unittest.main()
