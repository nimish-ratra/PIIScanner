"""
Service Authentication Manager for PII Sentinel (Phase 2 & Phase 3 Hardening)
Generates, stores, and verifies the shared-secret bearer token for the local microservice.
Protects loopback endpoints against unauthorized access from local browser tabs and untrusted processes.
"""

import os
import sys
import hmac
import secrets
import logging
from pathlib import Path
from typing import Optional

from backend.config import get_app_dir

logger = logging.getLogger("pii_sentinel.auth")

TOKEN_HEADER = "X-PIISentinel-Token"
TOKEN_FILE_NAME = "service_token"

_cached_token: Optional[str] = None


def get_token_file_path() -> Path:
    """Return the path to the service token file in %APPDATA%\\PIISentinel\\service_token."""
    return get_app_dir() / TOKEN_FILE_NAME


def get_or_create_service_token() -> str:
    """
    Retrieve the existing shared-secret service token or generate a new cryptographically secure token.
    Persisted to %APPDATA%\\PIISentinel\\service_token with per-user file permissions.
    """
    global _cached_token
    token_path = get_token_file_path()

    if _cached_token:
        return _cached_token

    # Read existing token if valid
    if token_path.exists():
        try:
            token = token_path.read_text(encoding="utf-8").strip()
            if token and len(token) >= 32:
                _cached_token = token
                return token
        except Exception as e:
            logger.warning(f"Could not read existing service token file, regenerating: {e}")

    # Generate new cryptographically random token
    new_token = secrets.token_urlsafe(32)
    try:
        token_path.parent.mkdir(parents=True, exist_ok=True)
        # Write token
        token_path.write_text(new_token, encoding="utf-8")

        # Restrict permissions
        if sys.platform != "win32":
            try:
                os.chmod(str(token_path), 0o600)
            except Exception:
                pass
        _cached_token = new_token
        logger.info(f"Generated new service authentication token at {token_path}")
        return new_token
    except Exception as e:
        logger.error(f"Failed to persist service authentication token: {e}")
        # In-memory fallback if disk write fails
        _cached_token = new_token
        return new_token


def verify_service_token(token: Optional[str]) -> bool:
    """
    Constant-time comparison of the provided token against the authorized service token.
    Uses hmac.compare_digest to prevent timing side-channel attacks.
    """
    if not token or not isinstance(token, str):
        return False

    expected_token = get_or_create_service_token()
    return hmac.compare_digest(token.strip(), expected_token)


def reset_service_token() -> str:
    """Regenerate and overwrite the service authentication token (e.g. for testing/rotation)."""
    global _cached_token
    _cached_token = None
    token_path = get_token_file_path()
    if token_path.exists():
        try:
            token_path.unlink()
        except Exception:
            pass
    return get_or_create_service_token()
