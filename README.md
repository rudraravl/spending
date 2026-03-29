# Keep

Local spending tracker backed by SQLite: import credit card CSVs, categorize transactions, and view summaries through the React UI and FastAPI backend.

## New user setup

### What you need

- **Python 3.x** (for the API and scripts)
- **Node.js (LTS) and npm** (for the React UI—you cannot run the frontend with Python alone)
- **git**

### Install

From the repo root:

1. Create and activate a virtual environment, then install Python dependencies:

   ```bash
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Install frontend dependencies:

   ```bash
   npm --prefix frontend install
   ```

### Run

Start **two** terminals from the repo root (venv active in the one that runs the backend):

- **Backend:** `npm run dev:backend` → [http://localhost:8000](http://localhost:8000)
- **Frontend:** `npm run dev:frontend` → [http://localhost:5173](http://localhost:5173)

Open the UI in the browser. The frontend expects the API at `http://localhost:8000` by default; override with `VITE_API_BASE_URL` if you change the port.

### First launch

When the backend starts, it creates `data/budget.db` and seeds default **categories** and **subcategories** (for example Food, Travel, Income, and Other → Uncategorized for imports). **Tags** and **rules** start empty.

### Accounts

In the sidebar, open **Accounts** and use **New account** for each wallet or card you want to track. The **type** (e.g. credit card vs checking) changes how the account detail page behaves. **Import CSV** and **Add transaction** both require at least one account.

For **SimpleFIN** bank sync, create these **local** accounts first, then map each bank account to a local one on **Connections** (under **Bank Sync**). Sync only updates accounts that are already linked—it does not create local accounts for you.

### Categories, subcategories, tags, and rules

Use **Settings** to customize **categories** and **subcategories** (each subcategory belongs to one category). **Tags** are optional extra labels. **Rules** auto-assign category and subcategory when transactions are imported or synced, based on fields such as merchant text.

### Get transactions

- **Import CSV:** pick the account, then a bank **adapter** or generic column mapping.
- **Bank sync:** set `SIMPLEFIN_ACCESS_URL_PROD` in `.env` if you want a connection seeded on startup, or add a connection from the UI. Open **Connections** (**SimpleFIN Connections**), claim a token, link each remote account to a local account, then **Sync now**. Step-by-step: [SimpleFIN setup guide](#simplefin-setup-guide).

### Amounts

Stored amounts use one sign convention (positive = money in, negative = out). How that affects the dashboard and transfers is documented in [docs/AMOUNT_CONVENTION.md](docs/AMOUNT_CONVENTION.md).

### OPTIONAL for Mac — Automator launcher

Open Automator, create a new Application where you like, add **Run AppleScript**, and paste:

```applescript
tell application "Terminal"
	activate

	-- Backend tab
	do script "cd *PATH/TO/REPO*; source .venv/bin/activate; npm run dev:backend"

	-- New tab for frontend
	tell application "System Events" to keystroke "t" using command down
	delay 0.5

	do script "cd *PATH/TO/REPO*; npm run dev:frontend" in front window
end tell

-- Wait for the frontend server to start
delay 2

-- Open the app in the browser
do shell script "open http://localhost:5173"
```

Replace `*PATH/TO/REPO*` with your clone path.

## SimpleFIN auto-sync (bank account linking)

The app supports automatic bank account syncing via the [SimpleFIN Protocol](https://www.simplefin.org/protocol.html).

**Quick start:** Add your SimpleFIN Access URL to `.env`:

```
SIMPLEFIN_ACCESS_URL_PROD="https://user:pass@beta-bridge.simplefin.org/simplefin"
```

On first startup the app seeds a connection automatically. A single SimpleFIN Access URL/connection can include multiple bank accounts; you do not add one URL per account. Open **Connections** (**SimpleFIN Connections** in the Bank Sync section) to see discovered accounts for that connection, then link each one to a **local** account you created on the **Accounts** page.

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
2. In the app, open **Connections** and paste the token in **Add a root connection** (**Claim & Connect**).
3. On **Connections**, your connection appears with **Available remote accounts (cached)**. Use **Refresh cached accounts** or **Sync now** if the list is empty.
4. For each remote account, choose a **local** account (create more on **Accounts** if needed) and click **Link**.
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
