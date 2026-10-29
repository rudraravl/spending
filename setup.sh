#!/bin/bash
# One-time setup for Keep: Python venv + deps, frontend deps, and the SQLite database.
set -e

cd "$(dirname "$0")"

echo "Keep setup"
echo

echo "- Python: $(python3 --version 2>&1)"
if [ ! -d ".venv" ]; then
    echo "- Creating virtual environment (.venv)"
    python3 -m venv .venv
fi
source .venv/bin/activate

echo "- Installing Python dependencies"
pip install -q -r requirements.txt

echo "- Installing frontend dependencies"
npm --prefix frontend install --silent

echo "- Initializing database"
python3 -c "from db.database import init_db; init_db()"

echo
echo "Done. Start the app in two terminals:"
echo "  source .venv/bin/activate && npm run dev:backend"
echo "  npm run dev:frontend"
echo "Then open http://localhost:5173"
