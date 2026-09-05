"""
Log Console Viewer Component
Displays live streaming log records with color-coded severity levels.
"""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QPlainTextEdit
from PySide6.QtGui import QTextCursor, QColor
from PySide6.QtCore import Qt


class LogViewer(QWidget):
    """Real-time log console widget."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._init_ui()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Header bar with title and clear button
        header_layout = QHBoxLayout()
        self.lbl_title = QLabel("Live Activity Log", self)
        self.lbl_title.setStyleSheet("font-weight: 700; color: #94a3b8; font-size: 12px;")

        self.btn_clear = QPushButton("Clear Console", self)
        self.btn_clear.setFixedHeight(24)
        self.btn_clear.setStyleSheet("font-size: 11px; padding: 2px 8px;")
        self.btn_clear.clicked.connect(self.clear)

        header_layout.addWidget(self.lbl_title)
        header_layout.addStretch()
        header_layout.addWidget(self.btn_clear)

        # Console text edit
        self.console = QPlainTextEdit(self)
        self.console.setObjectName("logConsole")
        self.console.setReadOnly(True)
        self.console.setMaximumBlockCount(1000)

        layout.addLayout(header_layout)
        layout.addWidget(self.console)

    def append_log(self, message: str, level: str = "INFO") -> None:
        """Append a log line with severity formatting."""
        level_upper = level.upper()
        if "ERROR" in level_upper:
            prefix = "[ERROR] "
            color = "#f87171"
        elif "WARN" in level_upper:
            prefix = "[WARN]  "
            color = "#fbbf24"
        else:
            prefix = "[INFO]  "
            color = "#94a3b8"

        line = f"<span style='color: {color};'>{prefix}</span> <span style='color: #e2e8f0;'>{message}</span>"
        self.console.appendHtml(line)
        self.console.moveCursor(QTextCursor.End)

    def clear(self) -> None:
        """Clear console content."""
        self.console.clear()
