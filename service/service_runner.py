"""
PII Sentinel Service Runner & System Tray Resident (Phase 2)
Runs the localhost FastAPI classification microservice and background File Watcher.
Provides a Windows system tray icon with live status, controls, and Windows startup integration.
Air-gapped & local-first.
"""

import os
import sys
import time
import winreg
import logging
import threading
from pathlib import Path
from typing import Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import uvicorn
from service.enforcement_policy import policy_manager
from service.api_server import app
from backend.config import get_logs_dir

logger = logging.getLogger("pii_sentinel.service_runner")

AUTOSTART_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_APP_NAME = "PIISentinelEnforcementService"


def is_autostart_enabled() -> bool:
    """Check if the service is registered to run on Windows startup."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_KEY, 0, winreg.KEY_READ) as key:
            winreg.QueryValueEx(key, AUTOSTART_APP_NAME)
            return True
    except WindowsError:
        return False


def set_autostart(enable: bool) -> bool:
    """Add or remove Windows startup registry entry."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enable:
                python_exe = sys.executable
                script_path = str(Path(__file__).resolve())
                cmd = f'"{python_exe}" "{script_path}" --headless'
                winreg.SetValueEx(key, AUTOSTART_APP_NAME, 0, winreg.REG_SZ, cmd)
                logger.info(f"Registered autostart: {cmd}")
            else:
                try:
                    winreg.DeleteValue(key, AUTOSTART_APP_NAME)
                    logger.info("Unregistered autostart.")
                except WindowsError:
                    pass
        return True
    except Exception as e:
        logger.error(f"Failed to set autostart: {e}")
        return False


class EnforcementServiceRunner:
    """Manages the API server and File Watcher lifecycle with a system tray icon."""

    def __init__(self, port: Optional[int] = None, enable_watcher: bool = True):
        self.port = port or policy_manager.api_port
        self.enable_watcher = enable_watcher
        self._server: Optional[uvicorn.Server] = None
        self._server_thread: Optional[threading.Thread] = None
        self._watcher = None
        self._is_paused: bool = False
        self._is_running: bool = False
        self._tray_icon = None

    def start_api_server(self) -> None:
        """Start FastAPI uvicorn server in a dedicated thread bound to 127.0.0.1."""
        app.state.runner = self
        config = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            access_log=False
        )
        self._server = uvicorn.Server(config)

        def _run():
            logger.info(f"Starting PII Sentinel API Server on http://127.0.0.1:{self.port}...")
            self._server.run()

        self._server_thread = threading.Thread(target=_run, daemon=True, name="ApiServerThread")
        self._server_thread.start()
        print(f"[OK] Classification Service active on http://127.0.0.1:{self.port} (Loopback Only)")

    def start_file_watcher(self) -> None:
        """Start generic filesystem watcher if enabled."""
        if not self.enable_watcher or not policy_manager.enforce_watcher:
            return

        try:
            from file_watcher.watcher_service import FileWatcherService
            self._watcher = FileWatcherService()
            self._watcher.start()
            logger.info("Background File Watcher service started.")
            watched = policy_manager.watched_folders
            print(f"[PII Sentinel] File Watcher active monitoring {len(watched)} folder(s):")
            for w in watched:
                print(f"   - {w}")
        except Exception as e:
            logger.warning(f"Could not start File Watcher: {e}")

    def reload_watcher(self) -> None:
        """Reload file watcher with updated policy folders."""
        if self._watcher:
            logger.info("Reloading File Watcher with updated policy configuration...")
            self._watcher.reload_watched_folders()
            watched = policy_manager.watched_folders
            logger.info(f"File Watcher now monitoring {len(watched)} folder(s): {watched}")
        elif self.enable_watcher and policy_manager.enforce_watcher:
            self.start_watcher()

    def stop(self) -> None:
        """Clean shutdown of API server, watcher, and tray icon."""
        self._is_running = False
        if self._watcher:
            try:
                self._watcher.stop()
            except Exception:
                pass
            self._watcher = None

        if self._server:
            self._server.should_exit = True

        if self._tray_icon:
            try:
                self._tray_icon.stop()
            except Exception:
                pass
            self._tray_icon = None

        logger.info("PII Sentinel Enforcement Service stopped.")

    def toggle_pause(self) -> None:
        """Pause or resume enforcement."""
        self._is_paused = not self._is_paused
        status_txt = "Paused" if self._is_paused else "Active"
        logger.info(f"Enforcement is now: {status_txt}")
        if self._watcher:
            self._watcher.is_paused = self._is_paused
        self._update_tray_icon()

    def _create_tray_image(self, color: str = "#22c55e"):
        """Generate a clean shield/circle icon in memory."""
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Draw outer circle
        draw.ellipse([4, 4, 60, 60], fill=color, outline="#ffffff", width=2)
        # Draw inner 'S' or dot
        draw.ellipse([22, 22, 42, 42], fill="#ffffff")
        return img

    def _update_tray_icon(self) -> None:
        if not self._tray_icon:
            return
        color = "#f59e0b" if self._is_paused else "#22c55e"
        self._tray_icon.icon = self._create_tray_image(color)
        status_txt = "Paused" if self._is_paused else "Active"
        self._tray_icon.title = f"PII Sentinel: {status_txt} (Port {self.port})"

    def _open_logs_folder(self) -> None:
        try:
            logs_dir = get_logs_dir()
            logs_dir.mkdir(parents=True, exist_ok=True)
            if hasattr(os, "startfile"):
                os.startfile(str(logs_dir))
        except Exception as e:
            logger.error(f"Failed to open logs folder: {e}")

    def _open_enforcement_log(self) -> None:
        try:
            log_file = get_logs_dir() / "enforcement.log"
            if not log_file.exists():
                log_file.touch()
            if hasattr(os, "startfile"):
                os.startfile(str(log_file))
        except Exception as e:
            logger.error(f"Failed to open enforcement log: {e}")

    def run_tray(self) -> None:
        """Run system tray event loop."""
        import pystray

        menu_items = [
            pystray.MenuItem(lambda text: f"PII Sentinel: {'Paused' if self._is_paused else 'Active'}", None, enabled=False),
            pystray.MenuItem(lambda text: f"Port: {self.port} (127.0.0.1)", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                lambda text: "▶ Resume Enforcement" if self._is_paused else "⏸ Pause Enforcement",
                lambda icon, item: self.toggle_pause()
            ),
            pystray.MenuItem("📂 Open Logs Folder", lambda icon, item: self._open_logs_folder()),
            pystray.MenuItem("📄 View Enforcement Log", lambda icon, item: self._open_enforcement_log()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit Service", lambda icon, item: self.stop())
        ]

        self._tray_icon = pystray.Icon(
            "PIISentinelService",
            self._create_tray_image("#22c55e"),
            f"PII Sentinel Enforcement Service (Port {self.port})",
            pystray.Menu(*menu_items)
        )
        self._is_running = True
        print("[PII Sentinel] System tray icon running in Windows taskbar (bottom-right notification area).")
        print("   Right-click tray icon to Pause/Resume, or press Ctrl+C in this terminal to stop.")
        self._tray_icon.run()

    def run(self, with_tray: bool = True) -> None:
        """Main entry point to start services."""
        self.start_api_server()
        self.start_file_watcher()

        if with_tray:
            try:
                self.run_tray()
            except Exception as e:
                logger.warning(f"Tray error (falling back to headless loop): {e}")
                self._run_headless_loop()
        else:
            self._run_headless_loop()

    def _run_headless_loop(self) -> None:
        self._is_running = True
        try:
            while self._is_running:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            self.stop()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="PII Sentinel Real-Time Enforcement Service")
    parser.add_argument("--port", type=int, default=None, help="Port to bind API server (default 47821)")
    parser.add_argument("--headless", action="store_true", help="Run without system tray icon")
    parser.add_argument("--no-watcher", action="store_true", help="Disable generic filesystem watcher")
    args = parser.parse_args()

    runner = EnforcementServiceRunner(
        port=args.port,
        enable_watcher=not args.no_watcher
    )
    runner.run(with_tray=not args.headless)


if __name__ == "__main__":
    main()
