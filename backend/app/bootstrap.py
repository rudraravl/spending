from __future__ import annotations

import sys
from pathlib import Path


def ensure_repo_root_on_path() -> None:
    """
    Add repo root to `sys.path` so the backend can import the existing domain layer
    from top-level packages: `db/`, `services/`, `adapters/`, `utils/`.
    """

    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

