"""
Enforcement Policy Manager for PII Sentinel (Phase 2)
Maps Microsoft Purview Sensitivity Tiers to enforcement actions:
- block (pre-save cancel in Office documents)
- quarantine (detect-and-remediate in file watcher)
- warn (interactive notification / non-blocking override)
- allow (unrestricted save)

Persisted to %APPDATA%/PIISentinel/enforcement_policy.json.
Air-gapped & local-only.
"""

import os
import json
import base64
import logging
from enum import Enum
from pathlib import Path
from typing import Dict, Any, List, Optional

try:
    import win32crypt
    HAS_WIN32CRYPT = True
except ImportError:
    HAS_WIN32CRYPT = False

from backend.config import get_app_dir
from backend.classifier import SensitivityTier

logger = logging.getLogger(__name__)


class EnforcementAction(str, Enum):
    BLOCK = "block"
    QUARANTINE = "quarantine"
    WARN = "warn"
    ALLOW = "allow"


DEFAULT_TIER_ACTIONS = {
    SensitivityTier.RESTRICTED.value: EnforcementAction.BLOCK.value,
    SensitivityTier.HIGHLY_CONFIDENTIAL.value: EnforcementAction.BLOCK.value,
    SensitivityTier.CONFIDENTIAL.value: EnforcementAction.WARN.value,
    SensitivityTier.GENERAL.value: EnforcementAction.ALLOW.value,
    SensitivityTier.PUBLIC.value: EnforcementAction.ALLOW.value,
}


def get_default_watched_folders() -> List[str]:
    """Return standard user personal folders: Desktop, Documents, Downloads."""
    home = Path.home()
    folders = [
        str(home / "Desktop"),
        str(home / "Documents"),
        str(home / "Downloads"),
    ]
    # Filter to existing directories
    return [f for f in folders if Path(f).exists()]


class EnforcementPolicyManager:
    """Manages real-time save enforcement policy and watched directory configuration."""

    def __init__(self, policy_path: Optional[Path] = None):
        self.policy_path = policy_path or (get_app_dir() / "enforcement_policy.json")
        self._policy: Dict[str, Any] = {}
        self.load()

    def load(self) -> None:
        """Load enforcement policy from disk or populate default values."""
        defaults = {
            "tier_actions": dict(DEFAULT_TIER_ACTIONS),
            "fail_open": False,  # Default: Fail Closed (prevent data leakage if service offline)
            "api_host": "127.0.0.1",  # Strictly loopback
            "api_port": 47821,
            "watched_folders": get_default_watched_folders(),
            "quarantine_archive_path": str(Path.home() / "PII_Quarantine.zip"),
            "quarantine_password": None,
            "enforce_office": True,
            "enforce_watcher": True,
            "toast_notifications": True,
        }

        if self.policy_path.exists():
            try:
                with open(self.policy_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    defaults.update(data)
            except Exception as e:
                logger.error(f"Failed to read enforcement policy from {self.policy_path}: {e}")

        self._policy = defaults
        # Migrate plaintext quarantine password to DPAPI if present
        qp = self._policy.get("quarantine_password")
        if qp and isinstance(qp, str) and not qp.startswith("dpapi:") and HAS_WIN32CRYPT:
            self.quarantine_password = qp
        else:
            self.save()

    def save(self) -> None:
        """Save enforcement policy to disk."""
        try:
            self.policy_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.policy_path, "w", encoding="utf-8") as f:
                json.dump(self._policy, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to write enforcement policy to {self.policy_path}: {e}")

    @property
    def tier_actions(self) -> Dict[str, str]:
        return self._policy.get("tier_actions", dict(DEFAULT_TIER_ACTIONS))

    @tier_actions.setter
    def tier_actions(self, val: Dict[str, str]) -> None:
        self._policy["tier_actions"] = val
        self.save()

    @property
    def fail_open(self) -> bool:
        return bool(self._policy.get("fail_open", False))

    @fail_open.setter
    def fail_open(self, val: bool) -> None:
        self._policy["fail_open"] = bool(val)
        self.save()

    @property
    def api_port(self) -> int:
        return int(self._policy.get("api_port", 47821))

    @api_port.setter
    def api_port(self, val: int) -> None:
        self._policy["api_port"] = int(val)
        self.save()

    @property
    def api_host(self) -> str:
        return "127.0.0.1"  # Always strictly 127.0.0.1

    @property
    def watched_folders(self) -> List[str]:
        if "watched_folders" not in self._policy:
            self._policy["watched_folders"] = get_default_watched_folders()
            self.save()
        folders = self._policy.get("watched_folders", [])
        return [f for f in folders if Path(f).exists() and Path(f).is_dir()]

    @watched_folders.setter
    def watched_folders(self, val: List[str]) -> None:
        self._policy["watched_folders"] = val
        self.save()

    @property
    def quarantine_archive_path(self) -> str:
        return self._policy.get("quarantine_archive_path", str(Path.home() / "PII_Quarantine.zip"))

    @quarantine_archive_path.setter
    def quarantine_archive_path(self, val: str) -> None:
        self._policy["quarantine_archive_path"] = val
        self.save()

    @property
    def quarantine_password(self) -> Optional[str]:
        """Decrypt and return quarantine password using Windows DPAPI."""
        raw = self._policy.get("quarantine_password")
        if not raw:
            return None
        if isinstance(raw, str) and raw.startswith("dpapi:"):
            if HAS_WIN32CRYPT:
                try:
                    b64_str = raw[len("dpapi:"):]
                    enc_bytes = base64.b64decode(b64_str)
                    _, dec_bytes = win32crypt.CryptUnprotectData(enc_bytes)
                    return dec_bytes.decode("utf-8")
                except Exception as e:
                    logger.error(f"Failed to decrypt quarantine password with DPAPI: {e}")
                    return None
            else:
                logger.warning("win32crypt unavailable to decrypt DPAPI quarantine password")
                return None
        return raw

    @quarantine_password.setter
    def quarantine_password(self, val: Optional[str]) -> None:
        """Encrypt quarantine password with Windows DPAPI before persisting."""
        if not val:
            self._policy["quarantine_password"] = None
        else:
            if HAS_WIN32CRYPT and not val.startswith("dpapi:"):
                try:
                    enc_bytes = win32crypt.CryptProtectData(val.encode("utf-8"), "PIISentinel Quarantine Password")
                    b64 = base64.b64encode(enc_bytes).decode("ascii")
                    self._policy["quarantine_password"] = f"dpapi:{b64}"
                except Exception as e:
                    logger.error(f"DPAPI encryption failed, storing in-memory fallback: {e}")
                    self._policy["quarantine_password"] = val
            else:
                self._policy["quarantine_password"] = val
        self.save()

    @property
    def enforce_office(self) -> bool:
        return bool(self._policy.get("enforce_office", True))

    @enforce_office.setter
    def enforce_office(self, val: bool) -> None:
        self._policy["enforce_office"] = bool(val)
        self.save()

    @property
    def enforce_watcher(self) -> bool:
        return bool(self._policy.get("enforce_watcher", True))

    @enforce_watcher.setter
    def enforce_watcher(self, val: bool) -> None:
        self._policy["enforce_watcher"] = bool(val)
        self.save()

    @property
    def toast_notifications(self) -> bool:
        return bool(self._policy.get("toast_notifications", True))

    @toast_notifications.setter
    def toast_notifications(self, val: bool) -> None:
        self._policy["toast_notifications"] = bool(val)
        self.save()

    def get_action_for_tier(self, tier: str, is_office: bool = False) -> str:
        """
        Resolve recommended enforcement action for a given sensitivity tier.
        In Office documents: 'quarantine' is converted to 'block' since Office can block pre-write.
        In generic file watcher: 'block' is converted to 'quarantine' since write has already completed on disk.
        """
        actions = self.tier_actions
        action = actions.get(tier, EnforcementAction.ALLOW.value).lower()

        if is_office and action == EnforcementAction.QUARANTINE.value:
            return EnforcementAction.BLOCK.value
        if not is_office and action == EnforcementAction.BLOCK.value:
            return EnforcementAction.QUARANTINE.value

        return action

    def resolve_action(self, tier: str, is_office: bool = False) -> str:
        """Alias for get_action_for_tier."""
        return self.get_action_for_tier(tier, is_office=is_office)

    def to_dict(self) -> Dict[str, Any]:
        """Return copy of active policy."""
        return dict(self._policy)

    def update_from_dict(self, updates: Dict[str, Any]) -> None:
        """Update multiple policy values and persist."""
        # Process quarantine_password through setter so it is encrypted via Windows DPAPI
        if "quarantine_password" in updates:
            self.quarantine_password = updates["quarantine_password"]
            updates = {k: v for k, v in updates.items() if k != "quarantine_password"}

        self._policy.update(updates)
        # Ensure api_host remains loopback
        self._policy["api_host"] = "127.0.0.1"
        self.save()


# Singleton instance
policy_manager = EnforcementPolicyManager()
