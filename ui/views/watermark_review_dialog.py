"""
Watermark Candidates Review Dialog
Human-in-the-loop review workflow for approving sensitive file watermarking.
Provides per-file and per-tier batch selection, two-step safety confirmation,
real-time progress feedback, and execution summary.
"""

import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QCheckBox,
    QProgressBar, QMessageBox, QWidget, QFrame, QLineEdit
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor

from backend.classifier import SensitivityTier, TIER_METADATA
from backend.watermark_engine import WatermarkEngine, WatermarkStatus
from backend.config import ConfigManager


def format_size(size_bytes: int) -> str:
    """Format bytes into a human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


class WatermarkReviewDialog(QDialog):
    """
    Review modal allowing operators to selectively approve or deselect
    candidate files before bulk watermarking and pre-mutation backups.
    """

    watermarking_completed = Signal(dict)

    def __init__(self, candidates: List[Dict[str, Any]], parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setWindowTitle("Watermark Candidates Review — PII Sentinel")
        self.resize(920, 580)
        self.setModal(True)

        self.candidates = candidates
        self.checkbox_map: Dict[int, QCheckBox] = {}
        self.config_mgr = ConfigManager()
        self.engine = WatermarkEngine(
            min_tier=self.config_mgr.get("watermark_min_tier", "Confidential"),
            template=self.config_mgr.get("watermark_template")
        )

        self._build_ui()
        self._populate_table()
        self._update_selection_summary()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 20, 24, 20)
        layout.setSpacing(14)

        # Header Section
        header_box = QHBoxLayout()
        vbox_title = QVBoxLayout()
        title = QLabel("🛡️ Watermark Candidates Review", self)
        title.setStyleSheet("font-size: 18px; font-weight: 800; color: #f8fafc;")
        vbox_title.addWidget(title)

        subtitle = QLabel(
            "Review detected sensitive files eligible for watermarking. "
            "Files remain untouched until explicitly approved with a pre-mutation backup.",
            self
        )
        subtitle.setStyleSheet("font-size: 12px; color: #94a3b8;")
        vbox_title.addWidget(subtitle)
        header_box.addLayout(vbox_title)
        header_box.addStretch()

        layout.addLayout(header_box)

        # Bulk Actions Toolbar
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        btn_select_all = QPushButton("Select All", self)
        btn_select_all.clicked.connect(self._select_all)
        toolbar.addWidget(btn_select_all)

        btn_deselect_all = QPushButton("Deselect All", self)
        btn_deselect_all.clicked.connect(self._deselect_all)
        toolbar.addWidget(btn_deselect_all)

        # Per-Tier Bulk Toggles
        tier_confidential = QPushButton("Toggle Confidential", self)
        tier_confidential.clicked.connect(lambda: self._toggle_tier(SensitivityTier.CONFIDENTIAL.value))
        toolbar.addWidget(tier_confidential)

        tier_highly = QPushButton("Toggle Highly Confidential", self)
        tier_highly.clicked.connect(lambda: self._toggle_tier(SensitivityTier.HIGHLY_CONFIDENTIAL.value))
        toolbar.addWidget(tier_highly)

        tier_restricted = QPushButton("Toggle Restricted", self)
        tier_restricted.clicked.connect(lambda: self._toggle_tier(SensitivityTier.RESTRICTED.value))
        toolbar.addWidget(tier_restricted)

        toolbar.addStretch()

        # Search / Filter Box
        self.search_edit = QLineEdit(self)
        self.search_edit.setPlaceholderText("Filter files...")
        self.search_edit.setMaximumWidth(200)
        self.search_edit.textChanged.connect(self._filter_rows)
        toolbar.addWidget(self.search_edit)

        layout.addLayout(toolbar)

        # Candidates Table
        self.table = QTableWidget(self)
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(["", "Tier", "File Name", "Entities Found", "Size", "Current Status"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Fixed)
        self.table.setColumnWidth(0, 40)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setAlternatingRowColors(True)
        layout.addWidget(self.table)

        # Progress Bar (initially hidden)
        self.progress_bar = QProgressBar(self)
        self.progress_bar.setVisible(False)
        self.progress_bar.setStyleSheet("height: 8px; border-radius: 4px;")
        layout.addWidget(self.progress_bar)

        # Footer Action Section
        footer = QHBoxLayout()
        self.lbl_summary = QLabel("0 files selected", self)
        self.lbl_summary.setStyleSheet("font-size: 13px; font-weight: 600; color: #cbd5e1;")
        footer.addWidget(self.lbl_summary)

        footer.addStretch()

        self.btn_cancel = QPushButton("Cancel / Skip", self)
        self.btn_cancel.clicked.connect(self.reject)
        footer.addWidget(self.btn_cancel)

        self.btn_apply = QPushButton("Watermark Selected Files", self)
        self.btn_apply.setStyleSheet("""
            background-color: #2563eb;
            color: #ffffff;
            font-weight: 700;
            padding: 8px 20px;
            border-radius: 6px;
        """)
        self.btn_apply.clicked.connect(self._on_apply_clicked)
        footer.addWidget(self.btn_apply)

        layout.addLayout(footer)

    def _populate_table(self) -> None:
        """Populate table with candidate files."""
        self.table.setRowCount(len(self.candidates))
        self.checkbox_map.clear()

        for row_idx, item in enumerate(self.candidates):
            file_path = item.get("file_path", "")
            p = Path(file_path)
            tier_name = item.get("tier", "Confidential")
            tier_meta = TIER_METADATA.get(tier_name, TIER_METADATA.get("Confidential", {}))
            tier_color = tier_meta.get("color", "#f59e0b")
            status = item.get("watermark_status", "none")
            entities = item.get("entities", "") or "PII Findings"
            size_bytes = item.get("file_size_bytes", 0)

            # Col 0: Checkbox widget
            chk_widget = QWidget()
            chk_layout = QHBoxLayout(chk_widget)
            chk_layout.setContentsMargins(8, 0, 0, 0)
            chk_layout.setAlignment(Qt.AlignCenter)
            chk = QCheckBox()
            chk.setChecked(status != "applied")  # Default checked unless already applied
            chk.stateChanged.connect(self._update_selection_summary)
            chk_layout.addWidget(chk)
            self.table.setCellWidget(row_idx, 0, chk_widget)
            self.checkbox_map[row_idx] = chk

            # Col 1: Tier Badge
            lbl_tier = QLabel(tier_name)
            lbl_tier.setAlignment(Qt.AlignCenter)
            lbl_tier.setStyleSheet(
                f"color: {tier_color}; font-weight: 700; padding: 2px 8px; "
                f"background: rgba(255, 255, 255, 0.05); border: 1px solid {tier_color}; border-radius: 8px;"
            )
            self.table.setCellWidget(row_idx, 1, lbl_tier)

            # Col 2: File Name + Tooltip
            item_file = QTableWidgetItem(p.name)
            item_file.setToolTip(file_path)
            item_file.setFlags(item_file.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(row_idx, 2, item_file)

            # Col 3: Entities
            item_entities = QTableWidgetItem(str(entities))
            item_entities.setFlags(item_entities.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(row_idx, 3, item_entities)

            # Col 4: File Size
            item_size = QTableWidgetItem(format_size(size_bytes))
            item_size.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
            item_size.setFlags(item_size.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(row_idx, 4, item_size)

            # Col 5: Current Status
            status_text = {
                "none": "Pending Review",
                "applied": "Already Watermarked",
                "reverted": "Reverted",
                "failed": "Prior Failure"
            }.get(status, status.capitalize())
            item_status = QTableWidgetItem(status_text)
            item_status.setFlags(item_status.flags() & ~Qt.ItemIsEditable)
            self.table.setItem(row_idx, 5, item_status)

    def _select_all(self) -> None:
        for chk in self.checkbox_map.values():
            chk.setChecked(True)
        self._update_selection_summary()

    def _deselect_all(self) -> None:
        for chk in self.checkbox_map.values():
            chk.setChecked(False)
        self._update_selection_summary()

    def _toggle_tier(self, target_tier: str) -> None:
        for row_idx, item in enumerate(self.candidates):
            if item.get("tier", "").upper() == target_tier.upper():
                chk = self.checkbox_map.get(row_idx)
                if chk:
                    chk.setChecked(not chk.isChecked())
        self._update_selection_summary()

    def _filter_rows(self, query: str) -> None:
        query = query.strip().lower()
        for row_idx in range(self.table.rowCount()):
            item = self.candidates[row_idx]
            match = (
                not query
                or query in item.get("file_path", "").lower()
                or query in item.get("tier", "").lower()
                or query in item.get("entities", "").lower()
            )
            self.table.setRowHidden(row_idx, not match)

    def _get_selected_candidates(self) -> List[Dict[str, Any]]:
        selected = []
        for row_idx, item in enumerate(self.candidates):
            chk = self.checkbox_map.get(row_idx)
            if chk and chk.isChecked():
                selected.append(item)
        return selected

    def _update_selection_summary(self) -> None:
        selected = self._get_selected_candidates()
        total_size = sum(item.get("file_size_bytes", 0) for item in selected)
        self.lbl_summary.setText(
            f"Selected: {len(selected)} of {len(self.candidates)} files ({format_size(total_size)})"
        )
        self.btn_apply.setEnabled(len(selected) > 0)

    def _on_apply_clicked(self) -> None:
        """
        Step 2: Explicit Confirmation Dialog before mutating any files on disk.
        """
        selected = self._get_selected_candidates()
        if not selected:
            return

        count = len(selected)
        total_size = format_size(sum(item.get("file_size_bytes", 0) for item in selected))

        confirm_msg = (
            f"You are about to watermark {count} files ({total_size}).\n\n"
            "Safety Guarantee:\n"
            "• A byte-for-byte pre-mutation backup of each file will be saved in your "
            "local backup store before any file is altered.\n"
            "• Watermarks can be undone at any time via 'Undo Watermark'.\n\n"
            "Do you want to proceed with watermarking these files?"
        )

        reply = QMessageBox.question(
            self,
            "Confirm Batch Watermarking",
            confirm_msg,
            QMessageBox.Yes | QMessageBox.Cancel,
            QMessageBox.Cancel
        )

        if reply != QMessageBox.Yes:
            return

        # Execute Watermarking Batch
        self._execute_watermarking_batch(selected)

    def _execute_watermarking_batch(self, selected_candidates: List[Dict[str, Any]]) -> None:
        """Apply watermarks to all approved files and present results summary."""
        self.btn_apply.setEnabled(False)
        self.btn_cancel.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.progress_bar.setRange(0, len(selected_candidates))
        self.progress_bar.setValue(0)

        succeeded = 0
        skipped = 0
        failed = []

        for i, item in enumerate(selected_candidates):
            file_path = item.get("file_path", "")
            tier = item.get("tier", "Confidential")

            res = self.engine.apply_watermark(file_path, tier=tier)
            if res.status == WatermarkStatus.APPLIED:
                succeeded += 1
            elif res.status == WatermarkStatus.SKIPPED_ALREADY_WATERMARKED:
                skipped += 1
            else:
                failed.append({
                    "file": Path(file_path).name,
                    "path": file_path,
                    "reason": res.message
                })

            self.progress_bar.setValue(i + 1)

        summary = {
            "total_selected": len(selected_candidates),
            "succeeded": succeeded,
            "skipped": skipped,
            "failed_count": len(failed),
            "failures": failed
        }

        self.watermarking_completed.emit(summary)

        # Show final result summary dialog
        summary_msg = (
            f"Watermarking Complete:\n\n"
            f"  [OK] Successfully watermarked: {succeeded} files\n"
            f"  [SKIP] Skipped (already watermarked): {skipped} files\n"
            f"  [FAIL] Failed: {len(failed)} files\n"
        )
        if failed:
            summary_msg += "\nFailed Files:\n"
            for f in failed[:5]:
                summary_msg += f"• {f['file']}: {f['reason']}\n"
            if len(failed) > 5:
                summary_msg += f"... and {len(failed) - 5} more."

        QMessageBox.information(self, "Watermarking Batch Summary", summary_msg)
        self.accept()
