"""
PII Sentinel - Application Entry Point
Forwards execution to agent/main.py when organized under the agent/ structure,
or runs locally when in standalone root mode.
"""

import os
import sys
from pathlib import Path

# Ensure sys.stdout and sys.stderr are valid writable streams in PyInstaller windowed mode (console=False)
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

PROJECT_ROOT = Path(__file__).parent.resolve()
AGENT_DIR = PROJECT_ROOT / "agent"

if AGENT_DIR.exists() and (AGENT_DIR / "main.py").exists():
    agent_str = str(AGENT_DIR)
    if agent_str not in sys.path:
        sys.path.insert(0, agent_str)
    root_str = str(PROJECT_ROOT)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    from agent.main import main
    main()
else:
    from backend.logger import setup_logger
    from backend.tika_extractor import configure_java_environment
    from ui.main_window import MainWindow
    from PySide6.QtWidgets import QApplication

    configure_java_environment()
    app = QApplication.instance() or QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
