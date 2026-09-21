"""
Logging Setup for PII Sentinel
Writes rotating log files to %APPDATA%/PIISentinel/logs/
Provides callback hooks for live UI log streaming.
"""

import os
import sys
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime
from typing import Callable, List
from backend.config import get_logs_dir

_ui_subscribers: List[Callable[[str, str], None]] = []


class UILogHandler(logging.Handler):
    """Custom logging handler that dispatches log records to UI subscribers."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            level = record.levelname
            for callback in list(_ui_subscribers):
                try:
                    callback(msg, level)
                except Exception:
                    pass
        except Exception:
            self.handleError(record)


def add_ui_log_listener(callback: Callable[[str, str], None]) -> None:
    """Register a callback (message, level) to receive log messages."""
    if callback not in _ui_subscribers:
        _ui_subscribers.append(callback)


def remove_ui_log_listener(callback: Callable[[str, str], None]) -> None:
    """Remove a registered callback."""
    if callback in _ui_subscribers:
        _ui_subscribers.remove(callback)


def setup_logger(log_level: int = logging.INFO) -> logging.Logger:
    """Configure root and application loggers."""
    logs_dir = get_logs_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = logs_dir / f"pii_sentinel_{timestamp}.log"

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Avoid duplicate handlers if setup_logger is called multiple times
    if any(isinstance(h, RotatingFileHandler) for h in root_logger.handlers):
        return logging.getLogger("pii_sentinel")

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # File Handler (5 MB max per file, 3 backups)
    file_handler = RotatingFileHandler(
        filename=str(log_file),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8"
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    # Console Handler (only if stdout is available)
    if sys.stdout is not None:
        try:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(log_level)
            console_handler.setFormatter(formatter)
            root_logger.addHandler(console_handler)
        except Exception:
            pass

    # UI Log Handler
    ui_handler = UILogHandler()
    ui_handler.setLevel(log_level)
    ui_handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    root_logger.addHandler(ui_handler)

    app_logger = logging.getLogger("pii_sentinel")
    app_logger.info(f"Logging initialized. Log file: {log_file}")
    return app_logger
