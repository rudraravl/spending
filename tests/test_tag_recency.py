"""Tags record when they were last added to a transaction (drives recency ordering in pickers)."""

import unittest
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from db.database import _migrate_tags_columns
from db.models import Account, Base, Category, Subcategory, Tag, Transaction
from services.transaction_service import assign_tags, create_transaction, update_transaction

LONG_AGO = datetime(2020, 1, 1)


class TestTagRecency(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.engine = engine
        self.s = sessionmaker(bind=engine)()
        cat = Category(name="Food")
        self.s.add(cat)
        self.s.flush()
        sub = Subcategory(name="Grocery", category_id=cat.id)
        acct = Account(name="Bank", type="checking")
        self.trip = Tag(name="Trip", last_used_at=LONG_AGO)
        self.work = Tag(name="Work", last_used_at=LONG_AGO)
        self.s.add_all([sub, acct, self.trip, self.work])
        self.s.commit()
        self.cat_id, self.sub_id, self.acct_id = cat.id, sub.id, acct.id

    def tearDown(self):
        self.s.close()

    def _recent(self, tag):
        self.s.refresh(tag)
        return tag.last_used_at > LONG_AGO + timedelta(days=1)

    def _txn(self, tag_ids=None):
        return create_transaction(self.s, date(2026, 9, 1), -5.0, "Store", self.acct_id,
                                  self.cat_id, self.sub_id, tag_ids=tag_ids)

    def test_creating_a_tagged_transaction_marks_tag_used(self):
        self._txn([self.trip.id])
        self.assertTrue(self._recent(self.trip))
        self.assertFalse(self._recent(self.work))

    def test_adding_a_tag_on_update_marks_only_that_tag(self):
        t = self._txn([self.trip.id])
        self.trip.last_used_at = LONG_AGO
        self.s.commit()
        update_transaction(self.s, t.id, tag_ids=[self.trip.id, self.work.id])
        self.assertTrue(self._recent(self.work))
        # Already on the transaction; re-saving the row isn't a new use.
        self.assertFalse(self._recent(self.trip))

    def test_removing_a_tag_does_not_mark_it_used(self):
        t = self._txn([self.trip.id, self.work.id])
        self.trip.last_used_at = self.work.last_used_at = LONG_AGO
        self.s.commit()
        assign_tags(self.s, t.id, [self.trip.id])
        self.assertFalse(self._recent(self.trip))
        self.assertFalse(self._recent(self.work))

    def test_assign_tags_marks_new_tags_used(self):
        t = self._txn()
        assign_tags(self.s, t.id, [self.work.id])
        self.assertTrue(self._recent(self.work))


class TestTagMigration(unittest.TestCase):
    def test_backfills_from_latest_tagged_transaction(self):
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as c:
            c.execute(text("CREATE TABLE tags (id INTEGER PRIMARY KEY, name VARCHAR, created_at DATETIME)"))
            c.execute(text("CREATE TABLE transactions (id INTEGER PRIMARY KEY, date DATE)"))
            c.execute(text("CREATE TABLE transaction_tags (transaction_id INTEGER, tag_id INTEGER)"))
            c.execute(text("INSERT INTO tags VALUES (1, 'Trip', NULL), (2, 'Unused', NULL)"))
            c.execute(text("INSERT INTO transactions VALUES (1, '2026-01-05'), (2, '2026-03-09')"))
            c.execute(text("INSERT INTO transaction_tags VALUES (1, 1), (2, 1)"))
            _migrate_tags_columns(c)
            _migrate_tags_columns(c)  # idempotent
        s = sessionmaker(bind=engine)()
        rows = dict(s.execute(text("SELECT name, last_used_at FROM tags")).fetchall())
        self.assertEqual(rows["Trip"], "2026-03-09 00:00:00")
        self.assertIsNone(rows["Unused"])
        s.close()


if __name__ == "__main__":
    unittest.main()
