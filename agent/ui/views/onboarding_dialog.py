"""
Onboarding & Privacy Guarantee Modal Dialog
Displayed on first run or on demand to reassure users regarding local-only data privacy.
"""

from pathlib import Path

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QCheckBox, QFrame
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from backend.config import config_manager
from ui.icons import icon as get_icon


class OnboardingDialog(QDialog):
    """First-run onboarding window highlighting offline local execution and features."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Welcome to CLAISSIFY")
        self.setFixedSize(540, 480)
        self.setModal(True)
        self._init_ui()

    def _init_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 24)
        layout.setSpacing(16)

        # Header Title
        title_row = QHBoxLayout()
        title_row.setSpacing(10)
        lbl_title_icon = QLabel(self)
        lbl_title_icon.setFixedSize(30, 30)
        icon_path = Path(__file__).parent.parent.parent / "packaging" / "assets" / "app_icon.png"
        if icon_path.exists():
            lbl_title_icon.setPixmap(QIcon(str(icon_path)).pixmap(30, 30))
        else:
            lbl_title_icon.setPixmap(get_icon("shield", "#60a5fa", 30).pixmap(30, 30))
        title_row.addWidget(lbl_title_icon)
        title = QLabel("CLAISSIFY", self)
        title.setStyleSheet("font-size: 26px; font-weight: 800; color: #60a5fa; background: transparent;")
        title_row.addWidget(title)
        title_row.addStretch()
        subtitle = QLabel("Local Privacy & Sensitive Document Auditing", self)
        subtitle.setStyleSheet("font-size: 14px; color: #94a3b8; font-weight: 600;")

        layout.addLayout(title_row)
        layout.addWidget(subtitle)

        # Privacy Guarantee Card
        privacy_card = QFrame(self)
        privacy_card.setStyleSheet(
            "background-color: #0d211a; border: 1px solid #10b981; border-radius: 8px; padding: 14px;"
        )
        p_vbox = QVBoxLayout(privacy_card)
        p_vbox.setSpacing(6)

        priv_title_row = QHBoxLayout()
        priv_title_row.setSpacing(6)
        lbl_priv_icon = QLabel(privacy_card)
        lbl_priv_icon.setFixedSize(16, 16)
        lbl_priv_icon.setPixmap(get_icon("lock", "#34d399", 16).pixmap(16, 16))
        priv_title_row.addWidget(lbl_priv_icon)
        lbl_priv_title = QLabel("100% Local & Offline Privacy Guarantee", privacy_card)
        lbl_priv_title.setStyleSheet("color: #34d399; font-weight: 700; font-size: 14px; background: transparent;")
        priv_title_row.addWidget(lbl_priv_title)
        priv_title_row.addStretch()

        lbl_priv_body = QLabel(
            "CLAISSIFY processes all documents directly on your machine. "
            "No internet access is required. No telemetry, cloud APIs, or analytics are ever transmitted. "
            "Your confidential documents and PII never leave this device.",
            privacy_card
        )
        lbl_priv_body.setWordWrap(True)
        lbl_priv_body.setStyleSheet("color: #a7f3d0; font-size: 12px; line-height: 1.4;")

        p_vbox.addLayout(priv_title_row)
        p_vbox.addWidget(lbl_priv_body)
        layout.addWidget(privacy_card)

        # Feature Highlights
        features_lbl = QLabel("How CLAISSIFY Works:", self)
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
