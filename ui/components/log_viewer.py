"""
Log Console Viewer Component
Displays live streaming log records with color-coded severity levels
and theme-adaptive enterprise typography.
"""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QPlainTextEdit
from PySide6.QtGui import QTextCursor
from PySide6.QtCore import Qt


class LogViewer(QWidget):
    """Real-time log console widget."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_collapsed = False
        self._init_ui()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Header bar with title, toggle and clear button
        header_layout = QHBoxLayout()
        header_layout.setContentsMargins(0, 0, 0, 0)

        self.lbl_title = QLabel("🖥️ Live Activity & Audit Log", self)
        self.lbl_title.setStyleSheet("font-weight: 700; font-size: 12px;")

        self.btn_toggle = QPushButton("Minimize Log", self)
        self.btn_toggle.setFixedHeight(26)
        self.btn_toggle.setStyleSheet("font-size: 11px; padding: 2px 10px;")
        self.btn_toggle.clicked.connect(self._toggle_collapse)

        self.btn_clear = QPushButton("Clear Console", self)
        self.btn_clear.setFixedHeight(26)
        self.btn_clear.setStyleSheet("font-size: 11px; padding: 2px 10px;")
        self.btn_clear.clicked.connect(self.clear)

        header_layout.addWidget(self.lbl_title)
        header_layout.addStretch()
        header_layout.addWidget(self.btn_toggle)
        header_layout.addWidget(self.btn_clear)

        # Console text edit
        self.console = QPlainTextEdit(self)
        self.console.setObjectName("logConsole")
        self.console.setReadOnly(True)
        self.console.setMaximumBlockCount(1000)
        self.console.setMinimumHeight(100)
        self.console.document().setDocumentMargin(6)
        self.console.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.console.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        layout.addLayout(header_layout)
        layout.addWidget(self.console)

    def _toggle_collapse(self) -> None:
        """Toggle console visibility."""
        self._is_collapsed = not self._is_collapsed
        self.console.setVisible(not self._is_collapsed)
        self.btn_toggle.setText("Expand Log" if self._is_collapsed else "Minimize Log")

    def append_log(self, message: str, level: str = "INFO") -> None:
        """Append a log line with theme-adaptive severity formatting."""
        level_upper = level.upper()
        if "ERROR" in level_upper:
            prefix = "[ERROR]"
            color = "#ef4444"
        elif "WARN" in level_upper:
            prefix = "[WARN] "
            color = "#f59e0b"
        elif "SUCCESS" in level_upper:
            prefix = "[OK]   "
            color = "#10b981"
        else:
            prefix = "[INFO] "
            color = "#3b82f6"

        # Do not hardcode message text color so it inherits theme-appropriate text color
        line = f"<span style='color: {color}; font-weight: 700; font-family: monospace;'>{prefix}</span> <span>{message}</span>"
        self.console.appendHtml(line)
        sb = self.console.verticalScrollBar()
        if sb:
            sb.setValue(sb.maximum())

    def clear(self) -> None:
        """Clear console content."""
        self.console.clear()
