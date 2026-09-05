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
from backend.classifier import SensitivityTier, TIER_METADATA



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
        self.is_unmasked: bool = False
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

        # 2. Filter & Search Toolbar (Row 1)
        filter_bar = QHBoxLayout()
        filter_bar.setSpacing(10)

        # Text search
        self.search_box = QLineEdit(self)
        self.search_box.setPlaceholderText("🔍 Search file path or entity...")
        self.search_box.setFixedWidth(280)
        self.search_box.textChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.search_box)

        # Entity filter dropdown
        self.combo_entity = QComboBox(self)
        self.combo_entity.addItem("All Entities")
        self.combo_entity.setFixedWidth(180)
        self.combo_entity.currentIndexChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.combo_entity)

        # Classification filter dropdown
        self.combo_classification = QComboBox(self)
        self.combo_classification.addItem("All Classifications")
        self.combo_classification.addItem("🟣 Restricted")
        self.combo_classification.addItem("🔴 Highly Confidential")
        self.combo_classification.addItem("🟠 Confidential")
        self.combo_classification.addItem("⚪ General")
        self.combo_classification.addItem("🟢 Public")
        self.combo_classification.setFixedWidth(180)
        self.combo_classification.currentIndexChanged.connect(self._apply_filters)
        filter_bar.addWidget(self.combo_classification)

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

        # Reveal Full Values Toggle Button
        self.btn_toggle_reveal = QPushButton("👁️ Reveal Full Values", self)
        self.btn_toggle_reveal.setCheckable(True)
        self.btn_toggle_reveal.setChecked(False)
        self.btn_toggle_reveal.setToolTip("Toggle displaying unmasked raw PII values instead of starred previews")
        self.btn_toggle_reveal.setStyleSheet("""
            QPushButton {
                background-color: #162036;
                color: #94a3b8;
                border: 1px solid #2a3b5c;
                border-radius: 6px;
                padding: 6px 14px;
                font-size: 12px;
                font-weight: 600;
            }
            QPushButton:hover {
                background-color: #202d4a;
                border-color: #3b82f6;
                color: #60a5fa;
            }
            QPushButton:checked {
                background-color: rgba(239, 68, 68, 0.2);
                color: #fca5a5;
                border: 1px solid #ef4444;
            }
        """)
        self.btn_toggle_reveal.toggled.connect(self._on_toggle_reveal)
        filter_bar.addWidget(self.btn_toggle_reveal)
        filter_bar.addStretch()

        main_layout.addLayout(filter_bar)

        # 2b. Actions Bar (Row 2)
        actions_bar = QHBoxLayout()
        actions_bar.setSpacing(10)

        self.lbl_table_count = QLabel("Double-click any row to inspect complete unclipped path and values.", self)
        self.lbl_table_count.setStyleSheet("color: #64748b; font-size: 11px;")
        actions_bar.addWidget(self.lbl_table_count)
        actions_bar.addStretch()

        # Action Buttons
        self.btn_export_csv = QPushButton("📥 Export CSV", self)
        self.btn_export_csv.setFixedHeight(32)
        self.btn_export_csv.clicked.connect(self._on_export_csv)
        self.btn_export_csv.setEnabled(False)

        self.btn_extract = QPushButton("📁 Extract Flagged Files", self)
        self.btn_extract.setFixedHeight(32)
        self.btn_extract.clicked.connect(self._on_extract_files)
        self.btn_extract.setEnabled(False)

        self.btn_quarantine = QPushButton("🛡️ Quarantine Files", self)
        self.btn_quarantine.setFixedHeight(32)
        self.btn_quarantine.setObjectName("warningButton")
        self.btn_quarantine.clicked.connect(self._on_quarantine_files)
        self.btn_quarantine.setEnabled(False)

        actions_bar.addWidget(self.btn_export_csv)
        actions_bar.addWidget(self.btn_extract)
        actions_bar.addWidget(self.btn_quarantine)

        main_layout.addLayout(actions_bar)

        # 3. Findings Table
        self.table = QTableWidget(self)
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "File Path", "Entity Type", "Sensitivity", "Value (Redacted)", "Confidence", "File Size", "Last Modified"
        ])
        # Make File Path column interactive with generous width so users can inspect and resize with no forced clipping
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Interactive)
        self.table.setColumnWidth(0, 380)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setSelectionMode(QTableWidget.SingleSelection)
        self.table.setSortingEnabled(True)

        # Context menu & row inspection
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._show_context_menu)
        self.table.doubleClicked.connect(self._on_row_double_clicked)

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
            # 0. File Path (Unclipped with full tooltip and resizing)
            file_path = item.get("file", "")
            item_file = QTableWidgetItem(file_path)
            item_file.setToolTip(f"Full File Path: {file_path}\n(Double-click row to view full details)")
            self.table.setItem(row_idx, 0, item_file)

            # 1. Entity Type
            ent = item.get("entity", "")
            item_ent = QTableWidgetItem(ent)
            item_ent.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 1, item_ent)

            # 2. Sensitivity Classification (Microsoft Purview 5-Tier)
            tier_name = item.get("classification", SensitivityTier.GENERAL.value)
            tier_info = TIER_METADATA.get(tier_name, TIER_METADATA.get(SensitivityTier.GENERAL.value, {}))
            badge_text = item.get("classification_badge", tier_info.get("badge", tier_name))
            rationale = item.get("classification_rationale", tier_info.get("description", ""))

            item_sens = QTableWidgetItem(badge_text)
            item_sens.setTextAlignment(Qt.AlignCenter)
            item_sens.setToolTip(f"Sensitivity: {tier_name} (Level {tier_info.get('level', 1)}/5)\nRationale: {rationale}")
            item_sens.setForeground(QColor(tier_info.get("color", "#94a3b8")))
            item_sens.setData(Qt.UserRole, tier_name)
            item_sens.setData(Qt.UserRole + 1, tier_info.get("level", 1))
            self.table.setItem(row_idx, 2, item_sens)

            # 3. Value (Toggles between Redacted and Unmasked Raw Value)
            raw_val = item.get("value", "")
            redacted_val = item.get("value_redacted", raw_val)

            if self.is_unmasked:
                display_val = raw_val or redacted_val
                item_val = QTableWidgetItem(display_val)
                item_val.setToolTip(f"Full Raw Value (Unmasked): {display_val}")
                item_val.setForeground(QColor("#fca5a5"))  # Coral warning tint for sensitive unmasked data
            else:
                display_val = redacted_val
                item_val = QTableWidgetItem(display_val)
                item_val.setToolTip(f"Redacted Preview: {display_val}\n(Click 'Reveal Full Values' at top to unmask)")
                item_val.setForeground(QColor("#e2e8f0"))

            item_val.setTextAlignment(Qt.AlignCenter)
            # Store raw and redacted in UserRole for instant access
            item_val.setData(Qt.UserRole, raw_val)
            item_val.setData(Qt.UserRole + 1, redacted_val)
            self.table.setItem(row_idx, 3, item_val)

            # 4. Confidence
            conf = float(item.get("confidence", 0.0))
            item_conf = QTableWidgetItem(f"{conf:.2f}")
            item_conf.setTextAlignment(Qt.AlignCenter)
            item_conf.setData(Qt.UserRole, conf)
            self.table.setItem(row_idx, 4, item_conf)

            # 5. File Size
            size_bytes = int(item.get("file_size_bytes", 0))
            item_size = QTableWidgetItem(format_file_size(size_bytes))
            item_size.setData(Qt.UserRole, size_bytes)
            item_size.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            self.table.setItem(row_idx, 5, item_size)

            # 6. Last Modified
            mtime = str(item.get("last_modified", ""))
            item_time = QTableWidgetItem(mtime)
            item_time.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_idx, 6, item_time)

        self.table.setSortingEnabled(True)

    def _on_toggle_reveal(self, checked: bool) -> None:
        """Toggle between displaying masked/starred values and raw unmasked PII."""
        self.is_unmasked = checked
        header_item = self.table.horizontalHeaderItem(3)
        if checked:
            self.btn_toggle_reveal.setText("🔒 Mask Sensitive Values")
            if header_item:
                header_item.setText("Value (Full / Unmasked)")
        else:
            self.btn_toggle_reveal.setText("👁️ Reveal Full Values")
            if header_item:
                header_item.setText("Value (Redacted)")

        # Refresh currently visible rows
        self._apply_filters()

    def _apply_filters(self) -> None:
        """Filter table rows by search text, entity type, classification, and minimum confidence."""
        search_query = self.search_box.text().strip().lower()
        selected_entity = self.combo_entity.currentText()
        selected_class = self.combo_classification.currentText()
        min_conf = float(self.spin_min_conf.currentText())

        filtered = []
        for f in self.findings:
            # Check confidence
            if float(f.get("confidence", 0.0)) < min_conf:
                continue
            # Check entity
            if selected_entity != "All Entities" and f.get("entity") != selected_entity:
                continue
            # Check classification
            if selected_class != "All Classifications":
                target_tier = selected_class.split(" ", 1)[-1].strip().lower()
                item_tier = f.get("classification", "").lower()
                if target_tier not in item_tier:
                    continue
            # Check search query across path, entity, classification, redacted value, and raw value
            if search_query:
                file_text = f.get("file", "").lower()
                ent_text = f.get("entity", "").lower()
                class_text = f.get("classification", "").lower()
                red_text = f.get("value_redacted", "").lower()
                raw_text = f.get("value", "").lower()
                if (search_query not in file_text and search_query not in ent_text and
                        search_query not in class_text and search_query not in red_text and
                        search_query not in raw_text):
                    continue
            filtered.append(f)

        self._populate_table(filtered)

    def _on_row_double_clicked(self, index) -> None:
        """Open detailed finding inspector dialog when a table row is double-clicked."""
        row = index.row()
        file_path = self.table.item(row, 0).text() if self.table.item(row, 0) else ""
        # Find matching finding in self.findings
        matched = None
        for f in self.findings:
            if f.get("file") == file_path:
                matched = f
                break
        if not matched and row < len(self.findings):
            matched = self.findings[row]

        if matched:
            dlg = FindingDetailsDialog(matched, self)
            dlg.exec()

    def _show_context_menu(self, pos) -> None:
        item = self.table.itemAt(pos)
        if not item:
            return

        row = item.row()
        file_path_item = self.table.item(row, 0)
        val_item = self.table.item(row, 3)
        if not file_path_item:
            return

        file_path = file_path_item.text()
        raw_val = val_item.data(Qt.UserRole) if val_item else ""
        redacted_val = val_item.data(Qt.UserRole + 1) if val_item else ""

        menu = QMenu(self)

        action_inspect = QAction("🔍 Inspect Finding Details...", self)
        action_inspect.triggered.connect(lambda: self._on_row_double_clicked(self.table.model().index(row, 0)))
        menu.addAction(action_inspect)

        menu.addSeparator()

        action_open_folder = QAction("📂 Open Containing Folder", self)
        action_open_folder.triggered.connect(lambda: reveal_in_explorer(file_path))
        menu.addAction(action_open_folder)

        action_open_file = QAction("📄 Open File with Default App", self)
        action_open_file.triggered.connect(lambda: open_file_default(file_path))
        menu.addAction(action_open_file)

        menu.addSeparator()

        action_copy_path = QAction("📋 Copy Full File Path", self)
        action_copy_path.triggered.connect(lambda: QGuiApplication.clipboard().setText(file_path))
        menu.addAction(action_copy_path)

        if raw_val:
            action_copy_raw = QAction("👁️ Copy Full Raw Value", self)
            action_copy_raw.triggered.connect(lambda: QGuiApplication.clipboard().setText(raw_val))
            menu.addAction(action_copy_raw)

        if redacted_val:
            action_copy_red = QAction("🔒 Copy Redacted Value", self)
            action_copy_red.triggered.connect(lambda: QGuiApplication.clipboard().setText(redacted_val))
            menu.addAction(action_copy_red)

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
                "classification": self.table.item(r, 2).text(),
                "value_redacted": self.table.item(r, 3).text(),
                "confidence": self.table.item(r, 4).text(),
                "file_size": self.table.item(r, 5).text(),
                "last_modified": self.table.item(r, 6).text(),
            })

        try:
            with open(save_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f, fieldnames=["file", "entity", "classification", "value_redacted", "confidence", "file_size", "last_modified"]
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


class FindingDetailsDialog(QDialog):
    """
    Modal dialog displaying the full unclipped details of a finding,
    including complete file path, full raw unmasked value, redacted preview,
    and file metadata, with one-click copy and folder actions.
    """

    def __init__(self, item: Dict[str, Any], parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setWindowTitle("Finding Inspector - PII Sentinel")
        self.resize(680, 440)
        self.setModal(True)
        self.item = item
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(14)

        # Header
        header = QHBoxLayout()
        vbox = QVBoxLayout()
        title = QLabel("Finding Inspection Details", self)
        title.setStyleSheet("font-size: 16px; font-weight: 700; color: #f8fafc;")
        vbox.addWidget(title)
        header.addLayout(vbox)
        header.addStretch()

        entity = self.item.get("entity", "UNKNOWN")
        badge = QLabel(entity, self)
        badge.setStyleSheet(
            "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
            "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
        )
        header.addWidget(badge)

        # Classification Badge (Microsoft Purview Tier)
        tier_name = self.item.get("classification", SensitivityTier.GENERAL.value)
        tier_info = TIER_METADATA.get(tier_name, TIER_METADATA.get(SensitivityTier.GENERAL.value, {}))
        class_color = tier_info.get("color", "#94a3b8")
        class_badge = QLabel(self.item.get("classification_badge", f"{tier_name}"), self)
        class_badge.setStyleSheet(
            f"background: rgba(255, 255, 255, 0.08); color: {class_color}; border: 1px solid {class_color}; "
            f"border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
        )
        class_badge.setToolTip(f"Sensitivity: {tier_name} (Level {tier_info.get('level', 1)}/5)\nRationale: {self.item.get('classification_rationale', tier_info.get('description', ''))}")
        header.addWidget(class_badge)
        layout.addLayout(header)

        # Full File Path Section
        file_path = self.item.get("file", "")
        grp_file = QWidget(self)
        grp_file.setStyleSheet("background: #0d1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px;")
        vbox_file = QVBoxLayout(grp_file)
        vbox_file.setSpacing(6)

        lbl_f_hdr = QLabel("Full File Location (Unclipped):", grp_file)
        lbl_f_hdr.setStyleSheet("font-size: 11px; font-weight: 600; color: #94a3b8;")
        vbox_file.addWidget(lbl_f_hdr)

        lbl_f_val = QLabel(file_path, grp_file)
        lbl_f_val.setStyleSheet("font-family: monospace; font-size: 12px; color: #f1f5f9;")
        lbl_f_val.setWordWrap(True)
        lbl_f_val.setTextInteractionFlags(Qt.TextSelectableByMouse)
        vbox_file.addWidget(lbl_f_val)

        btn_row_f = QHBoxLayout()
        btn_copy_path = QPushButton("📋 Copy Full Path", grp_file)
        btn_copy_path.clicked.connect(lambda: QGuiApplication.clipboard().setText(file_path))
        btn_open_folder = QPushButton("📂 Open Folder", grp_file)
        btn_open_folder.clicked.connect(lambda: reveal_in_explorer(file_path))
        btn_row_f.addWidget(btn_copy_path)
        btn_row_f.addWidget(btn_open_folder)
        btn_row_f.addStretch()
        vbox_file.addLayout(btn_row_f)
        layout.addWidget(grp_file)

        # PII Values Section (Raw vs Redacted)
        raw_val = self.item.get("value", "")
        redacted_val = self.item.get("value_redacted", raw_val)

        grp_val = QWidget(self)
        grp_val.setStyleSheet("background: #0d1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px;")
        vbox_val = QVBoxLayout(grp_val)
        vbox_val.setSpacing(8)

        # Raw Value Row
        row_raw = QHBoxLayout()
        lbl_raw_hdr = QLabel("Full Raw Value (Unmasked):", grp_val)
        lbl_raw_hdr.setStyleSheet("font-size: 11px; font-weight: 600; color: #f87171; min-width: 170px;")
        lbl_raw = QLabel(raw_val or "(Not stored)", grp_val)
        lbl_raw.setStyleSheet("font-family: monospace; font-size: 13px; color: #fca5a5; font-weight: 700;")
        lbl_raw.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lbl_raw.setWordWrap(True)
        btn_copy_raw = QPushButton("Copy Raw", grp_val)
        btn_copy_raw.clicked.connect(lambda: QGuiApplication.clipboard().setText(raw_val))
        row_raw.addWidget(lbl_raw_hdr)
        row_raw.addWidget(lbl_raw, 1)
        row_raw.addWidget(btn_copy_raw)
        vbox_val.addLayout(row_raw)

        # Redacted Value Row
        row_red = QHBoxLayout()
        lbl_red_hdr = QLabel("Redacted Safe Preview:", grp_val)
        lbl_red_hdr.setStyleSheet("font-size: 11px; font-weight: 600; color: #94a3b8; min-width: 170px;")
        lbl_red = QLabel(redacted_val, grp_val)
        lbl_red.setStyleSheet("font-family: monospace; font-size: 12px; color: #e2e8f0;")
        lbl_red.setTextInteractionFlags(Qt.TextSelectableByMouse)
        btn_copy_red = QPushButton("Copy Redacted", grp_val)
        btn_copy_red.clicked.connect(lambda: QGuiApplication.clipboard().setText(redacted_val))
        row_red.addWidget(lbl_red_hdr)
        row_red.addWidget(lbl_red, 1)
        row_red.addWidget(btn_copy_red)
        vbox_val.addLayout(row_red)

        # Metadata stats & Classification Rationale
        meta_row = QVBoxLayout()
        meta_row.setSpacing(4)
        conf = float(self.item.get("confidence", 0.0))
        size_bytes = int(self.item.get("file_size_bytes", 0))
        mtime = str(self.item.get("last_modified", "N/A"))
        start_idx = self.item.get("start", "N/A")
        end_idx = self.item.get("end", "N/A")
        rationale = self.item.get("classification_rationale", tier_info.get("description", ""))

        lbl_meta = QLabel(
            f"Confidence: {conf:.2f}   •   Size: {format_file_size(size_bytes)}   •   "
            f"Offset: [{start_idx}:{end_idx}]   •   Modified: {mtime}",
            grp_val
        )
        lbl_meta.setStyleSheet("color: #64748b; font-size: 11px;")
        meta_row.addWidget(lbl_meta)

        lbl_rationale = QLabel(f"Sensitivity Classification: {tier_name} — {rationale}", grp_val)
        lbl_rationale.setStyleSheet(f"color: {class_color}; font-size: 11px; font-weight: 600;")
        meta_row.addWidget(lbl_rationale)
        vbox_val.addLayout(meta_row)

        layout.addWidget(grp_val)

        # Close button
        btn_close = QPushButton("Close", self)
        btn_close.clicked.connect(self.accept)
        btn_close.setStyleSheet(
            "background-color: #2563eb; color: #ffffff; font-weight: 700; "
            "border-radius: 8px; padding: 7px 22px; font-size: 12px;"
        )
        btn_box = QHBoxLayout()
        btn_box.addStretch()
        btn_box.addWidget(btn_close)
        layout.addLayout(btn_box)
