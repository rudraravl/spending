from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.bootstrap import ensure_repo_root_on_path
from backend.app.startup import backup_db_once_per_day, init_database
from backend.app.routers.entities import router as entities_router
from backend.app.routers.transactions import router as transactions_router
from backend.app.routers.splits import router as splits_router
from backend.app.routers.import_csv import router as import_csv_router
from backend.app.routers.rules import router as rules_router
from backend.app.routers.reports import router as reports_router
from backend.app.routers.recurring import router as recurring_router
from backend.app.routers.budgets import router as budgets_router
from backend.app.routers.simplefin import router as simplefin_router


ensure_repo_root_on_path()


@asynccontextmanager
async def lifespan(app: FastAPI):
    backup_db_once_per_day()
    init_database()
    yield


app = FastAPI(title="Spending API", version="0.1", lifespan=lifespan)

app.include_router(entities_router)
app.include_router(transactions_router)
app.include_router(splits_router)
app.include_router(import_csv_router)
app.include_router(rules_router)
app.include_router(reports_router)
app.include_router(recurring_router)
app.include_router(budgets_router)
app.include_router(simplefin_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local-only v1; we can tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true"}

