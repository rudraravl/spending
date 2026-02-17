#!/bin/bash
# Quick Start Setup Script for Personal Budget App

set -e  # Exit on error

echo "🚀 Personal Budget App - Quick Start Setup"
echo "==========================================="
echo ""

# Check Python version
echo "✓ Checking Python version..."
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "  Found Python $python_version"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "✓ Creating virtual environment..."
    python3 -m venv .venv
else
    echo "✓ Virtual environment already exists"
fi

# Activate virtual environment
echo "✓ Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo "✓ Installing dependencies..."
pip install -q -r requirements.txt

# Create data directory
echo "✓ Creating data directory..."
mkdir -p data

# Initialize database
echo "✓ Initializing database..."
python3 << EOF
from db.database import init_db
init_db()
print("  Database ready at data/budget.db")
EOF

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the app, run:"
echo "  source .venv/bin/activate"
echo "  streamlit run app.py"
echo ""
