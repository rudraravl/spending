"""
Symmetric encryption helpers for storing SimpleFIN Access URLs at rest.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the `cryptography` library.
The key is read from the SIMPLEFIN_ENCRYPTION_KEY env var.  If the var is
missing, a key is auto-generated and persisted to `data/.simplefin_key` so
that a single-user local install works out of the box without manual config.
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet

_KEY_ENV_VAR = "SIMPLEFIN_ENCRYPTION_KEY"
_KEY_FILE = Path(__file__).resolve().parent.parent / "data" / ".simplefin_key"

_fernet: Fernet | None = None


def _resolve_key() -> bytes:
    env_key = os.environ.get(_KEY_ENV_VAR)
    if env_key:
        return env_key.encode()

    if _KEY_FILE.exists():
        return _KEY_FILE.read_text().strip().encode()

    key = Fernet.generate_key()
    _KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_bytes(key)
    return key


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_resolve_key())
    return _fernet


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string and return the Base64-encoded ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """Decrypt a Base64-encoded ciphertext and return the plaintext string."""
    return _get_fernet().decrypt(ciphertext.encode()).decode()
