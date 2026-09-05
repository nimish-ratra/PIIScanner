"""
Configuration Manager for PII Sentinel
Handles reading, writing, and persisting user settings in %APPDATA%/PIISentinel/config.json
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

DEFAULT_EXTENSIONS = [
    ".doc", ".docx", ".pdf", ".txt", ".csv", ".rtf",
    ".xls", ".xlsx", ".ppt", ".pptx", ".html", ".xml",
    ".json", ".odt", ".ods"
]

DEFAULT_CONFIG: Dict[str, Any] = {
    "confidence_threshold": 0.6,
    "selected_entities": [],  # Empty list indicates all available entities selected
    "supported_extensions": DEFAULT_EXTENSIONS,
    "default_output_folder": "",
    "max_file_size_mb": 50,
    "ocr_enabled": False,
    "theme": "dark",
    "first_run_complete": False,
    "java_path": "",
    "tesseract_path": ""
}


def get_app_dir() -> Path:
    """Return the application directory in %APPDATA%\\PIISentinel."""
    app_data = os.getenv("APPDATA")
    if not app_data:
        app_data = os.path.expanduser("~")
    base_dir = Path(app_data) / "PIISentinel"
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


def get_config_path() -> Path:
    """Return the absolute path to config.json."""
    return get_app_dir() / "config.json"


def get_logs_dir() -> Path:
    """Return the logs directory in %APPDATA%\\PIISentinel\\logs."""
    logs_dir = get_app_dir() / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    return logs_dir


def get_reports_dir() -> Path:
    """Return the default reports storage directory in %APPDATA%\\PIISentinel\\reports."""
    reports_dir = get_app_dir() / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    return reports_dir


def get_db_path() -> Path:
    """Return the path to the history SQLite database."""
    return get_app_dir() / "history.db"


class ConfigManager:
    """Manages application settings with JSON file persistence."""

    def __init__(self, config_path: Path = None):
        self.config_path = config_path or get_config_path()
        self._config: Dict[str, Any] = self.load()

    def load(self) -> Dict[str, Any]:
        """Load settings from JSON file or return defaults."""
        config = DEFAULT_CONFIG.copy()
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    config.update(data)
            except Exception as e:
                logger.error(f"Failed to read config file at {self.config_path}: {e}")
        return config

    def save(self) -> bool:
        """Persist current settings to JSON file."""
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=2)
            return True
        except Exception as e:
            logger.error(f"Failed to save config file at {self.config_path}: {e}")
            return False

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def set(self, key: str, value: Any, auto_save: bool = True) -> None:
        self._config[key] = value
        if auto_save:
            self.save()

    def update(self, new_settings: Dict[str, Any], auto_save: bool = True) -> None:
        self._config.update(new_settings)
        if auto_save:
            self.save()

    @property
    def confidence_threshold(self) -> float:
        return float(self._config.get("confidence_threshold", 0.6))

    @confidence_threshold.setter
    def confidence_threshold(self, val: float) -> None:
        self.set("confidence_threshold", float(val))

    @property
    def supported_extensions(self) -> List[str]:
        return list(self._config.get("supported_extensions", DEFAULT_EXTENSIONS))

    @supported_extensions.setter
    def supported_extensions(self, exts: List[str]) -> None:
        self.set("supported_extensions", exts)

    @property
    def selected_entities(self) -> List[str]:
        return list(self._config.get("selected_entities", []))

    @selected_entities.setter
    def selected_entities(self, entities: List[str]) -> None:
        self.set("selected_entities", entities)

    @property
    def default_output_folder(self) -> str:
        return str(self._config.get("default_output_folder", ""))

    @default_output_folder.setter
    def default_output_folder(self, path: str) -> None:
        self.set("default_output_folder", path)

    @property
    def max_file_size_mb(self) -> int:
        return int(self._config.get("max_file_size_mb", 50))

    @max_file_size_mb.setter
    def max_file_size_mb(self, val: int) -> None:
        self.set("max_file_size_mb", int(val))

    @property
    def ocr_enabled(self) -> bool:
        return bool(self._config.get("ocr_enabled", False))

    @ocr_enabled.setter
    def ocr_enabled(self, val: bool) -> None:
        self.set("ocr_enabled", val)

    @property
    def theme(self) -> str:
        return str(self._config.get("theme", "dark"))

    @theme.setter
    def theme(self, val: str) -> None:
        self.set("theme", val)

    @property
    def first_run_complete(self) -> bool:
        return bool(self._config.get("first_run_complete", False))

    @first_run_complete.setter
    def first_run_complete(self, val: bool) -> None:
        self.set("first_run_complete", val)

    def reset_to_defaults(self) -> None:
        self._config = DEFAULT_CONFIG.copy()
        self.save()


# Singleton instance
config_manager = ConfigManager()
