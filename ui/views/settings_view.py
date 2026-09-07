"""
Settings View for PII Sentinel
Manages user preferences, default thresholds, file extensions, max file size,
Tesseract OCR status, Java runtime detection, application theme, and
Phase 2 Real-Time Save Enforcement Policies.
Persists settings to %APPDATA%/PIISentinel/config.json and enforcement_policy.json.
"""

import sys
import json
import urllib.request
import winreg
from pathlib import Path
from typing import Dict, Any, List

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QSpinBox, QCheckBox, QComboBox,
    QGroupBox, QFileDialog, QMessageBox, QScrollArea, QFrame,
    QTabWidget, QListWidget, QListWidgetItem, QGridLayout
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor

from backend.config import config_manager, DEFAULT_EXTENSIONS
from backend.tika_extractor import check_java_status, check_tesseract_status
from backend.classifier import TIER_METADATA, SensitivityTier
from service.enforcement_policy import (
    policy_manager, DEFAULT_TIER_ACTIONS, get_default_watched_folders, EnforcementAction
)


class SettingsView(QWidget):
    """View allowing configuration and persistence of all application settings."""

    # Emitted when theme is changed
    theme_changed_signal = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.tier_combos: Dict[str, QComboBox] = {}
        self._init_ui()
        self.load_settings()
        self.load_enforcement_settings()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(14)

        # Header
        lbl_title = QLabel("Settings & Diagnostics", self)
        lbl_title.setStyleSheet("font-size: 22px; font-weight: 800; color: #f8fafc;")
        lbl_sub = QLabel("Configure scan behavior, real-time sensitivity tier policies, watched folders, and system integrations.", self)
        lbl_sub.setStyleSheet("font-size: 13px; color: #94a3b8;")

        main_layout.addWidget(lbl_title)
        main_layout.addWidget(lbl_sub)

        # Tabs
        self.tabs = QTabWidget(self)

        # Tab 1: General Settings
        tab_general = self._create_general_tab()
        self.tabs.addTab(tab_general, "⚙️ General & Scan Defaults")

        # Tab 2: Enforcement Policy
        tab_enforcement = self._create_enforcement_tab()
        self.tabs.addTab(tab_enforcement, "🛡️ Real-Time Enforcement Policy")

        main_layout.addWidget(self.tabs)

    def _create_general_tab(self) -> QWidget:
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background: transparent; border: none;")

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(18)

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

        # Concurrent Workers
        workers_layout = QHBoxLayout()
        workers_layout.addWidget(QLabel("Default Concurrent Workers (1–8):", grp_scan))
        workers_layout.addStretch()
        self.spin_workers = QSpinBox(grp_scan)
        self.spin_workers.setRange(1, 8)
        self.spin_workers.setValue(config_manager.max_workers)
        self.spin_workers.setSuffix(" threads")
        self.spin_workers.setFixedWidth(110)
        workers_layout.addWidget(self.spin_workers)
        vbox_scan.addLayout(workers_layout)

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
        grp_app = QGroupBox("Appearance & Display", container)
        vbox_app = QVBoxLayout(grp_app)
        vbox_app.setSpacing(10)

        theme_box = QHBoxLayout()
        theme_box.addWidget(QLabel("Interface Theme Mode:", grp_app))
        self.combo_theme = QComboBox(grp_app)
        self.combo_theme.addItems(["Dark", "Light"])
        self.combo_theme.setFixedWidth(140)
        self.combo_theme.currentIndexChanged.connect(self._on_theme_combo_changed)
        theme_box.addStretch()
        theme_box.addWidget(self.combo_theme)
        vbox_app.addLayout(theme_box)

        theme_hint = QLabel("Switch between Obsidian Slate (Dark) and Studio Slate (Light) themes instantly.", grp_app)
        theme_hint.setStyleSheet("color: #64748b; font-size: 11px;")
        vbox_app.addWidget(theme_hint)

        layout.addWidget(grp_app)

        # Footer Buttons
        footer_box = QHBoxLayout()
        self.btn_save = QPushButton("Save General Settings", container)
        self.btn_save.setObjectName("primaryButton")
        self.btn_save.setFixedWidth(170)
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
        return scroll

    def _create_enforcement_tab(self) -> QWidget:
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background: transparent; border: none;")

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(18)

        # Notice Card
        notice_box = QFrame(container)
        notice_box.setStyleSheet("""
            QFrame {
                background-color: rgba(37, 99, 235, 0.1);
                border: 1px solid rgba(59, 130, 246, 0.3);
                border-radius: 8px;
                padding: 12px;
            }
        """)
        notice_layout = QVBoxLayout(notice_box)
        notice_lbl = QLabel(
            "<b>🛡️ Phase 2 Real-Time Save Enforcement</b><br>"
            "Intercepts Microsoft Word & Excel document saves in memory (true pre-save block), "
            "and monitors user folders (Desktop, Documents, Downloads) for detect-and-remediate quarantine.<br>"
            "<span style='color: #38bdf8;'>100% Air-Gapped: Bound strictly to 127.0.0.1, zero cloud transmission, zero telemetry.</span>",
            notice_box
        )
        notice_lbl.setTextFormat(Qt.RichText)
        notice_lbl.setStyleSheet("color: #e2e8f0; font-size: 12px; line-height: 1.4;")
        notice_layout.addWidget(notice_lbl)
        layout.addWidget(notice_box)

        # 1. Tier Action Mapping Card
        grp_tiers = QGroupBox("Purview Sensitivity Tier Actions", container)
        vbox_tiers = QVBoxLayout(grp_tiers)
        vbox_tiers.setSpacing(10)

        tier_desc = QLabel(
            "Define the mandatory enforcement action when document content triggers a Purview Sensitivity Tier:",
            grp_tiers
        )
        tier_desc.setStyleSheet("color: #94a3b8; font-size: 12px;")
        vbox_tiers.addWidget(tier_desc)

        grid_tiers = QGridLayout()
        grid_tiers.setSpacing(10)
        grid_tiers.setContentsMargins(0, 8, 0, 8)

        tier_list = [
            SensitivityTier.RESTRICTED,
            SensitivityTier.HIGHLY_CONFIDENTIAL,
            SensitivityTier.CONFIDENTIAL,
            SensitivityTier.GENERAL,
            SensitivityTier.PUBLIC,
        ]

        action_options = [
            (EnforcementAction.BLOCK.value, "Block Save (Office Documents)"),
            (EnforcementAction.QUARANTINE.value, "Quarantine File (AES-256 Encrypted)"),
            (EnforcementAction.WARN.value, "Warn User (Allow Save with Override)"),
            (EnforcementAction.ALLOW.value, "Allow Unrestricted"),
        ]

        for row_idx, tier in enumerate(tier_list):
            meta = TIER_METADATA.get(tier, {})
            lbl_badge = QLabel(f"{meta.get('badge_emoji', '⚪')} {tier.value}", grp_tiers)
            lbl_badge.setStyleSheet(f"font-weight: 700; color: {meta.get('color_hex', '#94a3b8')}; font-size: 13px;")

            combo_action = QComboBox(grp_tiers)
            for act_val, act_label in action_options:
                combo_action.addItem(act_label, act_val)

            grid_tiers.addWidget(lbl_badge, row_idx, 0)
            grid_tiers.addWidget(combo_action, row_idx, 1)
            self.tier_combos[tier.value] = combo_action

        vbox_tiers.addLayout(grid_tiers)

        btn_reset_tiers = QPushButton("Restore Default Tier Policy", grp_tiers)
        btn_reset_tiers.setFixedWidth(200)
        btn_reset_tiers.clicked.connect(self._on_restore_default_tiers)
        vbox_tiers.addWidget(btn_reset_tiers)

        layout.addWidget(grp_tiers)

        # 2. Fail-Safe Mode & Local Microservice Card
        grp_failsafe = QGroupBox("Fail-Safe Policy & Local Service", container)
        vbox_failsafe = QVBoxLayout(grp_failsafe)
        vbox_failsafe.setSpacing(12)

        failsafe_box = QHBoxLayout()
        lbl_fs = QLabel("Add-In & Watcher Fail-Safe Mode:", grp_failsafe)
        failsafe_box.addWidget(lbl_fs)

        self.combo_failsafe = QComboBox(grp_failsafe)
        self.combo_failsafe.addItem("Fail-Closed (Default — Block save if service is unreachable)", False)
        self.combo_failsafe.addItem("Fail-Open (Permissive — Allow save if service is unreachable)", True)
        self.combo_failsafe.setMinimumWidth(380)
        failsafe_box.addWidget(self.combo_failsafe)
        failsafe_box.addStretch()
        vbox_failsafe.addLayout(failsafe_box)

        lbl_fs_hint = QLabel(
            "• <b>Fail-Closed</b>: Recommended for high-security environments. Prevents accidental PII leaks if service is restarting.<br>"
            "• <b>Fail-Open</b>: Recommended for uninterrupted workflow if you frequently stop local developer services.",
            grp_failsafe
        )
        lbl_fs_hint.setStyleSheet("color: #64748b; font-size: 11px;")
        vbox_failsafe.addWidget(lbl_fs_hint)

        port_box = QHBoxLayout()
        port_box.addWidget(QLabel("Local Service Port (127.0.0.1):", grp_failsafe))
        self.spin_port = QSpinBox(grp_failsafe)
        self.spin_port.setRange(1024, 65535)
        self.spin_port.setValue(policy_manager.api_port)
        self.spin_port.setFixedWidth(110)
        port_box.addWidget(self.spin_port)
        port_box.addSpacing(20)

        lbl_loopback = QLabel("🔒 Strictly Loopback (No External Network Interface)", grp_failsafe)
        lbl_loopback.setStyleSheet("color: #34d399; font-size: 12px; font-weight: 600;")
        port_box.addWidget(lbl_loopback)
        port_box.addStretch()
        vbox_failsafe.addLayout(port_box)

        layout.addWidget(grp_failsafe)

        # 3. Monitored Folders Card (File Watcher)
        grp_watch = QGroupBox("Monitored Folders (Detect & Quarantine)", container)
        vbox_watch = QVBoxLayout(grp_watch)
        vbox_watch.setSpacing(10)

        watch_desc = QLabel(
            "Generic file types (txt, csv, json, pdf, etc.) saved in these directories will be automatically scanned upon write:",
            grp_watch
        )
        watch_desc.setStyleSheet("color: #94a3b8; font-size: 12px;")
        vbox_watch.addWidget(watch_desc)

        self.list_watched = QListWidget(grp_watch)
        self.list_watched.setMinimumHeight(110)
        self.list_watched.setStyleSheet("""
            QListWidget {
                background-color: #0f172a;
                border: 1px solid #1e293b;
                border-radius: 6px;
                padding: 4px;
            }
            QListWidget::item {
                padding: 6px 10px;
                border-radius: 4px;
            }
            QListWidget::item:selected {
                background-color: #1e3a8a;
                color: #60a5fa;
            }
        """)
        vbox_watch.addWidget(self.list_watched)

        watch_btns = QHBoxLayout()
        btn_add_folder = QPushButton("➕ Add Folder...", grp_watch)
        btn_add_folder.clicked.connect(self._on_add_watched_folder)

        btn_rem_folder = QPushButton("➖ Remove Selected", grp_watch)
        btn_rem_folder.clicked.connect(self._on_remove_watched_folder)

        btn_def_folders = QPushButton("Restore Default Folders", grp_watch)
        btn_def_folders.clicked.connect(self._on_restore_default_folders)

        watch_btns.addWidget(btn_add_folder)
        watch_btns.addWidget(btn_rem_folder)
        watch_btns.addWidget(btn_def_folders)
        watch_btns.addStretch()
        vbox_watch.addLayout(watch_btns)

        # Quarantine Destination
        quar_box = QHBoxLayout()
        quar_box.addWidget(QLabel("Quarantine Archive Location:", grp_watch))
        self.edit_quarantine_path = QLineEdit(grp_watch)
        self.edit_quarantine_path.setText(policy_manager.quarantine_archive_path)
        btn_browse_quar = QPushButton("Browse...", grp_watch)
        btn_browse_quar.clicked.connect(self._on_browse_quarantine_archive)
        quar_box.addWidget(self.edit_quarantine_path)
        quar_box.addWidget(btn_browse_quar)
        vbox_watch.addLayout(quar_box)

        layout.addWidget(grp_watch)

        # 4. Service Diagnostics & Office Add-In Status Card
        grp_diag = QGroupBox("Service Status & Integrations", container)
        vbox_diag = QVBoxLayout(grp_diag)
        vbox_diag.setSpacing(12)

        diag_box = QHBoxLayout()
        diag_box.addWidget(QLabel("Classification Service Health:", grp_diag))
        self.lbl_svc_status = QLabel("  Not Tested  ", grp_diag)
        self.lbl_svc_status.setStyleSheet("background: #1e293b; color: #94a3b8; border-radius: 4px; padding: 4px 8px; font-weight: bold;")
        diag_box.addWidget(self.lbl_svc_status)
        diag_box.addSpacing(16)

        self.btn_test_svc = QPushButton("🔍 Test Service Probe", grp_diag)
        self.btn_test_svc.clicked.connect(self._on_test_service_health)
        diag_box.addWidget(self.btn_test_svc)
        diag_box.addStretch()
        vbox_diag.addLayout(diag_box)

        # Office Add-in Registration Status
        addin_status_word = self._check_office_addin_reg("Word")
        addin_status_excel = self._check_office_addin_reg("Excel")

        addin_box = QHBoxLayout()
        addin_box.addWidget(QLabel("Office VSTO Add-In Status:", grp_diag))
        lbl_word_stat = QLabel(f" Word: {'✅ Registered' if addin_status_word else '⚠️ Not Registered'} ", grp_diag)
        lbl_word_stat.setStyleSheet("color: #34d399; font-weight: 600;" if addin_status_word else "color: #f59e0b;")
        lbl_excel_stat = QLabel(f" Excel: {'✅ Registered' if addin_status_excel else '⚠️ Not Registered'} ", grp_diag)
        lbl_excel_stat.setStyleSheet("color: #34d399; font-weight: 600;" if addin_status_excel else "color: #f59e0b;")
        addin_box.addWidget(lbl_word_stat)
        addin_box.addWidget(lbl_excel_stat)
        addin_box.addStretch()
        vbox_diag.addLayout(addin_box)

        layout.addWidget(grp_diag)

        # Footer Buttons
        enf_footer = QHBoxLayout()
        self.btn_save_enf = QPushButton("Save Enforcement Policy", container)
        self.btn_save_enf.setObjectName("primaryButton")
        self.btn_save_enf.setFixedWidth(190)
        self.btn_save_enf.clicked.connect(self.save_enforcement_settings)

        self.btn_reset_enf = QPushButton("Reset Policy to Defaults", container)
        self.btn_reset_enf.setFixedWidth(180)
        self.btn_reset_enf.clicked.connect(self.reset_enforcement_defaults)

        enf_footer.addWidget(self.btn_save_enf)
        enf_footer.addWidget(self.btn_reset_enf)
        enf_footer.addStretch()
        layout.addLayout(enf_footer)
        layout.addStretch()

        scroll.setWidget(container)
        return scroll

    def _check_office_addin_reg(self, app_name: str) -> bool:
        """Check if PIISentinel.OfficeAddin is registered under HKCU."""
        try:
            key_path = rf"Software\Microsoft\Office\{app_name}\Addins\PIISentinel.OfficeAddin"
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ)
            winreg.CloseKey(key)
            return True
        except Exception:
            return False

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

    def _on_theme_combo_changed(self, idx: int) -> None:
        selected_theme = self.combo_theme.currentText().lower()
        if selected_theme in ["dark", "light"]:
            config_manager.theme = selected_theme
            config_manager.set("theme", selected_theme)
            self.theme_changed_signal.emit(selected_theme)

    def sync_theme(self, theme_name: str) -> None:
        """Sync combo box from external theme switch (e.g. top bar toggle)."""
        theme_title = str(theme_name).capitalize()
        if theme_title in ["Dark", "Light"]:
            self.combo_theme.blockSignals(True)
            self.combo_theme.setCurrentText(theme_title)
            self.combo_theme.blockSignals(False)

    def load_settings(self) -> None:
        """Populate controls with current config_manager settings."""
        thresh_pct = int(config_manager.confidence_threshold * 100)
        self.slider_thresh.setValue(thresh_pct)
        self.lbl_thresh_display.setText(f"{config_manager.confidence_threshold:.2f} ({thresh_pct}%)")

        self.spin_max_size.setValue(config_manager.max_file_size_mb)
        self.spin_workers.setValue(config_manager.max_workers)
        self.edit_dest.setText(config_manager.default_output_folder)
        self.edit_exts.setText(", ".join(config_manager.supported_extensions))
        self.chk_ocr.setChecked(config_manager.ocr_enabled)

        theme_curr = config_manager.theme.capitalize()
        self.combo_theme.setCurrentText(theme_curr if theme_curr in ["Dark", "Light"] else "Dark")

    def save_settings(self) -> None:
        """Write user selections to config_manager."""
        config_manager.confidence_threshold = self.slider_thresh.value() / 100.0
        config_manager.max_file_size_mb = self.spin_max_size.value()
        config_manager.max_workers = self.spin_workers.value()
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
        QMessageBox.information(self, "Settings Saved", "General preferences successfully persisted.")

    def reset_defaults(self) -> None:
        confirm = QMessageBox.question(
            self, "Reset Defaults",
            "Reset all general settings to initial factory defaults?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            config_manager.reset_to_defaults()
            self.load_settings()
            self.theme_changed_signal.emit(config_manager.theme)
            QMessageBox.information(self, "Reset Complete", "General settings have been reset to defaults.")

    # -------------------------------------------------------------
    # Enforcement Policy Actions & Persistence
    # -------------------------------------------------------------

    def load_enforcement_settings(self) -> None:
        """Load enforcement policy settings into the UI controls."""
        policy_manager.load()
        tier_actions = policy_manager.tier_actions

        for tier_str, combo in self.tier_combos.items():
            action = tier_actions.get(tier_str, DEFAULT_TIER_ACTIONS.get(tier_str, "allow"))
            idx = combo.findData(action)
            if idx >= 0:
                combo.setCurrentIndex(idx)

        # Fail-safe
        fail_open = policy_manager.fail_open
        fs_idx = self.combo_failsafe.findData(fail_open)
        if fs_idx >= 0:
            self.combo_failsafe.setCurrentIndex(fs_idx)

        # Port
        self.spin_port.setValue(policy_manager.api_port)

        # Watched folders
        self.list_watched.clear()
        for folder in policy_manager.watched_folders:
            self.list_watched.addItem(folder)

        # Quarantine archive path
        self.edit_quarantine_path.setText(policy_manager.quarantine_archive_path)

    def save_enforcement_settings(self) -> None:
        """Save enforcement policy settings to enforcement_policy.json."""
        # Tiers
        new_actions = {}
        for tier_str, combo in self.tier_combos.items():
            new_actions[tier_str] = combo.currentData()
        policy_manager.tier_actions = new_actions

        # Fail-safe
        policy_manager.fail_open = self.combo_failsafe.currentData()

        # Port
        policy_manager.api_port = self.spin_port.value()

        # Watched folders
        folders = [self.list_watched.item(i).text() for i in range(self.list_watched.count())]
        policy_manager.watched_folders = folders

        # Quarantine archive path
        policy_manager.quarantine_archive_path = self.edit_quarantine_path.text().strip()

        policy_manager.save()
        QMessageBox.information(self, "Enforcement Policy Saved", "Real-time enforcement policy updated successfully.")

    def reset_enforcement_defaults(self) -> None:
        confirm = QMessageBox.question(
            self, "Reset Enforcement Policy",
            "Reset all real-time enforcement policies and watched directories to factory defaults?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            policy_manager.tier_actions = dict(DEFAULT_TIER_ACTIONS)
            policy_manager.fail_open = False
            policy_manager.api_port = 47821
            policy_manager.watched_folders = get_default_watched_folders()
            policy_manager.quarantine_archive_path = str(Path.home() / "PII_Quarantine.zip")
            policy_manager.save()
            self.load_enforcement_settings()
            QMessageBox.information(self, "Reset Complete", "Enforcement policy reset to defaults.")

    def _on_restore_default_tiers(self) -> None:
        for tier_str, combo in self.tier_combos.items():
            def_action = DEFAULT_TIER_ACTIONS.get(tier_str, "allow")
            idx = combo.findData(def_action)
            if idx >= 0:
                combo.setCurrentIndex(idx)

    def _on_add_watched_folder(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Select Folder to Monitor")
        if path:
            # Avoid duplicates
            existing = [self.list_watched.item(i).text() for i in range(self.list_watched.count())]
            if path not in existing:
                self.list_watched.addItem(path)

    def _on_remove_watched_folder(self) -> None:
        row = self.list_watched.currentRow()
        if row >= 0:
            self.list_watched.takeItem(row)

    def _on_restore_default_folders(self) -> None:
        self.list_watched.clear()
        for folder in get_default_watched_folders():
            self.list_watched.addItem(folder)

    def _on_browse_quarantine_archive(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Select Quarantine ZIP Archive",
            self.edit_quarantine_path.text(),
            "ZIP Archives (*.zip)"
        )
        if path:
            self.edit_quarantine_path.setText(path)

    def _on_test_service_health(self) -> None:
        port = self.spin_port.value()
        url = f"http://127.0.0.1:{port}/health"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PIISentinel-UI"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "healthy":
                    self.lbl_svc_status.setText("  ✅ Service Healthy (127.0.0.1)  ")
                    self.lbl_svc_status.setStyleSheet(
                        "background: rgba(16, 185, 129, 0.2); color: #34d399; border-radius: 4px; padding: 4px 8px; font-weight: bold;"
                    )
                else:
                    self.lbl_svc_status.setText("  ⚠️ Degraded Status  ")
                    self.lbl_svc_status.setStyleSheet(
                        "background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-radius: 4px; padding: 4px 8px; font-weight: bold;"
                    )
        except Exception:
            self.lbl_svc_status.setText("  ❌ Service Offline / Not Running  ")
            self.lbl_svc_status.setStyleSheet(
                "background: rgba(239, 68, 68, 0.2); color: #f87171; border-radius: 4px; padding: 4px 8px; font-weight: bold;"
            )
