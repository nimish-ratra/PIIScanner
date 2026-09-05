"""
Results View for PII Sentinel
Sortable, filterable findings table with redacted preview, context menus,
file extraction (preserving relative hierarchy), password-protected quarantine,
filtered CSV export, and direct HTML dashboard launching.
"""

import os
import csv
import webbrowser
from pathlib import Path
from typing import List, Dict, Any, Optional

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QComboBox, QTableWidget, QTableWidgetItem,
    QHeaderView, QFileDialog, QMessageBox, QMenu, QDialog,
    QCheckBox, QDialogButtonBox, QSpinBox
)
from PySide6.QtGui import QAction, QClipboard, QGuiApplication, QColor
from PySide6.QtCore import Qt

from backend.file_ops import (
    extract_flagged_files, quarantine_flagged_files,
    reveal_in_explorer, open_file_default
)
from backend.config import config_manager


def format_file_size(size_bytes: int) -> str:
    """Format bytes into a clean human-readable string."""
    if size_bytes <= 0:
        return "0 B"
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


class ResultsView(QWidget):
    """View presenting scan findings with actions and context menus."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.findings: List[Dict[str, Any]] = []
        self.scan_summary: Dict[str, Any] = {}
        self.root_scan_folder: str = ""
        self._init_ui()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(14)

        # 1. Header Bar
        header_layout = QHBoxLayout()
        title_vbox = QVBoxLayout()
        title_vbox.setSpacing(2)

        self.lbl_title = QLabel("Scan Results & Findings", self)
        self.lbl_title.setStyleSheet("font-size: 22px; font-weight: 800; color: #f8fafc;")
        self.lbl_status = QLabel("No active scan loaded. Run a scan or select one from History.", self)
        self.lbl_status.setStyleSheet("font-size: 13px; color: #94a3b8;")

        title_vbox.addWidget(self.lbl_title)
        title_vbox.addWidget(self.lbl_status)
        header_layout.addLayout(title_vbox)
        header_layout.addStretch()

        # HTML Report Button
        self.btn_open_report = QPushButton("Open HTML Dashboard", self)
        self.btn_open_report.setObjectName("primaryButton")
        self.btn_open_report.setFixedHeight(36)
        self.btn_open_report.setEnabled(False)
        self.btn_open_report.clicked.connect(self._on_open_html_report)
        header_layout.addWidget(self.btn_open_report)

        main_layout.addLayout(header_layout)

        # 2. Filter & Search Toolbar
        filter_bar = QHBoxLayout()
        filter_bar.setSpacing(10)

        # Text search
        self.search_box = QLineEdit(self)
        self.search_box.setPlaceholderText("Search file path or entity...")
        self.search_box.setFixedWidth(280)
        self.search_box.textChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.search_box)

        # Entity filter dropdown
        self.combo_entity = QComboBox(self)
        self.combo_entity.addItem("All Entities")
        self.combo_entity.setFixedWidth(180)
        self.combo_entity.currentIndexChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.combo_entity)

        # Confidence minimum filter
        lbl_min_conf = QLabel("Min Conf:", self)
        lbl_min_conf.setStyleSheet("color: #94a3b8; font-size: 12px;")
        filter_bar.addWidget(lbl_min_conf)

        self.spin_min_conf = QComboBox(self)
        for conf_val in ["0.00", "0.40", "0.50", "0.60", "0.70", "0.80", "0.90"]:
            self.spin_min_conf.addItem(conf_val)
        self.spin_min_conf.setCurrentText("0.00")
        self.spin_min_conf.currentIndexChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.spin_min_conf)

        filter_bar.addStretch()

        # Action Buttons
        self.btn_export_csv = QPushButton("Export CSV", self)
        self.btn_export_csv.clicked.connect(self._on_export_csv)
        self.btn_export_csv.setEnabled(False)

        self.btn_extract = QPushButton("Extract Flagged Files", self)
        self.btn_extract.clicked.connect(self._on_extract_files)
        self.btn_extract.setEnabled(False)

        self.btn_quarantine = QPushButton("Quarantine Files", self)
        self.btn_quarantine.setObjectName("warningButton")
        self.btn_quarantine.clicked.connect(self._on_quarantine_files)
        self.btn_quarantine.setEnabled(False)

        filter_bar.addWidget(self.btn_export_csv)
        filter_bar.addWidget(self.btn_extract)
        filter_bar.addWidget(self.btn_quarantine)

        main_layout.addLayout(filter_bar)

        # 3. Findings Table
        self.table = QTableWidget(self)
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "File Path", "Entity Type", "Value (Redacted)", "Confidence", "File Size", "Last Modified"
        ])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setSortingEnabled(True)

        # Context menu
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._show_context_menu)

        main_layout.addWidget(self.table)

    def set_scan_results(self, summary: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
        """Load scan summary and findings into the table."""
        self.scan_summary = summary
        self.findings = findings
        self.root_scan_folder = summary.get("target_folder", "")

        total = len(findings)
        files_count = summary.get("files_with_pii", 0)
        self.lbl_status.setText(
            f"Target: {self.root_scan_folder} | {total} findings in {files_count} flagged files."
        )

        html_path = summary.get("report_html")
        self.btn_open_report.setEnabled(bool(html_path and Path(html_path).exists()))
        has_findings = total > 0
        self.btn_export_csv.setEnabled(has_findings)
        self.btn_extract.setEnabled(has_findings)
        self.btn_quarantine.setEnabled(has_findings)

        # Update entity combo box
        current_entity = self.combo_entity.currentText()
        self.combo_entity.blockSignals(True)
        self.combo_entity.clear()
        self.combo_entity.addItem("All Entities")
        unique_entities = sorted(list({f.get("entity", "") for f in findings if f.get("entity")}))
        for ent in unique_entities:
            self.combo_entity.addItem(ent)
        if current_entity in unique_entities:
            self.combo_entity.setCurrentText(current_entity)
        self.combo_entity.blockSignals(False)

        self._populate_table(self.findings)

    def _populate_table(self, items: List[Dict[str, Any]]) -> None:
        self.table.setSortingEnabled(False)
        self.table.setRowCount(len(items))

        for row_idx, item in enumerate(items):
            # File Path
            file_path = item.get("file", "")
            item_file = QTableWidgetItem(file_path)
            item_file.setToolTip(file_path)
            self.table.setItem(row_idx, 0, item_file)

            # Entity Type
            ent = item.get("entity", "")
            item_ent = QTableWidgetItem(ent)
            item_ent.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 1, item_ent)

            # Value (Redacted)
            redacted = item.get("value_redacted", item.get("value", ""))
            item_val = QTableWidgetItem(redacted)
            item_val.setToolTip(f"Redacted Preview: {redacted}")
            item_val.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 2, item_val)

            # Confidence
            conf = float(item.get("confidence", 0.0))
            item_conf = QTableWidgetItem(f"{conf:.2f}")
            item_conf.setTextAlignment(Qt.AlignCenter)
            # Custom sorting role for numeric sort
            item_conf.setData(Qt.UserRole, conf)
            self.table.setItem(row_idx, 3, item_conf)

            # File Size
            size_bytes = int(item.get("file_size_bytes", 0))
            item_size = QTableWidgetItem(format_file_size(size_bytes))
            item_size.setData(Qt.UserRole, size_bytes)
            item_size.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            self.table.setItem(row_idx, 4, item_size)

            # Last Modified
            mtime = str(item.get("last_modified", ""))
            item_time = QTableWidgetItem(mtime)
            item_time.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 5, item_time)

        self.table.setSortingEnabled(True)

    def _apply_filters(self) -> None:
        """Filter table rows by search text, entity type, and minimum confidence."""
        search_query = self.search_box.text().strip().lower()
        selected_entity = self.combo_entity.currentText()
        min_conf = float(self.spin_min_conf.currentText())

        filtered = []
        for f in self.findings:
            # Check confidence
            if float(f.get("confidence", 0.0)) < min_conf:
                continue
            # Check entity
            if selected_entity != "All Entities" and f.get("entity") != selected_entity:
                continue
            # Check search query
            if search_query:
                file_text = f.get("file", "").lower()
                ent_text = f.get("entity", "").lower()
                val_text = f.get("value_redacted", "").lower()
                if search_query not in file_text and search_query not in ent_text and search_query not in val_text:
                    continue
            filtered.append(f)

        self._populate_table(filtered)

    def _show_context_menu(self, pos) -> None:
        item = self.table.itemAt(pos)
        if not item:
            return

        row = item.row()
        file_path_item = self.table.item(row, 0)
        redacted_val_item = self.table.item(row, 2)
        if not file_path_item:
            return

        file_path = file_path_item.text()
        redacted_val = redacted_val_item.text() if redacted_val_item else ""

        menu = QMenu(self)

        action_open_folder = QAction("Open Containing Folder", self)
        action_open_folder.triggered.connect(lambda: reveal_in_explorer(file_path))
        menu.addAction(action_open_folder)

        action_open_file = QAction("Open File with Default App", self)
        action_open_file.triggered.connect(lambda: open_file_default(file_path))
        menu.addAction(action_open_file)

        menu.addSeparator()

        action_copy_path = QAction("Copy File Path", self)
        action_copy_path.triggered.connect(lambda: QGuiApplication.clipboard().setText(file_path))
        menu.addAction(action_copy_path)

        if redacted_val:
            action_copy_val = QAction("Copy Redacted Value", self)
            action_copy_val.triggered.connect(lambda: QGuiApplication.clipboard().setText(redacted_val))
            menu.addAction(action_copy_val)

        menu.exec(self.table.viewport().mapToGlobal(pos))

    def _on_open_html_report(self) -> None:
        html_path = self.scan_summary.get("report_html")
        if html_path and Path(html_path).exists():
            webbrowser.open(Path(html_path).resolve().as_uri())
        else:
            QMessageBox.warning(self, "Report Not Found", "The HTML dashboard report file could not be found.")

    def _on_export_csv(self) -> None:
        """Export currently filtered findings to a user-chosen CSV file."""
        if not self.findings:
            return

        save_path, _ = QFileDialog.getSaveFileName(
            self, "Save Filtered Results as CSV", "pii_findings_export.csv", "CSV Files (*.csv)"
        )
        if not save_path:
            return

        # Export what is currently visible in the table
        row_count = self.table.rowCount()
        rows_to_export = []
        for r in range(row_count):
            rows_to_export.append({
                "file": self.table.item(r, 0).text(),
                "entity": self.table.item(r, 1).text(),
                "value_redacted": self.table.item(r, 2).text(),
                "confidence": self.table.item(r, 3).text(),
                "file_size": self.table.item(r, 4).text(),
                "last_modified": self.table.item(r, 5).text(),
            })

        try:
            with open(save_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f, fieldnames=["file", "entity", "value_redacted", "confidence", "file_size", "last_modified"]
                )
                writer.writeheader()
                for row in rows_to_export:
                    writer.writerow(row)
            QMessageBox.information(self, "Export Successful", f"Exported {len(rows_to_export)} findings to:\n{save_path}")
        except Exception as e:
            QMessageBox.critical(self, "Export Failed", f"Failed to save CSV file:\n{e}")

    def _get_flagged_files_list(self) -> List[str]:
        """Return list of unique file paths containing PII."""
        return list(dict.fromkeys(f.get("file", "") for f in self.findings if f.get("file")))

    def _on_extract_files(self) -> None:
        """Dialog to extract flagged files to a target directory."""
        flagged = self._get_flagged_files_list()
        if not flagged:
            QMessageBox.information(self, "No Flagged Files", "No files to extract.")
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("Extract Flagged Files")
        dialog.setFixedWidth(460)

        d_layout = QVBoxLayout(dialog)
        d_layout.setSpacing(12)

        info_lbl = QLabel(
            f"Extract {len(flagged)} unique files that contain PII.\n"
            "Files will be organized preserving their relative folder hierarchy.", dialog
        )
        d_layout.addWidget(info_lbl)

        # Dest folder picker
        folder_layout = QHBoxLayout()
        edit_dest = QLineEdit(dialog)
        edit_dest.setPlaceholderText("Select extraction destination folder...")
        default_folder = config_manager.default_output_folder or str(Path.home() / "PII_Extracted")
        edit_dest.setText(default_folder)

        btn_pick = QPushButton("Browse...", dialog)
        btn_pick.clicked.connect(lambda: edit_dest.setText(
            QFileDialog.getExistingDirectory(dialog, "Select Destination Folder", edit_dest.text()) or edit_dest.text()
        ))
        folder_layout.addWidget(edit_dest)
        folder_layout.addWidget(btn_pick)
        d_layout.addLayout(folder_layout)

        # Destructive move checkbox
        chk_move = QCheckBox("Move files instead of copying (DESTRUCTIVE - removes originals)", dialog)
        chk_move.setStyleSheet("color: #f87171; font-weight: 600;")
        d_layout.addWidget(chk_move)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel, dialog)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        d_layout.addWidget(buttons)

        if dialog.exec() == QDialog.Accepted:
            dest = edit_dest.text().strip()
            if not dest:
                QMessageBox.warning(self, "Missing Destination", "Please specify a destination folder.")
                return

            is_move = chk_move.isChecked()
            if is_move:
                confirm = QMessageBox.question(
                    self, "Confirm Destructive Move",
                    "Are you sure you want to MOVE these files? The original files will be deleted from their original locations!",
                    QMessageBox.Yes | QMessageBox.No
                )
                if confirm != QMessageBox.Yes:
                    return

            res = extract_flagged_files(
                files=flagged,
                destination_folder=dest,
                root_scan_folder=self.root_scan_folder,
                move_files=is_move
            )
            QMessageBox.information(
                self, "Extraction Complete",
                f"Extraction finished ({res['mode']}).\n"
                f"Successful: {res['successful_count']}\n"
                f"Failed: {res['failed_count']}\n"
                f"Destination: {dest}"
            )

    def _on_quarantine_files(self) -> None:
        """Dialog to zip flagged files into a password-protected quarantine archive."""
        flagged = self._get_flagged_files_list()
        if not flagged:
            QMessageBox.information(self, "No Flagged Files", "No files to quarantine.")
            return

        dialog = QDialog(self)
        dialog.setWindowTitle("Quarantine Flagged Files")
        dialog.setFixedWidth(480)

        d_layout = QVBoxLayout(dialog)
        d_layout.setSpacing(12)

        info_lbl = QLabel(
            f"Quarantine {len(flagged)} sensitive files into a secure ZIP archive.\n"
            "Relative directory structure will be preserved inside the archive.", dialog
        )
        d_layout.addWidget(info_lbl)

        # Destination ZIP path
        d_layout.addWidget(QLabel("Quarantine Archive (.zip) Destination:", dialog))
        zip_layout = QHBoxLayout()
        edit_zip = QLineEdit(dialog)
        default_zip = str(Path.home() / "PII_Quarantine.zip")
        edit_zip.setText(default_zip)

        btn_zip_pick = QPushButton("Browse...", dialog)
        btn_zip_pick.clicked.connect(lambda: edit_zip.setText(
            QFileDialog.getSaveFileName(dialog, "Save Quarantine Archive", edit_zip.text(), "ZIP Files (*.zip)")[0] or edit_zip.text()
        ))
        zip_layout.addWidget(edit_zip)
        zip_layout.addWidget(btn_zip_pick)
        d_layout.addLayout(zip_layout)

        # Password
        d_layout.addWidget(QLabel("Archive Encryption Password (Optional):", dialog))
        edit_pass = QLineEdit(dialog)
        edit_pass.setEchoMode(QLineEdit.Password)
        edit_pass.setPlaceholderText("Leave empty for no password...")
        d_layout.addWidget(edit_pass)

        # Destructive modifications opt-ins
        chk_rename = QCheckBox("Rename originals with '.quarantined' suffix (Disables file)", dialog)
        chk_rename.setStyleSheet("color: #fbbf24; font-weight: 600;")
        d_layout.addWidget(chk_rename)

        chk_delete = QCheckBox("Permanently delete original files after quarantine (DESTRUCTIVE)", dialog)
        chk_delete.setStyleSheet("color: #f87171; font-weight: 600;")
        d_layout.addWidget(chk_delete)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel, dialog)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        d_layout.addWidget(buttons)

        if dialog.exec() == QDialog.Accepted:
            zip_dest = edit_zip.text().strip()
            if not zip_dest:
                QMessageBox.warning(self, "Missing Path", "Please specify a destination zip path.")
                return

            password = edit_pass.text().strip() or None
            do_rename = chk_rename.isChecked()
            do_delete = chk_delete.isChecked()

            if do_delete:
                confirm = QMessageBox.question(
                    self, "Confirm File Deletion",
                    "Are you sure you want to permanently DELETE the original sensitive files from disk?",
                    QMessageBox.Yes | QMessageBox.No
                )
                if confirm != QMessageBox.Yes:
                    return

            q_res = quarantine_flagged_files(
                files=flagged,
                zip_destination_path=zip_dest,
                root_scan_folder=self.root_scan_folder,
                password=password,
                rename_originals=do_rename and not do_delete,
                delete_originals=do_delete
            )

            if q_res.get("success"):
                QMessageBox.information(
                    self, "Quarantine Complete",
                    f"Quarantine archive successfully created!\n"
                    f"Archived Files: {q_res['files_archived']}\n"
                    f"Encrypted: {'Yes' if q_res['is_encrypted'] else 'No'}\n"
                    f"Output: {zip_dest}"
                )
            else:
                QMessageBox.critical(
                    self, "Quarantine Failed",
                    f"Failed to create quarantine archive:\n{q_res.get('error')}"
                )
