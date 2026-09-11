"""
PII Sentinel Service Controller
Provides programmatic start, stop, probe, and status inspection for the
localhost classification microservice (FastAPI on 127.0.0.1:47821) and File Watcher.
Works seamlessly from GUI, CLI, or test suites.
"""

import os
import sys
import time
import json
import logging
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any, Optional

from backend.service_auth import TOKEN_HEADER, get_or_create_service_token

logger = logging.getLogger("pii_sentinel.service_controller")

DEFAULT_PORT = 47821


class ServiceController:
    """Manages background service lifecycle and health checks."""
    _process: Optional[subprocess.Popen] = None

    @classmethod
    def is_port_listening(cls, port: int = DEFAULT_PORT) -> bool:
        """Fast non-blocking check (timeout 0.03s) if 127.0.0.1:{port} has an active listener."""
        import socket
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.03)
                return s.connect_ex(("127.0.0.1", port)) == 0
        except Exception:
            return False

    @classmethod
    def get_health(cls, port: int = DEFAULT_PORT) -> Dict[str, Any]:
        """Probe the service /health endpoint on 127.0.0.1 with fast pre-check."""
        if not cls.is_port_listening(port):
            return {"running": False, "data": {}}

        url = f"http://127.0.0.1:{port}/health"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "PIISentinel-Controller",
                    TOKEN_HEADER: get_or_create_service_token()
                }
            )
            with urllib.request.urlopen(req, timeout=0.3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return {"running": True, "data": data}
        except Exception:
            pass
        return {"running": False, "data": {}}

    @classmethod
    def is_running(cls, port: int = DEFAULT_PORT) -> bool:
        """Check if the background microservice is currently running and healthy."""
        return cls.get_health(port).get("running", False)

    @classmethod
    def is_port_bound(cls, port: int = DEFAULT_PORT) -> bool:
        """Check if port 47821 has any listening socket bound."""
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            try:
                s.bind(("127.0.0.1", port))
                return False
            except OSError:
                return True

    @classmethod
    def _cleanup_port(cls, port: int = DEFAULT_PORT) -> None:
        """Kill any process holding the port on Windows."""
        if sys.platform == "win32":
            try:
                cmd = f'powershell -Command "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force }}"'
                subprocess.run(cmd, shell=True, timeout=4, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                logger.warning(f"Port cleanup warning: {e}")

    @classmethod
    def start(cls, port: int = DEFAULT_PORT) -> bool:
        """
        Start the service runner in a detached background process.
        Idempotent: returns True immediately if already running and healthy.
        """
        if cls.is_running(port):
            return True

        # If port is bound by a zombie process that isn't responding to /health, clean it
        if cls.is_port_bound(port):
            logger.info(f"Port {port} bound by unresponsive process; clearing before start.")
            cls._cleanup_port(port)
            time.sleep(0.5)

        project_root = Path(__file__).parent.parent.resolve()
        python_exe = sys.executable

        env = os.environ.copy()
        env["PYTHONPATH"] = str(project_root)

        flags = 0
        if sys.platform == "win32":
            flags = subprocess.CREATE_NO_WINDOW

        try:
            cls._process = subprocess.Popen(
                [python_exe, "-m", "service.service_runner"],
                cwd=str(project_root),
                env=env,
                creationflags=flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            # Wait up to 8 seconds for health endpoint to respond
            for _ in range(40):
                time.sleep(0.2)
                if cls.is_running(port):
                    logger.info(f"Service started successfully on port {port} (PID: {cls._process.pid})")
                    return True
        except Exception as e:
            logger.error(f"Failed to launch service process: {e}")

        return cls.is_running(port)

    @classmethod
    def stop(cls, port: int = DEFAULT_PORT) -> bool:
        """
        Stop the background service gracefully and idempotently.
        Tears down both Uvicorn and Watchdog observer.
        Returns True if service has stopped.
        """
        # If already completely stopped and port free, return True immediately
        if not cls.is_running(port) and not cls.is_port_bound(port):
            cls._process = None
            return True

        # 1. Attempt graceful HTTP call to /service/stop
        if cls.is_running(port):
            try:
                url = f"http://127.0.0.1:{port}/service/stop"
                req = urllib.request.Request(
                    url,
                    data=b"{}",
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "PIISentinel-Controller",
                        TOKEN_HEADER: get_or_create_service_token()
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=1.5) as resp:
                    pass
            except Exception:
                pass

        # Wait up to 1.5s for graceful HTTP shutdown
        for _ in range(15):
            time.sleep(0.1)
            if not cls.is_running(port) and not cls.is_port_bound(port):
                cls._process = None
                return True

        # 2. Terminate tracked subprocess if still alive
        if cls._process:
            try:
                cls._process.terminate()
                cls._process.wait(timeout=1.0)
            except Exception:
                try:
                    cls._process.kill()
                except Exception:
                    pass
            cls._process = None

        # 3. If port is STILL bound, force cleanup via PowerShell
        if cls.is_port_bound(port):
            cls._cleanup_port(port)

        # 4. Final verification polling
        for _ in range(20):
            if not cls.is_running(port) and not cls.is_port_bound(port):
                return True
            time.sleep(0.1)

        return not cls.is_running(port)

    @classmethod
    def test_pre_save_probe(cls, sample_text: str = "Aadhaar: 3675 9834 5012, PAN: ABCDE1234F", port: int = DEFAULT_PORT) -> Dict[str, Any]:
        """Send a quick classification probe to test pre-save interception response."""
        url = f"http://127.0.0.1:{port}/classify/text"
        payload = json.dumps({"text": sample_text, "source_hint": "Live Probe Test"}).encode("utf-8")
        try:
            start_t = time.perf_counter()
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "PIISentinel-Probe",
                    TOKEN_HEADER: get_or_create_service_token()
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                elapsed_ms = (time.perf_counter() - start_t) * 1000
                data = json.loads(resp.read().decode("utf-8"))
                return {
                    "success": True,
                    "elapsed_ms": round(elapsed_ms, 2),
                    "tier": data.get("tier"),
                    "action": data.get("recommended_action"),
                    "findings_count": len(data.get("findings", [])),
                    "rationale": data.get("rationale")
                }
        except Exception as e:
            return {"success": False, "error": str(e)}
