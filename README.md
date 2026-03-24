# Personal Budget App

Local spending tracker backed by SQLite: import credit card CSVs, categorize transactions, and view summaries. Use the **Streamlit** UI (Python only) or the **React + FastAPI** stack.

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

### Streamlit (no Node)

```bash
streamlit run app.py
```

Data lives in `data/budget.db`. Nothing runs in the cloud.

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

**Backend:** Uses the same DB as Streamlit (`data/budget.db`). Run `uvicorn` from the repo root so imports resolve (`db/`, `services/`, `adapters/`, etc.). On startup the API runs `init_db()` and a best-effort daily DB backup. CORS is open for local dev (`allow_origins=["*"]`).

**Regression check (API vs domain):**

```bash
python scripts/regression_api_vs_streamlit.py
```

## Features

- Import credit card CSVs (adapters + generic mapping)
- Add/edit transactions; categories, subcategories, tags
- Filters and summaries (month/year/semester/custom ranges)
