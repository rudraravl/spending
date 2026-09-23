from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.bootstrap import ensure_repo_root_on_path

# Must run before importing routers: they import the top-level `db`/`services`
# packages, and `.env` must be loaded before anything reads the environment.
ensure_repo_root_on_path()

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
from backend.app.routers.investments import router as investments_router
from backend.app.routers.backups import router as backups_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    backup_db_once_per_day()
    init_database()
    yield


app = FastAPI(title="Keep API", version="0.1", lifespan=lifespan)

app.include_router(entities_router)
app.include_router(transactions_router)
app.include_router(splits_router)
app.include_router(import_csv_router)
app.include_router(rules_router)
app.include_router(reports_router)
app.include_router(recurring_router)
app.include_router(budgets_router)
app.include_router(simplefin_router)
app.include_router(investments_router)
app.include_router(backups_router)

# The API serves personal financial data with no auth, so only local dev origins may
# read responses; a wildcard would let any website the user visits query it.
# Override with a comma-separated CORS_ALLOW_ORIGINS if the UI is served elsewhere.
_extra_origins = [o.strip() for o in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
_LOCAL_ORIGIN_RE = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _origin_allowed(origin: str) -> bool:
    return origin in _extra_origins or re.fullmatch(_LOCAL_ORIGIN_RE, origin) is not None


@app.middleware("http")
async def reject_cross_site_writes(request: Request, call_next):
    """
    CORS only stops other sites from reading responses; a cross-site form post
    (e.g. a multipart CSV import) is still sent and acted on. Browsers always send
    Origin on cross-site writes, so refuse any write from an origin we don't serve.
    Non-browser clients (scripts, curl) send no Origin and are unaffected.
    """
    origin = request.headers.get("origin")
    if request.method not in _SAFE_METHODS and origin is not None and not _origin_allowed(origin):
        return JSONResponse(status_code=403, content={"detail": "Cross-site request refused"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_extra_origins,
    allow_origin_regex=_LOCAL_ORIGIN_RE,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true"}

