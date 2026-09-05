"""
Main Application Window for PII Sentinel
Coordinates sidebar navigation, stacked views (Scan, Results, History, Settings),
theme switching, and inter-view workflows.
"""

from pathlib import Path
from typing import Dict, Any, List

from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QPushButton, QLabel, QStackedWidget, QStatusBar,
    QButtonGroup, QFrame
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon

from backend.config import config_manager
from backend.tika_extractor import check_java_status
from ui.theme import get_theme_qss
from ui.views.scan_view import ScanView
from ui.views.results_view import ResultsView
from ui.views.history_view import HistoryView
from ui.views.settings_view import SettingsView
from ui.views.onboarding_dialog import OnboardingDialog


class MainWindow(QMainWindow):
    """Main desktop application window for PII Sentinel."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("PII Sentinel - Windows Desktop Scanner")
        self.resize(1120, 750)
        self.setMinimumSize(950, 620)

        icon_path = Path(__file__).parent.parent / "packaging" / "assets" / "app_icon.png"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))

        self._init_ui()
        self._wire_signals()
        self._apply_initial_theme()
        self._check_first_run()

    def _init_ui(self) -> None:
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Left Sidebar Navigation
        sidebar = QFrame(self)
        sidebar.setObjectName("sidebar")
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        sidebar_layout.setSpacing(4)

        # Brand Header
        lbl_brand = QLabel("🛡️ PII SENTINEL", sidebar)
        lbl_brand.setObjectName("sidebarTitle")
        lbl_brand_sub = QLabel("Local Privacy & Audit Suite", sidebar)
        lbl_brand_sub.setObjectName("sidebarSubtitle")

        sidebar_layout.addWidget(lbl_brand)
        sidebar_layout.addWidget(lbl_brand_sub)

        # Offline Guarantee Badge
        badge_container = QHBoxLayout()
        badge_container.setContentsMargins(16, 10, 16, 14)
        lbl_offline = QLabel("🔒 100% OFFLINE", sidebar)
        lbl_offline.setObjectName("badgeOffline")
        badge_container.addWidget(lbl_offline)
        badge_container.addStretch()
        sidebar_layout.addLayout(badge_container)

        # Nav Buttons
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)

        self.btn_nav_scan = self._create_nav_button("🔍  Scan Directory", 0)
        self.btn_nav_results = self._create_nav_button("📊  Results & Action", 1)
        self.btn_nav_history = self._create_nav_button("🕒  Scan History", 2)
        self.btn_nav_settings = self._create_nav_button("⚙️  Settings & Health", 3)

        sidebar_layout.addWidget(self.btn_nav_scan)
        sidebar_layout.addWidget(self.btn_nav_results)
        sidebar_layout.addWidget(self.btn_nav_history)
        sidebar_layout.addWidget(self.btn_nav_settings)
        sidebar_layout.addStretch()

        # Sidebar Footer
        sidebar_footer = QFrame(sidebar)
        sidebar_footer.setObjectName("sidebarFooter")
        footer_layout = QVBoxLayout(sidebar_footer)
        footer_layout.setContentsMargins(14, 12, 14, 12)
        footer_layout.setSpacing(8)

        # Java & Presidio Status
        java_status = check_java_status()
        jvm_text = "JVM Connected" if java_status.get("available") else "Java Missing"
        self.lbl_jvm = QLabel(f"• {jvm_text}", sidebar_footer)
        self.lbl_jvm.setStyleSheet("font-size: 11px; color: #34d399;" if java_status.get("available") else "font-size: 11px; color: #f87171;")
        footer_layout.addWidget(self.lbl_jvm)

        btn_about = QPushButton("Privacy & Help", sidebar_footer)
        btn_about.setFixedHeight(28)
        btn_about.setStyleSheet("font-size: 11px;")
        btn_about.clicked.connect(self._show_onboarding)
        footer_layout.addWidget(btn_about)

        sidebar_layout.addWidget(sidebar_footer)
        root_layout.addWidget(sidebar)

        # 2. Stacked Content Area
        self.stack = QStackedWidget(self)
        self.stack.setObjectName("contentArea")

        self.view_scan = ScanView(self)
        self.view_results = ResultsView(self)
        self.view_history = HistoryView(self)
        self.view_settings = SettingsView(self)

        self.stack.addWidget(self.view_scan)       # Index 0
        self.stack.addWidget(self.view_results)    # Index 1
        self.stack.addWidget(self.view_history)    # Index 2
        self.stack.addWidget(self.view_settings)   # Index 3

        root_layout.addWidget(self.stack, 1)

        # 3. Status Bar
        self.status_bar = QStatusBar(self)
        self.setStatusBar(self.status_bar)
        self.status_bar.showMessage("Ready - All document parsing and NLP detection runs 100% locally.")

        # Default to Scan Tab
        self.btn_nav_scan.setChecked(True)

    def _create_nav_button(self, text: str, index: int) -> QPushButton:
        btn = QPushButton(text, self)
        btn.setObjectName("sidebarNavButton")
        btn.setCheckable(True)
        btn.clicked.connect(lambda: self._switch_tab(index))
        self.nav_group.addButton(btn, index)
        return btn

    def _switch_tab(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        if index == 2:
            self.view_history.refresh_history()

    def _wire_signals(self) -> None:
        # When scan completes, feed results into ResultsView and switch to Results tab
        self.view_scan.scan_completed_signal.connect(self._on_scan_completed)

        # When a historical scan is selected, load into ResultsView and switch tab
        self.view_history.load_scan_signal.connect(self._on_load_history_scan)

        # When theme is toggled in settings, update stylesheet
        self.view_settings.theme_changed_signal.connect(self._apply_theme)

    def _on_scan_completed(self, summary: Dict[str, Any]) -> None:
        findings = self.view_scan.worker.scanner.findings if self.view_scan.worker and self.view_scan.worker.scanner else []
        self.view_results.set_scan_results(summary, findings)
        self.view_history.refresh_history()
        self.status_bar.showMessage(
            f"Scan Complete: {summary.get('files_with_pii', 0)} files flagged with PII ({summary.get('total_findings', 0)} findings)."
        )
        # Switch to results tab so the user can immediately review findings
        self.btn_nav_results.setChecked(True)
        self.stack.setCurrentIndex(1)

    def _on_load_history_scan(self, scan_meta: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
        self.view_results.set_scan_results(scan_meta, findings)
        self.btn_nav_results.setChecked(True)
        self.stack.setCurrentIndex(1)
        self.status_bar.showMessage(f"Loaded past scan from {scan_meta.get('started_at')}")

    def _apply_initial_theme(self) -> None:
        theme = config_manager.theme
        self._apply_theme(theme)

    def _apply_theme(self, theme_name: str) -> None:
        qss = get_theme_qss(theme_name)
        self.setStyleSheet(qss)

    def _check_first_run(self) -> None:
        if not config_manager.first_run_complete:
            # Show onboarding modal dialog
            self._show_onboarding()

    def _show_onboarding(self) -> None:
        dlg = OnboardingDialog(self)
        dlg.exec()
