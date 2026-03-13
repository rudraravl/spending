# Personal Budget App

Simple local app to track spending in SQLite with a Streamlit UI.

## Features

- Import credit card CSVs (built-in adapters + generic mapping)
- Add/edit transactions
- Categories, subcategories, tags
- Filters and summaries (month/year/semester/custom ranges)

## Requirements

- Python 3.11+
- `pip`

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Optional:

```bash
./setup.sh
```

## Run

```bash
streamlit run app.py
```

The app uses a local SQLite database in `data/budget.db`. No external services are used.
