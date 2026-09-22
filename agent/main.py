"""
ClAIssify - Main Application Entry Point
Desktop application for discovering, reviewing, extracting, and quarantining PII in local documents.
"""

import os
import sys

# Ensure sys.stdout and sys.stderr are valid writable streams in PyInstaller windowed mode (console=False)
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import logging
import traceback

from PySide6.QtWidgets import QApplication, QMessageBox
from PySide6.QtCore import Qt

from backend.logger import setup_logger
from backend.tika_extractor import configure_java_environment
from backend import license_client
from ui.main_window import MainWindow
from ui.views.license_gate_window import LicenseGateWindow

logger = setup_logger()


def exception_hook(exc_type, exc_value, exc_traceback):
    """Global exception handler to log unexpected crashes and warn the user."""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return

    err_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    logger.critical(f"Unhandled exception:\n{err_msg}")

    # Show message box if app is running
    app = QApplication.instance()
    if app:
        QMessageBox.critical(
            None,
            "Unexpected Error",
            f"An unexpected error occurred:\n\n{exc_value}\n\nCheck logs in %APPDATA%\\PIISentinel\\logs for details."
        )


def main():
    # Handle background service invocation (e.g. when spawned from compiled PyInstaller binary)
    if "--service" in sys.argv or "-m" in sys.argv or any("service_runner" in a for a in sys.argv):
        from service.service_runner import main as service_main
        # Strip dispatching args so service_runner's argparse sees only its own flags
        clean_argv = [sys.argv[0]]
        skip = False
        for arg in sys.argv[1:]:
            if skip:
                skip = False
                continue
            if arg == "--service":
                continue
            if arg == "-m":
                skip = True
                continue
            if "service_runner" in arg:
                continue
            clean_argv.append(arg)
        sys.argv = clean_argv
        service_main()
        return

    # Ensure Java is discoverable by Apache Tika
    configure_java_environment()

    # Set exception hook
    sys.excepthook = exception_hook

    # Qt Application Setup
    app = QApplication(sys.argv)
    app.setApplicationName("ClAIssify")
    app.setOrganizationName("Sentinel Security")
    app.setApplicationVersion("1.1.0")

    # Holds whichever top-level window is currently active so Qt doesn't
    # garbage-collect it once main()'s own locals would otherwise be the
    # only reference. MainWindow is deliberately not constructed at all
    # (it's heavy — eagerly builds every scan/results/history view) until
    # we already know licensing allows it.
    windows: dict = {}

    def show_license_gate(reason: str = "License suspended or revoked") -> None:
        logger.warning(f"License enforcement active: {reason}. Presenting License Gate.")
        if "main" in windows:
            main_win = windows.pop("main")
            main_win.close()
        gate = LicenseGateWindow(on_licensed=launch_main_window)
        windows["gate"] = gate
        gate.show()

    def launch_main_window() -> None:
        if "gate" in windows:
            gate_win = windows.pop("gate")
            gate_win.close()
        window = MainWindow(on_license_lost=show_license_gate)
        windows["main"] = window
        window.showMaximized()  # maximized by default, not OS-level fullscreen

    standalone = "--standalone" in sys.argv or os.environ.get("CLAISSIFY_STANDALONE", "0") == "1"
    if not standalone and license_client.is_registered():
        # Live refresh on startup so newly suspended/revoked seats are caught immediately
        try:
            allowed, reason = license_client.refresh_policy(timeout_seconds=3.0)
        except Exception as e:
            logger.debug(f"Startup license refresh skipped (using cached state): {e}")
            allowed, reason = license_client.enforcement_status()
    else:
        allowed, reason = license_client.enforcement_status()

    if allowed or standalone:
        launch_main_window()
    else:
        show_license_gate(reason)

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
