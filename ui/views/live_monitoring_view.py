"""
PII Sentinel - Live Pre-Save Monitoring & Enforcement View
Provides real-time inspection of in-memory Word/Excel save events,
filesystem file watcher alerts, live start/stop controls, and audit logs.
"""

import os
from pathlib import Path
from typing import Dict, Any, List, Optional

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QComboBox,
    QCheckBox, QFrame, QMessageBox
)
from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QColor

from backend.database import db_manager
from backend.classifier import get_tier_metadata
from service.enforcement_policy import policy_manager
from service.service_controller import ServiceController


class LiveMonitoringView(QWidget):
    """Real-time monitoring and management dashboard for save enforcement."""

    status_changed_signal = Signal(bool)

    def __init__(self, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.enforcement_events: List[Dict[str, Any]] = []
        self._is_service_active: bool = False
        self._init_ui()

        # Timer for polling service status and auto-refreshing live event stream
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self._on_poll_tick)
        self.poll_timer.start(2000)

        # Initial checks
        self._check_service_status()
        self.refresh_events()

    def is_active(self) -> bool:
        """Return True if background service is currently alive."""
        return self._is_service_active

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 20, 24, 20)
        main_layout.setSpacing(14)

        # 1. Header & Service Control Bar
        header_card = QFrame(self)
        header_card.setObjectName("statCard")
        header_layout = QVBoxLayout(header_card)
        header_layout.setContentsMargins(18, 14, 18, 14)
        header_layout.setSpacing(10)

        top_row = QHBoxLayout()
        header_text_box = QVBoxLayout()
        header_text_box.setSpacing(3)

        lbl_title = QLabel("Real-Time SaveGuard & Live Monitoring", header_card)
        lbl_title.setObjectName("viewTitle")
        lbl_title.setStyleSheet("font-size: 20px; font-weight: 800;")
        header_text_box.addWidget(lbl_title)

        lbl_sub = QLabel(
            "Live in-memory pre-save interception for Office Word & Excel, and automated filesystem protection.",
            header_card
        )
        lbl_sub.setObjectName("viewSubtitle")
        lbl_sub.setStyleSheet("font-size: 12px; color: #64748b;")
        header_text_box.addWidget(lbl_sub)
        top_row.addLayout(header_text_box)
        top_row.addStretch()

        # Service Status Pill Badge
        self.lbl_service_badge = QLabel("  CHECKING SERVICE...  ", header_card)
        self.lbl_service_badge.setFixedHeight(32)
        self.lbl_service_badge.setStyleSheet(
            "background: #1e293b; color: #94a3b8; border-radius: 6px; padding: 0 12px; font-weight: 700; font-size: 11px;"
        )
        top_row.addWidget(self.lbl_service_badge)
        header_layout.addLayout(top_row)

        # Control Buttons Sub-bar
        ctrl_bar = QHBoxLayout()
        ctrl_bar.setSpacing(10)

        self.btn_start_svc = QPushButton("▶  Start Live Protection", header_card)
        self.btn_start_svc.setFixedHeight(32)
        self.btn_start_svc.setStyleSheet(
            "background: #059669; color: #ffffff; border-radius: 6px; padding: 0 14px; font-weight: 700; font-size: 12px;"
        )
        self.btn_start_svc.clicked.connect(self._on_start_service)
        ctrl_bar.addWidget(self.btn_start_svc)

        self.btn_stop_svc = QPushButton("⏹  Stop Protection", header_card)
        self.btn_stop_svc.setFixedHeight(32)
        self.btn_stop_svc.setStyleSheet(
            "background: #dc2626; color: #ffffff; border-radius: 6px; padding: 0 14px; font-weight: 700; font-size: 12px;"
        )
        self.btn_stop_svc.clicked.connect(self._on_stop_service)
        ctrl_bar.addWidget(self.btn_stop_svc)

        self.btn_probe = QPushButton("🧪  Test Intercept Probe", header_card)
        self.btn_probe.setFixedHeight(32)
        self.btn_probe.setStyleSheet(
            "background: #2563eb; color: #ffffff; border-radius: 6px; padding: 0 14px; font-weight: 700; font-size: 12px;"
        )
        self.btn_probe.clicked.connect(self._on_test_probe)
        ctrl_bar.addWidget(self.btn_probe)

        ctrl_bar.addStretch()

        btn_open_quarantine = QPushButton("📁 Open Vault", header_card)
        btn_open_quarantine.setFixedHeight(32)
        btn_open_quarantine.clicked.connect(self._on_open_quarantine)
        ctrl_bar.addWidget(btn_open_quarantine)

        header_layout.addLayout(ctrl_bar)
        main_layout.addWidget(header_card)

        # Probe Feedback Banner (Hidden until tested)
        self.lbl_probe_result = QLabel(self)
        self.lbl_probe_result.setVisible(False)
        self.lbl_probe_result.setStyleSheet(
            "background: rgba(37, 99, 235, 0.15); border: 1px solid #3b82f6; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #60a5fa; font-weight: 600;"
        )
        main_layout.addWidget(self.lbl_probe_result)

        # 2. Key Metrics & Coverage Stats (KPI Row)
        stats_layout = QHBoxLayout()
        stats_layout.setSpacing(12)

        self.card_office = self._create_kpi_card("Office Pre-Save Guard", "STANDBY", "Word & Excel COM Add-In Hook")
        self.card_watcher = self._create_kpi_card("Filesystem Watcher", "3 FOLDERS", "Desktop, Documents, Downloads")
        self.card_policy = self._create_kpi_card("Enforcement Policy", "FAIL-OPEN", "Purview 5-Tier DLP Matrix")
        self.card_interceptions = self._create_kpi_card("Total Interceptions", "0", "Recorded in Local Audit DB")

        stats_layout.addWidget(self.card_office)
        stats_layout.addWidget(self.card_watcher)
        stats_layout.addWidget(self.card_policy)
        stats_layout.addWidget(self.card_interceptions)
        main_layout.addLayout(stats_layout)

        # 3. Live Stream Controls & Filters
        filter_box = QHBoxLayout()
        filter_box.setSpacing(10)

        lbl_filter = QLabel("Filter:", self)
        lbl_filter.setStyleSheet("font-weight: 700; font-size: 12px; color: #64748b;")
        filter_box.addWidget(lbl_filter)

        self.combo_action = QComboBox(self)
        self.combo_action.addItems(["All Actions", "BLOCK", "QUARANTINE", "WARN", "ALLOW"])
        self.combo_action.setMinimumWidth(110)
        self.combo_action.currentIndexChanged.connect(self.refresh_events)
        filter_box.addWidget(self.combo_action)

        self.combo_tier = QComboBox(self)
        self.combo_tier.addItems(["All Tiers", "Restricted", "Highly Confidential", "Confidential", "General", "Public"])
        self.combo_tier.setMinimumWidth(130)
        self.combo_tier.currentIndexChanged.connect(self.refresh_events)
        filter_box.addWidget(self.combo_tier)

        self.chk_autorefresh = QCheckBox("Auto-Refresh (2s)", self)
        self.chk_autorefresh.setChecked(True)
        self.chk_autorefresh.setStyleSheet("font-size: 11px; font-weight: 600;")
        filter_box.addWidget(self.chk_autorefresh)

        filter_box.addStretch()

        self.btn_delete_ev = QPushButton("Delete Selected", self)
        self.btn_delete_ev.setFixedHeight(28)
        self.btn_delete_ev.setEnabled(False)
        self.btn_delete_ev.clicked.connect(self._on_delete_event)
        filter_box.addWidget(self.btn_delete_ev)

        btn_clear_all = QPushButton("Clear Stream", self)
        btn_clear_all.setFixedHeight(28)
        btn_clear_all.clicked.connect(self._on_clear_events)
        filter_box.addWidget(btn_clear_all)

        main_layout.addLayout(filter_box)

        # 4. Live Events Table
        self.table = QTableWidget(self)
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Timestamp", "Source App", "Document / File",
            "Sensitivity Tier", "Action Taken", "Override", "Detected PII Entities"
        ])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.Stretch)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.Stretch)

        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.itemSelectionChanged.connect(self._on_selection_changed)

        main_layout.addWidget(self.table, 1)

    def _create_kpi_card(self, label: str, value: str, subtext: str) -> QFrame:
        card = QFrame(self)
        card.setObjectName("statCard")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(2)

        lbl_top = QLabel(label.upper(), card)
        lbl_top.setObjectName("statCardLabel")
        lbl_top.setStyleSheet("font-size: 10px; font-weight: 700; color: #64748b;")
        layout.addWidget(lbl_top)

        lbl_val = QLabel(value, card)
        lbl_val.setObjectName("statCardValue")
        lbl_val.setStyleSheet("font-size: 18px; font-weight: 800;")
        layout.addWidget(lbl_val)

        lbl_sub = QLabel(subtext, card)
        lbl_sub.setStyleSheet("font-size: 10px; color: #94a3b8;")
        layout.addWidget(lbl_sub)

        card.lbl_val = lbl_val
        return card

    def _on_poll_tick(self) -> None:
        """Periodic background tick: checks service health and refreshes table."""
        self._check_service_status()
        if self.chk_autorefresh.isChecked():
            self.refresh_events()

    def _check_service_status(self) -> None:
        """Probe local microservice and update UI indicators."""
        running = ServiceController.is_running(policy_manager.api_port)
        self._is_service_active = running

        if running:
            self.lbl_service_badge.setText("  🟢 REAL-TIME PROTECTION ACTIVE (Port 47821)  ")
            self.lbl_service_badge.setStyleSheet(
                "background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; border-radius: 6px; padding: 0 12px; font-weight: 700; font-size: 11px;"
            )
            self.btn_start_svc.setEnabled(False)
            self.btn_stop_svc.setEnabled(True)
            self.btn_probe.setEnabled(True)
            self.card_office.lbl_val.setText("ACTIVE")
            self.card_office.lbl_val.setStyleSheet("font-size: 18px; font-weight: 800; color: #34d399;")
        else:
            self.lbl_service_badge.setText("  🔴 REAL-TIME PROTECTION STOPPED  ")
            self.lbl_service_badge.setStyleSheet(
                "background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; border-radius: 6px; padding: 0 12px; font-weight: 700; font-size: 11px;"
            )
            self.btn_start_svc.setEnabled(True)
            self.btn_stop_svc.setEnabled(False)
            self.btn_probe.setEnabled(False)
            self.card_office.lbl_val.setText("STANDBY")
            self.card_office.lbl_val.setStyleSheet("font-size: 18px; font-weight: 800; color: #94a3b8;")

        fs_mode = "FAIL-OPEN" if policy_manager.fail_open else "FAIL-CLOSED"
        self.card_policy.lbl_val.setText(fs_mode)
        num_folders = len(policy_manager.watched_folders)
        self.card_watcher.lbl_val.setText(f"{num_folders} FOLDERS")

        self.status_changed_signal.emit(running)

    def _on_start_service(self) -> None:
        self.btn_start_svc.setEnabled(False)
        self.lbl_service_badge.setText("  🟡 STARTING SERVICE...  ")
        success = ServiceController.start(policy_manager.api_port)
        self._check_service_status()
        if success:
            QMessageBox.information(
                self, "Live Protection Started",
                f"PII Sentinel real-time protection is now active on 127.0.0.1:{policy_manager.api_port}.\n"
                "Word/Excel document saves and filesystem writes are now actively guarded."
            )
        else:
            QMessageBox.warning(
                self, "Startup Error",
                "Could not start the background protection service. Check logs in %APPDATA%\\PIISentinel\\logs."
            )

    def _on_stop_service(self) -> None:
        self.btn_stop_svc.setEnabled(False)
        self.lbl_service_badge.setText("  🟡 STOPPING SERVICE...  ")
        stopped = ServiceController.stop(policy_manager.api_port)
        self._check_service_status()
        if stopped:
            self.lbl_probe_result.setVisible(False)
            QMessageBox.information(
                self, "Live Protection Stopped",
                "Background protection service has been stopped. Pre-save interception is inactive."
            )

    def _on_test_probe(self) -> None:
        """Send a quick classification probe to verify pre-save responsiveness."""
        self.lbl_probe_result.setVisible(True)
        self.lbl_probe_result.setText("Testing pre-save interception probe on loopback microservice...")
        result = ServiceController.test_pre_save_probe(port=policy_manager.api_port)
        if result.get("success"):
            action = result.get("action", "ALLOW").upper()
            tier = result.get("tier", "General")
            elapsed = result.get("elapsed_ms", 0.0)
            findings = result.get("findings_count", 0)
            self.lbl_probe_result.setText(
                f"✅ Pre-Save Intercept Active: Response in {elapsed}ms | Tier: {tier} | Action: {action} ({findings} PII entities detected)"
            )
            self.lbl_probe_result.setStyleSheet(
                "background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #34d399; font-weight: 600;"
            )
        else:
            self.lbl_probe_result.setText(f"❌ Probe Failed: {result.get('error', 'Unreachable')}")
            self.lbl_probe_result.setStyleSheet(
                "background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #f87171; font-weight: 600;"
            )

    def refresh_events(self) -> None:
        """Reload events from SQLite history database."""
        action_filter = self.combo_action.currentText()
        if action_filter == "All Actions":
            action_filter = None

        tier_filter = self.combo_tier.currentText()
        if tier_filter == "All Tiers":
            tier_filter = None

        try:
            self.enforcement_events = db_manager.get_enforcement_events(
                limit=300, action=action_filter, tier=tier_filter
            )
        except Exception:
            self.enforcement_events = []

        self.card_interceptions.lbl_val.setText(str(len(self.enforcement_events)))

        self.table.setRowCount(len(self.enforcement_events))
        for row_idx, ev in enumerate(self.enforcement_events):
            # 0. Timestamp
            item_ts = QTableWidgetItem(str(ev.get("timestamp", "")))
            item_ts.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 0, item_ts)

            # 1. Source App
            src = str(ev.get("source", "Generic"))
            item_src = QTableWidgetItem(src)
            item_src.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 1, item_src)

            # 2. File Path
            fpath = str(ev.get("file_path", ""))
            fname = Path(fpath).name if fpath else "Unknown Document"
            item_file = QTableWidgetItem(fname)
            item_file.setToolTip(fpath)
            self.table.setItem(row_idx, 2, item_file)

            # 3. Sensitivity Tier
            tier_name = str(ev.get("tier", "General"))
            meta = get_tier_metadata(tier_name)
            item_tier = QTableWidgetItem(str(meta.get("badge", tier_name)))
            item_tier.setTextAlignment(Qt.AlignCenter)
            item_tier.setForeground(QColor(meta.get("color", "#94a3b8")))
            self.table.setItem(row_idx, 3, item_tier)

            # 4. Action Taken
            action = str(ev.get("action_taken", "allow")).upper()
            item_action = QTableWidgetItem(action)
            item_action.setTextAlignment(Qt.AlignCenter)
            font = item_action.font()
            font.setBold(True)
            item_action.setFont(font)
            if action in ("BLOCK", "QUARANTINE"):
                item_action.setForeground(QColor("#f87171"))
            elif action == "WARN":
                item_action.setForeground(QColor("#f59e0b"))
            else:
                item_action.setForeground(QColor("#34d399"))
            self.table.setItem(row_idx, 4, item_action)

            # 5. User Override
            override_bool = bool(ev.get("user_override"))
            item_ov = QTableWidgetItem("Yes ⚠️" if override_bool else "No")
            item_ov.setTextAlignment(Qt.AlignCenter)
            if override_bool:
                item_ov.setForeground(QColor("#f59e0b"))
                item_ov.setToolTip(f"Override Rationale:\n{ev.get('override_reason', 'None specified')}")
            self.table.setItem(row_idx, 5, item_ov)

            # 6. Entities Summary
            summary = str(ev.get("entity_summary", ""))
            item_sum = QTableWidgetItem(summary)
            item_sum.setToolTip(summary)
            self.table.setItem(row_idx, 6, item_sum)

        self._on_selection_changed()

    def _on_selection_changed(self) -> None:
        row = self.table.currentRow()
        self.btn_delete_ev.setEnabled(0 <= row < len(self.enforcement_events))

    def _on_delete_event(self) -> None:
        row = self.table.currentRow()
        if 0 <= row < len(self.enforcement_events):
            ev = self.enforcement_events[row]
            event_id = ev.get("id")
            if event_id and db_manager.delete_enforcement_event(event_id):
                self.refresh_events()

    def _on_clear_events(self) -> None:
        confirm = QMessageBox.question(
            self, "Clear Live Audit Stream",
            "Are you sure you want to clear all real-time enforcement logs?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            db_manager.clear_enforcement_events()
            self.refresh_events()

    def _on_open_quarantine(self) -> None:
        archive_path = Path(policy_manager.quarantine_archive_path)
        quarantine_dir = archive_path.parent
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        if hasattr(os, "startfile"):
            os.startfile(str(quarantine_dir))
