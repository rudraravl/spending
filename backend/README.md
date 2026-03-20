# Spending Backend (FastAPI)

Local development:

1. Install backend deps (in your venv):
   - `pip install -r backend/requirements.txt`
2. Start the API:
   - `uvicorn backend.main:app --reload --port 8000`

The backend imports the existing domain layer (`db/`, `services/`, `adapters/`, `utils/`) from the
repo root. Keep running the server from the repo root.

