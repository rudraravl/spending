# Development

## Architecture

```
frontend/          React + Vite + TypeScript UI (TanStack Query, shadcn/ui, Tailwind)
   ↓ HTTP (JSON)
backend/           FastAPI app
   main.py           app setup, CORS, cross-site write guard
   app/routers/      one router per area (transactions, budgets, simplefin, ...)
   app/schemas.py    Pydantic request/response models
   app/startup.py    DB init, daily backups, SimpleFIN seeding
   scripts/          CLI entry points (scheduled SimpleFIN sync)
   ↓
services/          business logic, framework-agnostic (no FastAPI imports)
adapters/          CSV parsers, one per bank export format (no DB access)
utils/             filters, date ranges, timestamp helpers
db/                SQLAlchemy models, engine, and in-place migrations
   ↓
data/budget.db     SQLite (gitignored)
```

Keep the layering: routers translate HTTP to service calls, services hold the logic, and adapters only parse files. The UI never talks to the database directly.

## Running tests and checks

```bash
source .venv/bin/activate
python -m pytest                      # backend tests (in-memory SQLite)

cd frontend
npx tsc -b                            # typecheck
npm run lint                          # eslint
npm run build                         # production build
```

## Database and migrations

Models live in `db/models.py`. There's no migration framework. `init_db()` in `db/database.py` runs `create_all()` and then a series of small, idempotent `_migrate_*` functions that alter existing SQLite databases in place. When you change the schema:

1. Update the model in `db/models.py`.
2. If existing databases need a column, index, or backfill, add an idempotent `_migrate_*` function and call it from `init_db()`. It should check `PRAGMA table_info` or `index_list` before altering anything.
3. Add a test that runs the migration against an old-shaped in-memory database. See `tests/test_tag_recency.py::TestTagMigration` for an example.

## Amounts

All stored amounts follow one sign convention: positive means money in, negative means money out. Adapters must normalize to it. See [docs/AMOUNT_CONVENTION.md](docs/AMOUNT_CONVENTION.md).

## Adding a CSV adapter

Most bank exports only need column names and a date format, so subclass `GenericAdapter`:

```python
# adapters/amex_adapter.py
from adapters.generic_adapter import GenericAdapter


class AmexAdapter(GenericAdapter):
    """American Express CSV export."""

    def __init__(self):
        super().__init__(
            date_col='Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%Y',
        )
```

Then register it in `ADAPTERS` in `services/import_service.py`:

```python
ADAPTERS = {
    ...
    'Amex': AmexAdapter,
}
```

It shows up in the **Import CSV** adapter list right away. Check the sign of the amounts: `GenericAdapter` negates amounts by default (`invert_amounts_for_cash_flow=True`) because most card exports list charges as positive numbers. Pass `False` if the export already shows charges as negative. For formats that don't fit the generic mapper, implement `BaseAdapter.parse()` directly and return a DataFrame with `date`, `amount`, and `merchant` columns.

## SimpleFIN

- `services/simplefin_client.py` is the protocol client: token claiming, `/accounts` requests, and the local daily request budget.
- `services/simplefin_sync_service.py` handles connections, account linking, and importing transactions and balances.
- `services/encryption.py` encrypts the stored Access URL (Fernet).
- `backend/scripts/simplefin_sync_once.py` is the cron entry point.

Tests mock the network layer, so you don't need a SimpleFIN account to work on sync code.

## Frontend conventions

- API wrappers live in `frontend/src/api/` and use the helpers in `api/client.ts`.
- Query keys are centralized in `frontend/src/queryKeys.ts`. After a mutation that touches transactions, call `invalidateTransactionData()`.
- `components/ui/` holds shadcn/ui primitives. Add new ones with the shadcn CLI as needed rather than vendoring the whole set.
- Brand colors and theme tokens are described in [docs/BRAND_COLORS.md](docs/BRAND_COLORS.md).

## Troubleshooting

- **`ModuleNotFoundError: No module named 'services'`**: run the backend from the repo root (`npm run dev:backend`).
- **`database is locked`**: another process has the SQLite file open, often a second backend or a DB browser holding a write transaction.
