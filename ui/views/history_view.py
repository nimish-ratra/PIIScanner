"""
Scan History View for PII Sentinel
Displays persistent historical scan runs from the local SQLite database.
Allows users to reload findings into the Results View, reopen HTML reports, or delete records.
"""

import os
import webbrowser
from pathlib import Path
from typing import Dict, Any, List

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QTableWidget, QTableWidgetItem,
    QHeaderView, QMessageBox, QTabWidget, QComboBox, QFileDialog
)
from PySide6.QtGui import QColor
from PySide6.QtCore import Qt, Signal

from backend.database import db_manager
from backend.classifier import TIER_METADATA, SensitivityTier
from ui.components.enforcement_details_dialog import EnforcementEventDetailsDialog, get_source_icon


class HistoryView(QWidget):
    """View managing historical scan reports and real-time enforcement events from SQLite."""

    # Emitted when user selects a scan to view in ResultsView
    load_scan_signal = Signal(dict, list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.scans: List[Dict[str, Any]] = []
        self.enforcement_events: List[Dict[str, Any]] = []
        self._init_ui()
        self.refresh_history()
        self.refresh_enforcement()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(14)

        # Header
        header_layout = QHBoxLayout()
        title_vbox = QVBoxLayout()
        title_vbox.setSpacing(2)

        lbl_title = QLabel("Security Audit Trail & History", self)
        lbl_title.setStyleSheet("font-size: 22px; font-weight: 800; color: #f8fafc;")
        lbl_sub = QLabel("Revisit past batch scan reports and inspect real-time save enforcement events.", self)
        lbl_sub.setStyleSheet("font-size: 13px; color: #94a3b8;")

        title_vbox.addWidget(lbl_title)
        title_vbox.addWidget(lbl_sub)
        header_layout.addLayout(title_vbox)
        header_layout.addStretch()

        self.btn_refresh = QPushButton("🔄 Refresh All", self)
        self.btn_refresh.clicked.connect(self._refresh_all)
        header_layout.addWidget(self.btn_refresh)

        main_layout.addLayout(header_layout)

        # Main Tabs
        self.tabs = QTabWidget(self)

        # =====================================================================
        # TAB 1: Directory Scans
        # =====================================================================
        tab_scans = QWidget()
        layout_scans = QVBoxLayout(tab_scans)
        layout_scans.setContentsMargins(0, 12, 0, 0)
        layout_scans.setSpacing(12)

        # Scans Table
        self.table = QTableWidget(tab_scans)
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "Started At", "Target Folder", "Files Scanned", "Files with PII", "Total Findings", "Duration", "Status"
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.itemSelectionChanged.connect(self._on_selection_changed)

        layout_scans.addWidget(self.table)

        # Action Toolbar for Scans
        action_bar = QHBoxLayout()
        action_bar.setSpacing(12)

        self.btn_load = QPushButton("Load into Results View", tab_scans)
        self.btn_load.setObjectName("primaryButton")
        self.btn_load.setEnabled(False)
        self.btn_load.clicked.connect(self._on_load_scan)

        self.btn_open_html = QPushButton("Open HTML Report", tab_scans)
        self.btn_open_html.setEnabled(False)
        self.btn_open_html.clicked.connect(self._on_open_html)

        self.btn_delete = QPushButton("Delete Record", tab_scans)
        self.btn_delete.setObjectName("dangerButton")
        self.btn_delete.setEnabled(False)
        self.btn_delete.clicked.connect(self._on_delete_scan)

        self.btn_clear_all = QPushButton("Clear All History", tab_scans)
        self.btn_clear_all.clicked.connect(self._on_clear_all)

        action_bar.addWidget(self.btn_load)
        action_bar.addWidget(self.btn_open_html)
        action_bar.addWidget(self.btn_delete)
        action_bar.addStretch()
        action_bar.addWidget(self.btn_clear_all)

        layout_scans.addLayout(action_bar)
        self.tabs.addTab(tab_scans, "📁 Directory Scans")

        # =====================================================================
        # TAB 2: Real-Time Enforcement Events
        # =====================================================================
        tab_enforcement = QWidget()
        layout_enf = QVBoxLayout(tab_enforcement)
        layout_enf.setContentsMargins(0, 12, 0, 0)
        layout_enf.setSpacing(12)

        # Filter bar for enforcement events
        enf_filter_bar = QHBoxLayout()
        enf_filter_bar.setSpacing(10)

        # Search Box
        self.edit_enf_search = QLineEdit(tab_enforcement)
        self.edit_enf_search.setPlaceholderText("🔍 Search intercepted file path...")
        self.edit_enf_search.setMinimumWidth(220)
        self.edit_enf_search.textChanged.connect(self.refresh_enforcement)
        enf_filter_bar.addWidget(self.edit_enf_search)

        # Action Filter
        self.combo_enf_action = QComboBox(tab_enforcement)
        self.combo_enf_action.addItems(["All Actions", "BLOCK", "QUARANTINE", "WARN", "OVERRIDE", "ALLOW"])
        self.combo_enf_action.currentIndexChanged.connect(self.refresh_enforcement)
        enf_filter_bar.addWidget(self.combo_enf_action)

        # Tier Filter
        self.combo_enf_tier = QComboBox(tab_enforcement)
        self.combo_enf_tier.addItems(["All Tiers", "Restricted", "Highly Confidential", "Confidential", "General", "Public"])
        self.combo_enf_tier.currentIndexChanged.connect(self.refresh_enforcement)
        enf_filter_bar.addWidget(self.combo_enf_tier)

        # Source Filter
        self.combo_enf_source = QComboBox(tab_enforcement)
        self.combo_enf_source.addItems(["All Sources", "Word", "Excel", "Filesystem Watcher"])
        self.combo_enf_source.currentIndexChanged.connect(self.refresh_enforcement)
        enf_filter_bar.addWidget(self.combo_enf_source)

        enf_filter_bar.addStretch()

        # CSV Export Button
        self.btn_export_enf_csv = QPushButton("📥 Export Audit CSV", tab_enforcement)
        self.btn_export_enf_csv.setFixedHeight(30)
        self.btn_export_enf_csv.clicked.connect(self._on_export_enforcement_csv)
        enf_filter_bar.addWidget(self.btn_export_enf_csv)

        layout_enf.addLayout(enf_filter_bar)

        # Enforcement Table
        self.table_enforcement = QTableWidget(tab_enforcement)
        self.table_enforcement.setColumnCount(7)
        self.table_enforcement.setHorizontalHeaderLabels([
            "Timestamp", "File / Document", "Source", "Sensitivity Tier", "Detected Types", "Action Taken", "Override Info"
        ])
        self.table_enforcement.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table_enforcement.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table_enforcement.setAlternatingRowColors(True)
        self.table_enforcement.setSelectionBehavior(QTableWidget.SelectRows)
        self.table_enforcement.setSelectionMode(QTableWidget.SingleSelection)
        self.table_enforcement.itemSelectionChanged.connect(self._on_enf_selection_changed)
        self.table_enforcement.cellDoubleClicked.connect(self._on_enf_double_clicked)

        layout_enf.addWidget(self.table_enforcement)

        # Enforcement Actions Bar
        enf_actions_bar = QHBoxLayout()
        enf_actions_bar.setSpacing(12)

        self.btn_inspect_enf = QPushButton("👁️ Inspect Event Details...", tab_enforcement)
        self.btn_inspect_enf.setEnabled(False)
        self.btn_inspect_enf.clicked.connect(self._on_inspect_enforcement_event)
        enf_actions_bar.addWidget(self.btn_inspect_enf)

        self.btn_delete_enf = QPushButton("Delete Selected Event", tab_enforcement)
        self.btn_delete_enf.setObjectName("dangerButton")
        self.btn_delete_enf.setEnabled(False)
        self.btn_delete_enf.clicked.connect(self._on_delete_enforcement_event)
        enf_actions_bar.addWidget(self.btn_delete_enf)

        enf_actions_bar.addStretch()

        self.btn_clear_enf = QPushButton("Clear All Enforcement Events", tab_enforcement)
        self.btn_clear_enf.clicked.connect(self._on_clear_enforcement_events)
        enf_actions_bar.addWidget(self.btn_clear_enf)

        layout_enf.addLayout(enf_actions_bar)

        self.tabs.addTab(tab_enforcement, "🛡️ Real-Time Enforcement Events")
        main_layout.addWidget(self.tabs)

    def refresh_history(self) -> None:
        """Fetch records from SQLite and refresh table."""
        try:
            self.scans = db_manager.get_all_scans()
        except Exception:
            self.scans = []

        self.table.setRowCount(len(self.scans))
        for row_idx, scan in enumerate(self.scans):
            # Started at
            item_date = QTableWidgetItem(scan.get("started_at", ""))
            item_date.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 0, item_date)

            # Target Folder
            item_folder = QTableWidgetItem(scan.get("target_folder", ""))
            item_folder.setToolTip(scan.get("target_folder", ""))
            self.table.setItem(row_idx, 1, item_folder)

            # Files Scanned
            item_scanned = QTableWidgetItem(str(scan.get("files_scanned", 0)))
            item_scanned.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 2, item_scanned)

            # Files with PII
            item_pii = QTableWidgetItem(str(scan.get("files_with_pii", 0)))
            item_pii.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 3, item_pii)

            # Total Findings
            item_findings = QTableWidgetItem(str(scan.get("total_findings", 0)))
            item_findings.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 4, item_findings)

            # Duration
            dur = scan.get("duration_seconds", 0.0)
            item_dur = QTableWidgetItem(f"{dur:.1f}s")
            item_dur.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 5, item_dur)

            # Status
            status = str(scan.get("status", "completed")).upper()
            item_status = QTableWidgetItem(status)
            item_status.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 6, item_status)

        self._on_selection_changed()

    def _get_selected_scan(self) -> Optional[Dict[str, Any]]:
        row = self.table.currentRow()
        if 0 <= row < len(self.scans):
            return self.scans[row]
        return None

    def _on_selection_changed(self) -> None:
        scan = self._get_selected_scan()
        has_sel = scan is not None
        self.btn_load.setEnabled(has_sel)
        self.btn_open_html.setEnabled(has_sel and bool(scan.get("report_html")))
        self.btn_delete.setEnabled(has_sel)

    def _on_load_scan(self) -> None:
        scan = self._get_selected_scan()
        if not scan:
            return
        scan_id = scan.get("scan_id")
        findings = db_manager.get_findings_for_scan(scan_id)
        self.load_scan_signal.emit(scan, findings)

    def _on_open_html(self) -> None:
        scan = self._get_selected_scan()
        if not scan:
            return
        html_path = scan.get("report_html")
        if html_path and Path(html_path).exists():
            webbrowser.open(Path(html_path).resolve().as_uri())
        else:
            QMessageBox.warning(self, "Report Not Found", f"HTML dashboard report does not exist at:\n{html_path}")

    def _on_delete_scan(self) -> None:
        scan = self._get_selected_scan()
        if not scan:
            return
        confirm = QMessageBox.question(
            self, "Confirm Deletion",
            f"Delete history record for scan from {scan.get('started_at')}?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            db_manager.delete_scan(scan.get("scan_id"))
            self.refresh_history()

    def _on_clear_all(self) -> None:
        confirm = QMessageBox.question(
            self, "Clear Entire History",
            "Are you sure you want to delete ALL historical scan records?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            db_manager.clear_history()
            self.refresh_history()

    def _refresh_all(self) -> None:
        """Refresh both historical directory scans and real-time enforcement logs."""
        self.refresh_history()
        self.refresh_enforcement()

    def refresh_enforcement(self) -> None:
        """Fetch real-time enforcement events from SQLite with filters and populate enforcement table."""
        action_filter = self.combo_enf_action.currentText()
        if action_filter == "All Actions":
            action_filter = None

        tier_filter = self.combo_enf_tier.currentText()
        if tier_filter == "All Tiers":
            tier_filter = None

        source_filter = self.combo_enf_source.currentText()
        if source_filter == "All Sources":
            source_filter = None

        search_query = self.edit_enf_search.text().strip()
        if not search_query:
            search_query = None

        try:
            self.enforcement_events = db_manager.get_enforcement_events(
                limit=300,
                action=action_filter,
                tier=tier_filter,
                source=source_filter,
                search=search_query
            )
        except Exception:
            self.enforcement_events = []

        self.table_enforcement.setRowCount(len(self.enforcement_events))
        for row_idx, ev in enumerate(self.enforcement_events):
            # 0. Timestamp
            item_ts = QTableWidgetItem(str(ev.get("timestamp", "")))
            item_ts.setTextAlignment(Qt.AlignCenter)
            self.table_enforcement.setItem(row_idx, 0, item_ts)

            # 1. File / Document
            file_p = str(ev.get("file_path", ""))
            fname = Path(file_p).name or file_p
            item_file = QTableWidgetItem(fname)
            item_file.setToolTip(file_p)
            self.table_enforcement.setItem(row_idx, 1, item_file)

            # 2. Source (Word / Excel / Watcher with icon)
            src = ev.get("app_source") or ev.get("source", "Generic")
            item_src = QTableWidgetItem(get_source_icon(src))
            item_src.setTextAlignment(Qt.AlignCenter)
            item_src.setToolTip(f"Audit Source: {src}")
            self.table_enforcement.setItem(row_idx, 2, item_src)

            # 3. Sensitivity Tier
            tier_name = str(ev.get("tier", "General"))
            meta = TIER_METADATA.get(
                SensitivityTier(tier_name) if tier_name in [t.value for t in SensitivityTier] else SensitivityTier.GENERAL,
                {}
            )
            item_tier = QTableWidgetItem(f"{meta.get('badge_emoji', '⚪')} {tier_name}")
            item_tier.setTextAlignment(Qt.AlignCenter)
            color_hex = meta.get("color_hex", meta.get("color", "#94a3b8"))
            item_tier.setForeground(QColor(color_hex))
            self.table_enforcement.setItem(row_idx, 3, item_tier)

            # 4. Detected Types
            raw_types = ev.get("detection_types") or ""
            if not raw_types:
                summary = ev.get("entity_summary", "")
                if summary:
                    parts = [p.split(":")[0].strip() for p in summary.split(",") if p.strip()]
                    raw_types = ", ".join(parts)

            type_list = [t.strip() for t in raw_types.split(",") if t.strip()]
            if len(type_list) > 2:
                disp_types = f"{', '.join(type_list[:2])} (+{len(type_list) - 2} more)"
            else:
                disp_types = ", ".join(type_list) if type_list else "—"

            item_types = QTableWidgetItem(disp_types)
            item_types.setToolTip(f"Detected PII Types:\n{', '.join(type_list) if type_list else 'None'}\n\nSummary:\n{ev.get('entity_summary', '')}")
            self.table_enforcement.setItem(row_idx, 4, item_types)

            # 5. Action Taken (Pill)
            action = str(ev.get("action_taken", "allow")).upper()
            item_action = QTableWidgetItem(action)
            item_action.setTextAlignment(Qt.AlignCenter)
            font = item_action.font()
            font.setBold(True)
            item_action.setFont(font)
            if action in ("BLOCK", "BLOCKED"):
                item_action.setForeground(QColor("#f87171"))
            elif action in ("QUARANTINE", "QUARANTINED"):
                item_action.setForeground(QColor("#fb923c"))
            elif action in ("WARN", "WARNED"):
                item_action.setForeground(QColor("#fbbf24"))
            elif action in ("OVERRIDE", "OVERRIDDEN"):
                item_action.setForeground(QColor("#c084fc"))
            else:
                item_action.setForeground(QColor("#34d399"))
            self.table_enforcement.setItem(row_idx, 5, item_action)

            # 6. Override Info
            is_override = bool(ev.get("user_override"))
            reason = ev.get("override_reason", "")
            if is_override:
                item_ov = QTableWidgetItem(f"⚠️ {reason}" if reason else "⚠️ Yes")
                item_ov.setForeground(QColor("#fbbf24"))
                item_ov.setToolTip(f"Override Rationale:\n{reason or 'None provided'}")
            else:
                item_ov = QTableWidgetItem("—")
                item_ov.setTextAlignment(Qt.AlignCenter)
                item_ov.setForeground(QColor("#64748b"))
            self.table_enforcement.setItem(row_idx, 6, item_ov)

        self._on_enf_selection_changed()

    def _get_selected_enforcement_event(self) -> Optional[Dict[str, Any]]:
        row = self.table_enforcement.currentRow()
        if 0 <= row < len(self.enforcement_events):
            return self.enforcement_events[row]
        return None

    def _on_enf_selection_changed(self) -> None:
        ev = self._get_selected_enforcement_event()
        has_sel = ev is not None
        self.btn_inspect_enf.setEnabled(has_sel)
        self.btn_delete_enf.setEnabled(has_sel)

    def _on_enf_double_clicked(self, row: int, col: int) -> None:
        self._on_inspect_enforcement_event()

    def _on_inspect_enforcement_event(self) -> None:
        ev = self._get_selected_enforcement_event()
        if ev:
            dlg = EnforcementEventDetailsDialog(ev, self)
            dlg.exec()

    def _on_export_enforcement_csv(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Export Real-Time Enforcement Audit Log",
            "enforcement_audit_log.csv",
            "CSV Files (*.csv)"
        )
        if path:
            success = db_manager.export_enforcement_events_csv(path, self.enforcement_events)
            if success:
                QMessageBox.information(
                    self, "Export Successful",
                    f"Successfully exported {len(self.enforcement_events)} audit events to:\n{path}"
                )
            else:
                QMessageBox.critical(self, "Export Failed", f"Could not write audit CSV to:\n{path}")

    def _on_delete_enforcement_event(self) -> None:
        ev = self._get_selected_enforcement_event()
        if not ev:
            return
        event_id = ev.get("id")
        if event_id:
            confirm = QMessageBox.question(
                self, "Confirm Deletion",
                f"Delete log for enforcement event on {ev.get('file_path')}?",
                QMessageBox.Yes | QMessageBox.No
            )
            if confirm == QMessageBox.Yes:
                db_manager.delete_enforcement_event(event_id)
                self.refresh_enforcement()

    def _on_clear_enforcement_events(self) -> None:
        confirm = QMessageBox.question(
            self, "Clear Enforcement Audit Log",
            "Are you sure you want to delete ALL real-time save enforcement logs?",
            QMessageBox.Yes | QMessageBox.No
        )
        if confirm == QMessageBox.Yes:
            db_manager.clear_enforcement_events()
            self.refresh_enforcement()
