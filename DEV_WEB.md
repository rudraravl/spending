# Web App Dev (React + FastAPI + SQLite)

## Prerequisites
- Python 3.11+
- Node.js + npm

## 1) Backend

Install Python deps:

```bash
pip install -r requirements.txt
pip install -r backend/requirements.txt
```

Start the API:

```bash
uvicorn backend.main:app --reload --port 8000
```

Backend:
- Uses the same SQLite DB file as the Streamlit app: `data/budget.db`
- Runs `init_db()` on startup and performs a best-effort daily DB backup
- CORS is enabled for local development (`allow_origins=["*"]`)

## 2) Frontend

Start the UI:

```bash
npm --prefix frontend install
VITE_API_BASE_URL=http://localhost:8000 npm --prefix frontend run dev
```

If you prefer `zsh`:

```bash
export VITE_API_BASE_URL=http://localhost:8000
npm --prefix frontend run dev
```

## Convenience commands

From repo root:

```bash
npm run dev:backend
npm run dev:frontend
```

## Regression script

Run the API-vs-domain regression checks:

```bash
python scripts/regression_api_vs_streamlit.py
```

