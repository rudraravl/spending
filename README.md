# Personal Budget App

Local spending tracker backed by SQLite: import credit card CSVs, categorize transactions, and view summaries through the React UI and FastAPI backend.

## New user setup

**You have:** Python 3.11+  
**For the web UI:** [Node.js LTS](https://nodejs.org/) (includes `npm`).

### Python environment

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
mkdir -p data
```

Or run `./setup.sh` to create the venv, install packages, and initialize the database.

### Web app (React + FastAPI)

**1. Install frontend deps once**

```bash
npm --prefix frontend install
```

**2. Run API and UI** (venv active for the API; commands from repo root)

| Role | Command |
|------|---------|
| API | `uvicorn backend.main:app --reload --port 8000` |
| UI | `VITE_API_BASE_URL=http://localhost:8000 npm --prefix frontend run dev` |

Shortcuts: `npm run dev:backend` and `npm run dev:frontend` (same as above).

Set `VITE_API_BASE_URL` for the session if you prefer:

```bash
export VITE_API_BASE_URL=http://localhost:8000
npm --prefix frontend run dev
```

**Backend:** Uses `data/budget.db`. Run `uvicorn` from the repo root so imports resolve (`db/`, `services/`, `adapters/`, etc.). On startup the API runs `init_db()` and a best-effort daily DB backup. CORS is open for local dev (`allow_origins=["*"]`).

### OPTIONAL for Mac - set up app on Automator
Open Automator, create new application in desired location, do "Run Applescript" and paste:

```bash
tell application "Terminal"
	activate
	
	-- Backend tab
	do script "cd *PATH/TO/REPO*; source .venv/bin/activate; npm run dev:backend"
	
	-- New tab for frontend
	tell application "System Events" to keystroke "t" using command down
	delay 0.5
	
	do script "cd *PATH/TO/REPO*; npm run dev:frontend" in front window
end tell

-- Wait for frontend server to start
delay 2

-- Open browser to app
do shell script "open http://localhost:5173"
```

## SimpleFIN auto-sync (bank account linking)

The app supports automatic bank account syncing via the [SimpleFIN Protocol](https://www.simplefin.org/protocol.html).

**Quick start:** Add your SimpleFIN Access URL to `.env`:

```
SIMPLEFIN_ACCESS_URL_PROD="https://user:pass@beta-bridge.simplefin.org/simplefin"
```

On first startup the app seeds a connection automatically. A single SimpleFIN Access URL/connection can include multiple bank accounts; you do not add one URL per account. Open **Account Sync Setup** to discover the accounts available under that connection, then link the accounts you want to track locally.

If you call the sync API with a custom `end_date`, it follows SimpleFIN protocol semantics: `end-date` is exclusive (transactions are returned before, but not on, that date).

To stay within common Bridge quotas, the app also enforces a local daily SimpleFIN request budget per connection (`SIMPLEFIN_MAX_REQUESTS_PER_DAY`, default `20`).

**Daily auto-sync** via cron (venv must be active):

```bash
# Example crontab entry – sync at 6 AM daily
0 6 * * * cd /path/to/spending && .venv/bin/python -m backend.scripts.simplefin_sync_once --lookback-days 7
```

Or run manually:

```bash
python -m backend.scripts.simplefin_sync_once
```

## Features

- Import credit card CSVs (adapters + generic mapping)
- Automatic bank account syncing via SimpleFIN
- Add/edit transactions; categories, subcategories, tags
- Filters and summaries (month/year/semester/custom ranges)

## SimpleFIN setup guide

Use this guide if you are setting up bank syncing from scratch.

1. Create a SimpleFIN token from your institution (or Bridge) `/create` page.
2. In the app, open **Connections** and paste the token in **Add a new connection**.
3. Go to **Account Sync Setup**, select your connection, and review discovered accounts (auto-loads on page).
4. Link the discovered accounts you want to track to local account names/types.
5. Click **Sync now** to import balances and transactions for linked accounts.

Notes:

- The app only stores the claimed Access URL in encrypted form; the token is one-time use.
- Treat the Access URL as the root connection. Your account list should come from discovered/linked accounts under that connection, not from multiple per-account Access URLs.
- `end_date` sync filtering is exclusive (`before, not on`) per protocol.
- Daily request budget is visible in the UI and enforced locally to reduce risk of hitting provider limits.
- For automatic refresh, run the daily script:

```bash
python -m backend.scripts.simplefin_sync_once --lookback-days 7
```
