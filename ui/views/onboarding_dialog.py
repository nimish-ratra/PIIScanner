"""
Onboarding & Privacy Guarantee Modal Dialog
Displayed on first run or on demand to reassure users regarding local-only data privacy.
"""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QCheckBox, QFrame
)
from PySide6.QtCore import Qt
from backend.config import config_manager


class OnboardingDialog(QDialog):
    """First-run onboarding window highlighting offline local execution and features."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Welcome to PII Sentinel")
        self.setFixedSize(540, 480)
        self.setModal(True)
        self._init_ui()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 24)
        layout.setSpacing(16)

        # Header Title
        title = QLabel("🛡️ PII Sentinel", self)
        title.setStyleSheet("font-size: 26px; font-weight: 800; color: #60a5fa;")
        subtitle = QLabel("Local Privacy & Sensitive Document Auditing", self)
        subtitle.setStyleSheet("font-size: 14px; color: #94a3b8; font-weight: 600;")

        layout.addWidget(title)
        layout.addWidget(subtitle)

        # Privacy Guarantee Card
        privacy_card = QFrame(self)
        privacy_card.setStyleSheet(
            "background-color: #0d211a; border: 1px solid #10b981; border-radius: 8px; padding: 14px;"
        )
        p_vbox = QVBoxLayout(privacy_card)
        p_vbox.setSpacing(6)

        lbl_priv_title = QLabel("🔒 100% Local & Offline Privacy Guarantee", privacy_card)
        lbl_priv_title.setStyleSheet("color: #34d399; font-weight: 700; font-size: 14px;")

        lbl_priv_body = QLabel(
            "PII Sentinel processes all documents directly on your machine. "
            "No internet access is required. No telemetry, cloud APIs, or analytics are ever transmitted. "
            "Your confidential documents and PII never leave this device.",
            privacy_card
        )
        lbl_priv_body.setWordWrap(True)
        lbl_priv_body.setStyleSheet("color: #a7f3d0; font-size: 12px; line-height: 1.4;")

        p_vbox.addWidget(lbl_priv_title)
        p_vbox.addWidget(lbl_priv_body)
        layout.addWidget(privacy_card)

        # Feature Highlights
        features_lbl = QLabel("How PII Sentinel Works:", self)
        features_lbl.setStyleSheet("font-weight: 700; color: #f8fafc; font-size: 13px;")
        layout.addWidget(features_lbl)

        bullets = [
            "• <b>Recursive Deep Scanning:</b> Walks through user-selected folders and subfolders.",
            "• <b>Apache Tika Text Extraction:</b> Extracts text from PDFs, DOCX, XLSX, TXT, CSV, and more.",
            "• <b>Microsoft Presidio Engine:</b> Discovers SSNs, emails, credit cards, phones, and names.",
            "• <b>Safe Actions:</b> Review redacted findings, extract flagged files, or isolate into encrypted quarantine archives."
        ]

        for b in bullets:
            lbl = QLabel(b, self)
            lbl.setStyleSheet("color: #cbd5e1; font-size: 12px;")
            layout.addWidget(lbl)

        layout.addStretch()

        # Footer
        footer_layout = QHBoxLayout()
        self.chk_dont_show = QCheckBox("Don't show this screen again on startup", self)
        self.chk_dont_show.setChecked(config_manager.first_run_complete)

        btn_start = QPushButton("Get Started", self)
        btn_start.setObjectName("primaryButton")
        btn_start.setFixedSize(130, 36)
        btn_start.clicked.connect(self._on_start)

        footer_layout.addWidget(self.chk_dont_show)
        footer_layout.addStretch()
        footer_layout.addWidget(btn_start)

        layout.addLayout(footer_layout)

    def _on_start(self) -> None:
        if self.chk_dont_show.isChecked():
            config_manager.first_run_complete = True
            config_manager.save()
        self.accept()
