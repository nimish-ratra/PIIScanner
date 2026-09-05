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
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QTableWidget, QTableWidgetItem,
    QHeaderView, QMessageBox
)
from PySide6.QtCore import Qt, Signal

from backend.database import db_manager


class HistoryView(QWidget):
    """View managing historical scan reports from SQLite."""

    # Emitted when user selects a scan to view in ResultsView
    load_scan_signal = Signal(dict, list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.scans: List[Dict[str, Any]] = []
        self._init_ui()
        self.refresh_history()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(14)

        # Header
        header_layout = QHBoxLayout()
        title_vbox = QVBoxLayout()
        title_vbox.setSpacing(2)

        lbl_title = QLabel("Scan History", self)
        lbl_title.setStyleSheet("font-size: 22px; font-weight: 800; color: #f8fafc;")
        lbl_sub = QLabel("Revisit past scan reports, reopen findings, or delete historical records.", self)
        lbl_sub.setStyleSheet("font-size: 13px; color: #94a3b8;")

        title_vbox.addWidget(lbl_title)
        title_vbox.addWidget(lbl_sub)
        header_layout.addLayout(title_vbox)
        header_layout.addStretch()

        self.btn_refresh = QPushButton("Refresh", self)
        self.btn_refresh.clicked.connect(self.refresh_history)
        header_layout.addWidget(self.btn_refresh)

        main_layout.addLayout(header_layout)

        # Scans Table
        self.table = QTableWidget(self)
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

        main_layout.addWidget(self.table)

        # Action Toolbar
        action_bar = QHBoxLayout()
        action_bar.setSpacing(12)

        self.btn_load = QPushButton("Load into Results View", self)
        self.btn_load.setObjectName("primaryButton")
        self.btn_load.setEnabled(False)
        self.btn_load.clicked.connect(self._on_load_scan)

        self.btn_open_html = QPushButton("Open HTML Report", self)
        self.btn_open_html.setEnabled(False)
        self.btn_open_html.clicked.connect(self._on_open_html)

        self.btn_delete = QPushButton("Delete Record", self)
        self.btn_delete.setObjectName("dangerButton")
        self.btn_delete.setEnabled(False)
        self.btn_delete.clicked.connect(self._on_delete_scan)

        self.btn_clear_all = QPushButton("Clear All History", self)
        self.btn_clear_all.clicked.connect(self._on_clear_all)

        action_bar.addWidget(self.btn_load)
        action_bar.addWidget(self.btn_open_html)
        action_bar.addWidget(self.btn_delete)
        action_bar.addStretch()
        action_bar.addWidget(self.btn_clear_all)

        main_layout.addLayout(action_bar)

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
