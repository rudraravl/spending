# Keep

A local-first personal finance app. Track spending across cards and bank accounts, budget with envelopes, spot recurring charges, follow investments, and watch net worth over time. Your data lives in a single SQLite file on your machine.

You can use it two ways:

- **Without bank sync:** import CSV exports from your bank or card, or enter transactions by hand. No accounts, keys, or third-party services needed.
- **With [SimpleFIN](https://www.simplefin.org/) bank sync:** connect your institutions once, and balances and transactions sync automatically.

Both work side by side. You can sync some accounts and import CSVs for others.

## Features

- CSV import with built-in adapters (Chase, Capital One, Citi, Discover, Wells Fargo, Bilt) and a generic column mapper for anything else
- Optional automatic bank sync via SimpleFIN
- Categories, subcategories, tags, and rules that auto-categorize imported and synced transactions
- Split transactions and transfer matching between your own accounts
- Envelope-style (zero-based) monthly budget
- Recurring-charge detection
- Investment holdings, cost basis, and performance
- Reports, saved views, and net worth history
- Automatic daily database backups (the last 5 are kept in `data/`)

## Requirements

- Python 3.11+
- Node.js 20+ and npm
- git

## Setup

Use the latest [release](https://github.com/rudraravl/spending/releases). `main` is where development happens and may be unstable.

```bash
git clone https://github.com/rudraravl/spending.git keep
cd keep
git checkout "$(git tag --list 'v*' --sort=-v:refname | head -1)"   # latest release
./setup.sh
```

Git will say you're in "detached HEAD" state. That's expected: you're on a release tag, not a branch. Install with `git clone` as shown (rather than downloading a zip) so `./update.sh` can update you later.

`setup.sh` creates a `.venv`, installs the Python and frontend dependencies, and creates the database at `data/budget.db`. To set up by hand instead:

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
npm --prefix frontend install
```

### Run

Use two terminals from the repo root:

```bash
# Terminal 1: API on http://localhost:8000
source .venv/bin/activate
npm run dev:backend

# Terminal 2: UI on http://localhost:5173
npm run dev:frontend
```

Open http://localhost:5173. On first start the backend creates `data/budget.db` and seeds default categories (Food, Travel, Income, Other → Uncategorized, and so on). Tags and rules start empty.

### Optional configuration

Copy `.env.example` to `.env` for backend settings. Every variable is optional. The app runs without a `.env`.

To personalize the home page greeting, create `frontend/.env.local` with:

```
VITE_USER_NAME=Alex
```

If the API runs somewhere other than `http://localhost:8000`, set `VITE_API_BASE_URL` in the same file.

## Getting started

These steps are the same with or without bank sync.

1. **Create accounts.** Go to **Accounts → New account** and add each card, checking, savings, or brokerage account you want to track. The account type matters: credit cards, cash accounts, and investment accounts behave differently on the detail page and in net worth.
2. **Customize categories (optional).** Under **Settings → Categories & tags**, rename or add categories and subcategories. Under **Settings → Rules**, add rules that set the category automatically based on merchant text and other fields. Rules run on every import and sync.
3. **Get transactions in.** Use one or both of the paths below.

### Option A: without bank sync (CSV import and manual entry)

**Import a CSV**

1. Download a transaction export (CSV) from your bank or card's website.
2. In Keep, open **Import CSV** in the sidebar.
3. Pick the account the file belongs to.
4. Pick an adapter:
   - A **bank adapter** (Chase, Capital One, Citi, Discover, Wells Fargo, Bilt) if one matches. These know the column layout and sign convention for that export.
   - **Generic** for anything else. Map the date, amount, and merchant columns yourself.
5. Review the preview, then import. Rows that look like duplicates of existing transactions are skipped, so re-importing an overlapping date range is safe.

**Add transactions by hand**

Open **Transactions → Add transaction** for one-off entries such as cash purchases. Use the **Transfers** tab to record money moved between your own accounts so it doesn't count as spending.

That's the whole setup. You don't need a `.env`, an encryption key, or a SimpleFIN account.

Missing an adapter for your bank? See [DEVELOPMENT.md](DEVELOPMENT.md#adding-a-csv-adapter). It's usually about ten lines.

### Option B: with SimpleFIN bank sync

[SimpleFIN](https://www.simplefin.org/) is an open protocol for read-only access to bank data. The easiest way to use it is the [SimpleFIN Bridge](https://beta-bridge.simplefin.org/), a paid hosted service (a few dollars a month at the time of writing) that connects to most US banks. Keep only reads from SimpleFIN. It never moves money.

**1. Get a setup token**

Sign up at SimpleFIN Bridge, connect your banks there, then create a new app connection. You'll get a one-time **setup token** (a long base64 string).

**2. Connect Keep**

1. In Keep, go to **Accounts → Bank Sync**.
2. Paste the token under **Add a root connection** and click **Claim & Connect**.

Keep exchanges the token for an **Access URL**, encrypts it, and stores it in the database. The token is single-use. If claiming fails, generate a fresh one.

One connection covers every bank you linked in the Bridge. You don't need a connection per bank.

**3. Link remote accounts to local accounts**

1. Make sure you've created a local account for each bank account you want synced (**Accounts → New account**). Sync never creates accounts for you.
2. On **Bank Sync**, the **Available remote accounts** list shows what SimpleFIN can see. If it's empty, click **Refresh cached accounts**.
3. For each remote account, choose the matching local account and click **Link**.

**4. Sync**

Click **Sync now** on the Bank Sync tab, or use the **Sync** button in the top bar from any page. New transactions go through your rules, and Keep suggests likely transfers between your accounts for you to confirm.

**Sync on a schedule (optional)**

Run the sync script from cron (or launchd, or Task Scheduler):

```bash
# Every day at 6 AM
0 6 * * * cd /path/to/keep && .venv/bin/python -m backend.scripts.simplefin_sync_once
```

Options: `--lookback-days N` (default 7) controls how far back to fetch, and `--min-interval-hours H` (default 20) skips connections that synced recently.

**Things to know**

- **Rate limits:** SimpleFIN Bridge limits how often you can pull data. Keep tracks its own requests and stops at 24 per connection per rolling 24 hours (SimpleFIN's published guideline) (`SIMPLEFIN_MAX_REQUESTS_PER_DAY`). The Bank Sync tab shows usage and when the next request is allowed.
- **Encryption key:** the stored Access URL is encrypted with a key from `SIMPLEFIN_ENCRYPTION_KEY`. If that's unset, the key is generated and saved to `data/.simplefin_key`. Back up that file together with `data/budget.db`. Without it, you'll need to reconnect with a new token.
- **Skipping the UI:** if you already have a claimed Access URL, put it in `.env` as `SIMPLEFIN_ACCESS_URL_PROD`. Keep creates the connection on startup if none exists.
- **Mixing with CSV:** a synced account can still take CSV imports, for example to backfill history from before you connected. Duplicates are skipped.

**Removing a connection**

1. Delete Keep's app connection on the SimpleFIN Bridge website. This revokes Keep's access.
2. In Keep, open **Accounts → Bank Sync**, click the trash icon on the connection, confirm, and click **Remove from Keep**.

Keep checks with SimpleFIN before removing anything and refuses while the connection still works, so you can't accidentally leave live bank access behind. Your local accounts and their transaction history stay. They're just unlinked, and you can keep using them with CSV import or link them to a new connection.

## Updating

Stop the app, then from the repo folder:

```bash
./update.sh
```

It backs up your database to `data/pre-update_<version>_<date>.db`, checks out the newest release, and reinstalls dependencies. Your data in `data/` isn't tracked by git, so it carries over, and the database is migrated automatically the next time the backend starts. Start the app as usual afterwards.

To hear about new versions, click **Watch → Custom → Releases** on the GitHub repo. Each release's notes on the [Releases page](https://github.com/rudraravl/spending/releases) list what changed.

## Your data

- Everything is stored in `data/budget.db` (SQLite). Back up the `data/` folder to keep your history.
- A backup is written to `data/db_backup_<timestamp>.db` at most once a day when the backend starts, and the 5 most recent are kept.
- To start over, stop the backend and delete `data/budget.db`.

## Security

Keep is built to run on your own machine. **The API has no authentication.** It accepts browser requests only from `localhost` origins and rejects cross-site writes, but anything that can reach port 8000 can read your data. Don't expose it to the internet or an untrusted network. If you want remote access, put it behind something that handles auth, such as a VPN like Tailscale or an authenticating reverse proxy.

## Amount sign convention

Amounts are stored as cash flow: positive means money in, negative means money out. See [docs/AMOUNT_CONVENTION.md](docs/AMOUNT_CONVENTION.md) for how this plays out with credit cards and transfers.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for the architecture, tests, and how to add a CSV adapter.

## License

[MIT](LICENSE.md)
