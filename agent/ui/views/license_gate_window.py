"""
License Gate Window
The top-level window shown instead of MainWindow whenever
license_client.enforcement_status() says the app isn't allowed to run.
Stays open, periodically re-checks in the background, and hands off to the
caller-provided callback the moment it becomes licensed — no relaunch needed.
Deliberately built as its own lightweight window rather than a view inside
MainWindow, so the (heavy) scanning UI is never constructed while unlicensed.
"""

import logging
from datetime import datetime
from typing import Callable

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QFrame,
)
from PySide6.QtCore import Qt, QTimer

from backend import license_client
from ui.views.activation_dialog import ActivationDialog
from ui.icons import icon as get_icon

logger = logging.getLogger("pii_sentinel.ui.license_gate")

# How often this window re-checks on its own while visible. Distinct from
# (and much shorter than) the background service's own heartbeat cadence —
# this window is only ever open while someone is actively looking at it, so
# a shorter interval here is a reasonable, low-volume tradeoff for feeling
# responsive rather than needing a manual click every time.
AUTO_REFRESH_INTERVAL_MS = 30_000

_STATUS_STYLES = {
    "pending": ("#fbbf24", "clock"),
    "blocked": ("#f87171", "ban"),
    "unknown": ("#94a3b8", "lock"),
}


class LicenseGateWindow(QWidget):
    """Shown instead of MainWindow while unlicensed. Calls on_licensed() and
    closes itself the moment enforcement_status() says access is allowed."""

    def __init__(self, on_licensed: Callable[[], None]):
        super().__init__()
        self._on_licensed = on_licensed
        self.setWindowTitle("CLAISSIFY — License Required")
        self.setFixedSize(480, 400)
        self._init_ui()

        self._timer = QTimer(self)
        self._timer.timeout.connect(self._refresh)
        self._timer.start(AUTO_REFRESH_INTERVAL_MS)

        self._refresh(initial=True)

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 24)
        layout.setSpacing(14)

        self.lbl_icon = QLabel(self)
        self.lbl_icon.setPixmap(get_icon("lock", "#94a3b8", 40).pixmap(40, 40))
        self.lbl_icon.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.lbl_icon)

        self.lbl_title = QLabel("License Required", self)
        self.lbl_title.setStyleSheet("font-size: 18px; font-weight: 800; color: #f8fafc;")
        self.lbl_title.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.lbl_title)

        self.lbl_reason = QLabel("", self)
        self.lbl_reason.setWordWrap(True)
        self.lbl_reason.setAlignment(Qt.AlignCenter)
        self.lbl_reason.setStyleSheet("font-size: 13px; color: #cbd5e1;")
        layout.addWidget(self.lbl_reason)

        layout.addStretch()

        self.lbl_last_checked = QLabel("", self)
        self.lbl_last_checked.setAlignment(Qt.AlignCenter)
        self.lbl_last_checked.setStyleSheet("font-size: 11px; color: #64748b;")
        layout.addWidget(self.lbl_last_checked)

        divider = QFrame(self)
        divider.setFrameShape(QFrame.HLine)
        layout.addWidget(divider)

        footer_layout = QHBoxLayout()

        self.btn_activate = QPushButton("Activate…", self)
        self.btn_activate.clicked.connect(self._open_activation_dialog)
        footer_layout.addWidget(self.btn_activate)

        self.btn_standalone = QPushButton("Continue Standalone", self)
        self.btn_standalone.setToolTip("Run ClAIssify in standalone local endpoint mode")
        self.btn_standalone.clicked.connect(self._continue_standalone)
        footer_layout.addWidget(self.btn_standalone)

        footer_layout.addStretch()

        self.btn_refresh = QPushButton("Check Now", self)
        self.btn_refresh.setObjectName("primaryButton")
        self.btn_refresh.clicked.connect(lambda: self._refresh(initial=False))
        footer_layout.addWidget(self.btn_refresh)

        layout.addLayout(footer_layout)

    def _continue_standalone(self) -> None:
        """Launch the main window in standalone offline/evaluation mode."""
        self._timer.stop()
        self._on_licensed()
        self.close()

    def _open_activation_dialog(self) -> None:
        dlg = ActivationDialog(self, allow_skip=True)
        dlg.exec()
        self._refresh(initial=False)

    def _refresh(self, initial: bool = False) -> None:
        """Re-checks license status. If registered, first tries a live
        heartbeat so a just-approved/just-revoked change on the server is
        picked up immediately rather than waiting on cached state; a failed
        heartbeat (offline) is not fatal — enforcement_status() below falls
        back to the existing grace-period rules on the last-known state."""
        if license_client.is_registered():
            try:
                license_client.heartbeat()
            except Exception as e:
                logger.debug(f"License gate heartbeat failed (using cached state): {e}")

        allowed, reason = license_client.enforcement_status()
        self.lbl_last_checked.setText(f"Last checked: {datetime.now().strftime('%I:%M:%S %p')}")

        if allowed:
            self._timer.stop()
            self._on_licensed()
            self.close()
            return

        self._render_reason(reason)

    def _render_reason(self, reason: str) -> None:
        if not license_client.is_registered():
            style = "unknown"
            self.btn_activate.setText("Activate…")
        elif reason == "Awaiting admin approval":
            style = "pending"
            self.btn_activate.setText("Use a Different Token…")
        else:
            style = "blocked"
            self.btn_activate.setText("Use a Different Token…")

        color, icon_name = _STATUS_STYLES[style]
        self.lbl_icon.setPixmap(get_icon(icon_name, color, 40).pixmap(40, 40))
        self.lbl_reason.setStyleSheet(f"font-size: 13px; color: {color};")
        self.lbl_reason.setText(reason)
