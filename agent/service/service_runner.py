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
from backend import license_client
from backend import telemetry_client
from datetime import datetime, timezone

logger = logging.getLogger("pii_sentinel.service_runner")

AUTOSTART_REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_APP_NAME = "PIISentinelEnforcementService"

# When a heartbeat attempt fails (offline) or the device isn't activated yet,
# retry on this much shorter cadence rather than waiting a full
# heartbeatIntervalSeconds (typically 24h) for the next attempt.
LICENSE_RETRY_BACKOFF_SECONDS = 300


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
                if getattr(sys, "frozen", False):
                    cmd = f'"{sys.executable}" --service --headless'
                else:
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
        self._license_thread: Optional[threading.Thread] = None
        self._license_stop_event = threading.Event()
        self._telemetry_thread: Optional[threading.Thread] = None
        self._telemetry_stop_event = threading.Event()
        self._service_started_at: Optional[str] = None

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

    def start_license_heartbeat(self) -> None:
        """Start the background TrustFabric check-in loop. Heartbeats on the
        protocol's interval when activated and reachable; retries sooner on
        failure or if not yet activated. Enforcement is not gated on this yet
        (see MainWindow._check_activation) — it only keeps the cached policy
        in license_client's local state up to date."""
        self._license_thread = threading.Thread(
            target=self._license_heartbeat_loop, daemon=True, name="LicenseHeartbeatThread"
        )
        self._license_thread.start()

    def _license_heartbeat_loop(self) -> None:
        while self._is_running:
            sleep_for = LICENSE_RETRY_BACKOFF_SECONDS
            if license_client.is_registered():
                try:
                    state = license_client.heartbeat()
                    if state.get("lastPolicy", {}).get("status") == "PENDING":
                        # Poll frequently while awaiting Company Admin approval
                        # instead of waiting a full heartbeatIntervalSeconds
                        # (24h default) — the whole point of this state is to
                        # notice promptly once approved.
                        sleep_for = LICENSE_RETRY_BACKOFF_SECONDS
                        logger.info("License heartbeat OK — still PENDING admin approval.")
                    else:
                        sleep_for = state.get("heartbeatIntervalSeconds", LICENSE_RETRY_BACKOFF_SECONDS)
                        logger.info("License heartbeat OK.")
                except Exception as e:
                    logger.warning(f"License heartbeat failed (will retry in {LICENSE_RETRY_BACKOFF_SECONDS}s): {e}")
            if self._license_stop_event.wait(sleep_for):
                return

    def start_telemetry_loop(self) -> None:
        """Start the background TrustFabric fleet telemetry loop. Pings every
        server-supplied interval (clamped 60-900s), aggregates enforcement windows
        every 15 min, and flushes queued outbox summaries."""
        self._telemetry_thread = threading.Thread(
            target=self._telemetry_loop, daemon=True, name="TelemetryThread"
        )
        self._telemetry_thread.start()

    def _telemetry_loop(self) -> None:
        last_enforcement_agg = 0.0
        while self._is_running:
            sleep_for = telemetry_client.DEFAULT_PING_INTERVAL_SECONDS
            try:
                # 1. Send periodic ping
                ping_res = telemetry_client.send_ping(
                    service_running=self._is_running and not self._is_paused,
                    watcher_active=bool(self._watcher and not self._is_paused),
                    service_started_at=self._service_started_at
                )
                if ping_res and "telemetry" in ping_res:
                    interval = ping_res["telemetry"].get("intervalSeconds", telemetry_client.DEFAULT_PING_INTERVAL_SECONDS)
                    sleep_for = max(
                        telemetry_client.MIN_PING_INTERVAL_SECONDS,
                        min(telemetry_client.MAX_PING_INTERVAL_SECONDS, interval)
                    )

                # 2. Check 15-min enforcement aggregation
                now_ts = time.time()
                if now_ts - last_enforcement_agg >= 15 * 60:
                    telemetry_client.aggregate_enforcement_windows()
                    last_enforcement_agg = now_ts

                # 3. Flush outbox
                telemetry_client.flush_outbox()

            except Exception as e:
                logger.debug(f"Telemetry loop iteration error: {e}")

            if self._telemetry_stop_event.wait(sleep_for):
                return

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
        self._license_stop_event.set()
        self._telemetry_stop_event.set()

        # Send best-effort final ping with serviceRunning=false
        try:
            telemetry_client.send_ping(
                service_running=False,
                watcher_active=False,
                service_started_at=self._service_started_at
            )
        except Exception as e:
            logger.debug(f"Final shutdown ping failed: {e}")
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

        def _license_label(text) -> str:
            if not license_client.is_registered():
                return "License: Not Activated"
            allowed, reason = license_client.enforcement_status()
            return f"License: {'OK' if allowed else reason}"

        menu_items = [
            pystray.MenuItem(lambda text: f"PII Sentinel: {'Paused' if self._is_paused else 'Active'}", None, enabled=False),
            pystray.MenuItem(lambda text: f"Port: {self.port} (127.0.0.1)", None, enabled=False),
            pystray.MenuItem(_license_label, None, enabled=False),
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
        # Set before starting the license thread — run_tray()/_run_headless_loop()
        # normally set this, but that happens after this point and the license
        # loop's `while self._is_running` check would otherwise exit immediately.
        self._is_running = True
        self._service_started_at = datetime.now(timezone.utc).isoformat()
        self.start_license_heartbeat()
        self.start_telemetry_loop()

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

    # Checked once at startup, same as agent/main.py's GUI entry point — if
    # the license went bad (revoked/suspended/grace expired) since this was
    # last approved, a background/autostart-launched service must not keep
    # running unattended just because no one opened the GUI to notice.
    allowed, reason = license_client.enforcement_status()
    if not allowed:
        if not license_client.is_registered():
            logger.info("TrustFabric enrollment not present: running service in standalone mode.")
        else:
            logger.warning(f"Refusing to start service: {reason}")
            print(f"[PII Sentinel] Not licensed to run: {reason}")
            sys.exit(1)

    runner = EnforcementServiceRunner(
        port=args.port,
        enable_watcher=not args.no_watcher
    )
    runner.run(with_tray=not args.headless)


if __name__ == "__main__":
    main()
