"""
Settings View for PII Sentinel
Manages user preferences, default thresholds, file extensions, max file size,
Tesseract OCR status, Java runtime detection, and application theme.
Persists settings to %APPDATA%/PIISentinel/config.json.
"""

from pathlib import Path
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QSpinBox, QCheckBox, QComboBox,
    QGroupBox, QFileDialog, QMessageBox, QScrollArea, QFrame
)
from PySide6.QtCore import Qt, Signal

from backend.config import config_manager, DEFAULT_EXTENSIONS
from backend.tika_extractor import check_java_status, check_tesseract_status


class SettingsView(QWidget):
    """View allowing configuration and persistence of all application settings."""

    # Emitted when theme is changed
    theme_changed_signal = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._init_ui()
        self.load_settings()

    def _init_ui(self) -> None:
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background: transparent; border: none;")

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(18)

        # Header
        lbl_title = QLabel("Settings & Diagnostics", container)
        lbl_title.setStyleSheet("font-size: 22px; font-weight: 800; color: #f8fafc;")
        lbl_sub = QLabel("Configure scan behavior, file extension filters, system integrations, and appearance.", container)
        lbl_sub.setStyleSheet("font-size: 13px; color: #94a3b8;")

        layout.addWidget(lbl_title)
        layout.addWidget(lbl_sub)

        # 1. Scan Defaults Card
        grp_scan = QGroupBox("Scan Defaults", container)
        vbox_scan = QVBoxLayout(grp_scan)
        vbox_scan.setSpacing(12)

        # Confidence Slider
        thresh_layout = QHBoxLayout()
        thresh_layout.addWidget(QLabel("Default Confidence Threshold:", grp_scan))
        self.lbl_thresh_display = QLabel("0.60 (60%)", grp_scan)
        self.lbl_thresh_display.setStyleSheet("font-weight: 700; color: #60a5fa;")
        thresh_layout.addStretch()
        thresh_layout.addWidget(self.lbl_thresh_display)
        vbox_scan.addLayout(thresh_layout)

        self.slider_thresh = QSlider(Qt.Horizontal, grp_scan)
        self.slider_thresh.setRange(10, 100)
        self.slider_thresh.valueChanged.connect(self._on_thresh_changed)
        vbox_scan.addWidget(self.slider_thresh)

        # Max file size
        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Max File Size to Scan (MB):", grp_scan))
        size_layout.addStretch()
        self.spin_max_size = QSpinBox(grp_scan)
        self.spin_max_size.setRange(1, 1000)
        self.spin_max_size.setValue(50)
        self.spin_max_size.setSuffix(" MB")
        self.spin_max_size.setFixedWidth(110)
        size_layout.addWidget(self.spin_max_size)
        vbox_scan.addLayout(size_layout)

        # Default output folder
        dest_layout = QHBoxLayout()
        dest_layout.addWidget(QLabel("Default Extraction Folder:", grp_scan))
        self.edit_dest = QLineEdit(grp_scan)
        self.edit_dest.setPlaceholderText("Optional default extraction directory...")
        self.btn_pick_dest = QPushButton("Browse...", grp_scan)
        self.btn_pick_dest.clicked.connect(self._on_browse_dest)
        dest_layout.addWidget(self.edit_dest)
        dest_layout.addWidget(self.btn_pick_dest)
        vbox_scan.addLayout(dest_layout)

        layout.addWidget(grp_scan)

        # 2. File Extensions Card
        grp_exts = QGroupBox("Supported File Extensions", container)
        vbox_exts = QVBoxLayout(grp_exts)
        vbox_exts.setSpacing(10)

        vbox_exts.addWidget(QLabel("Comma-separated list of extensions to include in recursive directory scans:", grp_exts))
        self.edit_exts = QLineEdit(grp_exts)
        vbox_exts.addWidget(self.edit_exts)

        btn_reset_exts = QPushButton("Restore Default Extensions", grp_exts)
        btn_reset_exts.setFixedWidth(200)
        btn_reset_exts.clicked.connect(lambda: self.edit_exts.setText(", ".join(DEFAULT_EXTENSIONS)))
        vbox_exts.addWidget(btn_reset_exts)

        layout.addWidget(grp_exts)

        # 3. System Integrations & Health Check
        grp_sys = QGroupBox("System Health & Integration", container)
        vbox_sys = QVBoxLayout(grp_sys)
        vbox_sys.setSpacing(12)

        # Java Runtime Status
        java_info = check_java_status()
        java_box = QHBoxLayout()
        java_box.addWidget(QLabel("Apache Tika Java Backend:", grp_sys))
        java_badge = QLabel(
            f"  {java_info.get('version', 'Unknown')}  " if java_info.get("available") else "  Java Not Found  ",
            grp_sys
        )
        if java_info.get("available"):
            java_badge.setStyleSheet("background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; padding: 4px 8px; font-weight: bold;")
            java_badge.setToolTip(f"Executable: {java_info.get('path')}")
        else:
            java_badge.setStyleSheet("background: rgba(239, 68, 68, 0.2); color: #f87171; border-radius: 4px; padding: 4px 8px; font-weight: bold;")
            java_badge.setToolTip(java_info.get("message", ""))
        java_box.addStretch()
        java_box.addWidget(java_badge)
        vbox_sys.addLayout(java_box)

        # OCR / Tesseract Toggle
        tess_info = check_tesseract_status()
        self.chk_ocr = QCheckBox("Enable OCR for Scanned Image PDFs (Tesseract)", grp_sys)
        self.chk_ocr.stateChanged.connect(self._on_ocr_toggled)
        vbox_sys.addWidget(self.chk_ocr)

        self.lbl_ocr_status = QLabel(grp_sys)
        self.lbl_ocr_status.setStyleSheet("font-size: 11px; color: #94a3b8; margin-left: 26px;")
        if tess_info.get("available"):
            self.lbl_ocr_status.setText(f"Tesseract OCR detected: {tess_info.get('version')} ({tess_info.get('path')})")
        else:
            self.lbl_ocr_status.setText("Tesseract OCR is not detected on this machine. Scanned PDFs will be extracted without OCR.")
        vbox_sys.addWidget(self.lbl_ocr_status)

        layout.addWidget(grp_sys)

        # 4. Appearance Card
        grp_app = QGroupBox("Appearance", container)
        vbox_app = QVBoxLayout(grp_app)

        theme_box = QHBoxLayout()
        theme_box.addWidget(QLabel("Interface Theme:", grp_app))
        self.combo_theme = QComboBox(grp_app)
        self.combo_theme.addItems(["Dark", "Light"])
        self.combo_theme.setFixedWidth(120)
        theme_box.addStretch()
        theme_box.addWidget(self.combo_theme)
        vbox_app.addLayout(theme_box)

        layout.addWidget(grp_app)

        # 5. Buttons Footer
        footer_box = QHBoxLayout()
        self.btn_save = QPushButton("Save Settings", container)
        self.btn_save.setObjectName("primaryButton")
        self.btn_save.setFixedWidth(140)
        self.btn_save.clicked.connect(self.save_settings)

        self.btn_reset = QPushButton("Reset to Defaults", container)
        self.btn_reset.setFixedWidth(160)
        self.btn_reset.clicked.connect(self.reset_defaults)

        footer_box.addWidget(self.btn_save)
        footer_box.addWidget(self.btn_reset)
        footer_box.addStretch()

        layout.addLayout(footer_box)
        layout.addStretch()

        scroll.setWidget(container)
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(scroll)

    def _on_thresh_changed(self, val: int) -> None:
        self.lbl_thresh_display.setText(f"{val/100.0:.2f} ({val}%)")

    def _on_browse_dest(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select Default Extraction Folder", self.edit_dest.text())
        if path:
            self.edit_dest.setText(path)

    def _on_ocr_toggled(self, state: int) -> None:
        if self.chk_ocr.isChecked():
            tess_info = check_tesseract_status()
            if not tess_info.get("available"):
                QMessageBox.warning(
                    self, "Tesseract Not Found",
                    "Tesseract OCR was not found in standard system locations.\n"
                    "Please install Tesseract OCR on Windows if you need to extract text from scanned image PDFs."
                )

    def load_settings(self) -> None:
        """Populate controls with current config_manager settings."""
        thresh_pct = int(config_manager.confidence_threshold * 100)
        self.slider_thresh.setValue(thresh_pct)
        self.lbl_thresh_display.setText(f"{config_manager.confidence_threshold:.2f} ({thresh_pct}%)")

        self.spin_max_size.setValue(config_manager.max_file_size_mb)
        self.edit_dest.setText(config_manager.default_output_folder)
        self.edit_exts.setText(", ".join(config_manager.supported_extensions))
        self.chk_ocr.setChecked(config_manager.ocr_enabled)

        theme_curr = config_manager.theme.capitalize()
        self.combo_theme.setCurrentText(theme_curr if theme_curr in ["Dark", "Light"] else "Dark")

    def save_settings(self) -> None:
        """Write user selections to config_manager."""
        config_manager.confidence_threshold = self.slider_thresh.value() / 100.0
        config_manager.max_file_size_mb = self.spin_max_size.value()
        config_manager.default_output_folder = self.edit_dest.text().strip()

        # Parse extensions
        exts_text = self.edit_exts.text()
        parsed_exts = [
            e.strip() if e.strip().startswith(".") else f".{e.strip()}"
            for e in exts_text.split(",") if e.strip()
        ]
        if parsed_exts:
            config_manager.supported_extensions = parsed_exts

        config_manager.ocr_enabled = self.chk_ocr.isChecked()

        selected_theme = self.combo_theme.currentText().lower()
        if selected_theme != config_manager.theme:
            config_manager.theme = selected_theme
            self.theme_changed_signal.emit(selected_theme)

        config_manager.save()
        QMessageBox.information(self, "Settings Saved", "Preferences successfully persisted.")

    def reset_defaults(self) -> None:
        confirm = QMessageBox.question(
            self, "Reset Defaults",
            "Reset all settings to initial factory defaults?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            config_manager.reset_to_defaults()
            self.load_settings()
            self.theme_changed_signal.emit(config_manager.theme)
            QMessageBox.information(self, "Reset Complete", "Settings have been reset to defaults.")
