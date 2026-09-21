"""
License Activation Dialog
Prompts for a TrustFabric enrollment token and redeems it via
backend/license_client.register() to bind this device to a licensed seat.
"""

import logging

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QLineEdit, QFrame
)
from PySide6.QtCore import Qt

from backend import license_client
from ui.icons import icon as get_icon

logger = logging.getLogger("pii_sentinel.ui.activation")


class ActivationDialog(QDialog):
    """Modal dialog for redeeming an enrollment token against TrustFabric."""

    def __init__(self, parent=None, allow_skip: bool = True):
        super().__init__(parent)
        self.setWindowTitle("Activate CLAISSIFY")
        self.setFixedSize(480, 380)
        self.setModal(True)
        self._allow_skip = allow_skip
        self._init_ui()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 24)
        layout.setSpacing(14)

        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        lbl_title_icon = QLabel(self)
        lbl_title_icon.setFixedSize(22, 22)
        lbl_title_icon.setPixmap(get_icon("key-round", "#60a5fa", 22).pixmap(22, 22))
        title_row.addWidget(lbl_title_icon)
        title = QLabel("Activate Your License", self)
        title.setStyleSheet("font-size: 20px; font-weight: 800; color: #60a5fa; background: transparent;")
        title_row.addWidget(title)
        title_row.addStretch()
        subtitle = QLabel(
            "Enter the enrollment token provided by your organization's administrator "
            "to bind this device to a licensed seat.",
            self,
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("font-size: 12px; color: #94a3b8;")

        layout.addLayout(title_row)
        layout.addWidget(subtitle)

        self.edit_token = QLineEdit(self)
        self.edit_token.setPlaceholderText("Enrollment token")
        self.edit_token.setStyleSheet("padding: 8px; font-size: 13px;")
        layout.addWidget(self.edit_token)

        self.edit_name = QLineEdit(self)
        self.edit_name.setPlaceholderText("Your full name")
        self.edit_name.setStyleSheet("padding: 8px; font-size: 13px;")
        layout.addWidget(self.edit_name)

        self.edit_email = QLineEdit(self)
        self.edit_email.setPlaceholderText("Company email address")
        self.edit_email.setStyleSheet("padding: 8px; font-size: 13px;")
        layout.addWidget(self.edit_email)

        self.lbl_status = QLabel("", self)
        self.lbl_status.setWordWrap(True)
        self.lbl_status.setStyleSheet("font-size: 12px;")
        layout.addWidget(self.lbl_status)

        layout.addStretch()

        divider = QFrame(self)
        divider.setFrameShape(QFrame.HLine)
        layout.addWidget(divider)

        footer_layout = QHBoxLayout()
        if self._allow_skip:
            self.btn_skip = QPushButton("Activate Later", self)
            self.btn_skip.clicked.connect(self.reject)
            footer_layout.addWidget(self.btn_skip)

        footer_layout.addStretch()

        self.btn_activate = QPushButton("Activate", self)
        self.btn_activate.setObjectName("primaryButton")
        self.btn_activate.setFixedSize(120, 36)
        self.btn_activate.clicked.connect(self._on_activate)
        footer_layout.addWidget(self.btn_activate)

        layout.addLayout(footer_layout)

    def _set_busy(self, busy: bool) -> None:
        self.btn_activate.setEnabled(not busy)
        self.edit_token.setEnabled(not busy)
        self.edit_name.setEnabled(not busy)
        self.edit_email.setEnabled(not busy)
        if hasattr(self, "btn_skip"):
            self.btn_skip.setEnabled(not busy)

    def _on_activate(self) -> None:
        token = self.edit_token.text().strip()
        name = self.edit_name.text().strip()
        email = self.edit_email.text().strip()

        if not token:
            self.lbl_status.setStyleSheet("font-size: 12px; color: #f87171;")
            self.lbl_status.setText("Please enter an enrollment token.")
            return
        if not name:
            self.lbl_status.setStyleSheet("font-size: 12px; color: #f87171;")
            self.lbl_status.setText("Please enter your full name.")
            return
        if not email:
            self.lbl_status.setStyleSheet("font-size: 12px; color: #f87171;")
            self.lbl_status.setText("Please enter your company email address.")
            return

        self._set_busy(True)
        self.lbl_status.setStyleSheet("font-size: 12px; color: #94a3b8;")
        self.lbl_status.setText("Activating…")
        # A blocking call is acceptable here — this is an explicit, one-time,
        # user-initiated action with a short request timeout, not a background path.
        from PySide6.QtWidgets import QApplication
        QApplication.processEvents()

        try:
            result_state = license_client.register(token, employee_name=name, employee_email=email)
            if result_state.get("lastPolicy", {}).get("status") == "PENDING":
                self.lbl_status.setStyleSheet("font-size: 12px; color: #fbbf24;")
                self.lbl_status.setText(
                    "Request submitted — waiting for your Company Admin to approve it."
                )
            else:
                self.lbl_status.setStyleSheet("font-size: 12px; color: #34d399;")
                self.lbl_status.setText("Activated successfully.")
            QApplication.processEvents()
            self.accept()
        except license_client.LicenseError as e:
            logger.warning(f"Activation rejected: {e}")
            self.lbl_status.setStyleSheet("font-size: 12px; color: #f87171;")
            self.lbl_status.setText(str(e))
            self._set_busy(False)
        except Exception as e:
            logger.warning(f"Activation failed (network/connectivity): {e}")
            self.lbl_status.setStyleSheet("font-size: 12px; color: #f87171;")
            self.lbl_status.setText(
                "Could not reach the licensing server. Check your connection and try again."
            )
            self._set_busy(False)
