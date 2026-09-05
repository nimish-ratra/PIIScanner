"""
Scan View for PII Sentinel
Provides responsive directory selection, dynamic PII entity chips,
worker concurrency slider, execution controls, KPI telemetry, and live activity logs.
Encased in a root QScrollArea to prevent any layout squishing or text clipping.
"""

import os
from pathlib import Path
from typing import List, Optional

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QProgressBar, QFileDialog, QGroupBox,
    QCheckBox, QScrollArea, QGridLayout, QFrame, QMessageBox
)
from PySide6.QtCore import Qt, Signal

from backend.config import config_manager
from backend.presidio_detector import PresidioDetector
from ui.components.stat_card import StatCard
from ui.components.log_viewer import LogViewer
from ui.workers.scan_worker import ScanWorker


class ScanView(QWidget):
    """Main scanning interface."""

    # Emitted when a scan is finished and findings are ready
    scan_completed_signal = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.worker: Optional[ScanWorker] = None
        self.entity_checkboxes = {}
        self._init_ui()
        self._load_entities()
        self._update_folder_preview()

    def _init_ui(self) -> None:
        # Outer layout containing root scroll area
        root_vbox = QVBoxLayout(self)
        root_vbox.setContentsMargins(0, 0, 0, 0)
        root_vbox.setSpacing(0)

        # Root ScrollArea ensures no content is squished on small screens or DPI scaling
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)

        container = QWidget()
        main_layout = QVBoxLayout(container)
        main_layout.setContentsMargins(24, 16, 24, 20)
        main_layout.setSpacing(14)

        # 1. Title Header
        header_vbox = QVBoxLayout()
        header_vbox.setSpacing(2)

        title_label = QLabel("Enterprise Directory Scanner", container)
        title_label.setStyleSheet("font-size: 22px; font-weight: 800; letter-spacing: -0.3px;")

        subtitle_label = QLabel(
            "Recursively inspect local directories and documents for sensitive PII using air-gapped on-premise engines.",
            container
        )
        subtitle_label.setStyleSheet("font-size: 13px; color: #94a3b8;")

        header_vbox.addWidget(title_label)
        header_vbox.addWidget(subtitle_label)
        main_layout.addLayout(header_vbox)

        # 2. Target Directory Card
        dir_group = QGroupBox("Target Directory", container)
        dir_layout = QVBoxLayout(dir_group)
        dir_layout.setContentsMargins(16, 14, 16, 14)
        dir_layout.setSpacing(8)

        input_row = QHBoxLayout()
        input_row.setSpacing(10)

        self.edit_folder = QLineEdit(dir_group)
        self.edit_folder.setFixedHeight(38)
        self.edit_folder.setPlaceholderText("Select or drag & drop folder to audit recursively...")
        self.edit_folder.setText(config_manager.get("last_scanned_folder", ""))
        self.edit_folder.textChanged.connect(self._update_folder_preview)

        self.btn_browse = QPushButton("📁 Browse Directory...", dir_group)
        self.btn_browse.setFixedHeight(38)
        self.btn_browse.setFixedWidth(170)
        self.btn_browse.clicked.connect(self._on_browse_folder)

        input_row.addWidget(self.edit_folder, 1)
        input_row.addWidget(self.btn_browse)
        dir_layout.addLayout(input_row)

        # Real-time folder preview & helper notice
        self.lbl_folder_preview = QLabel(dir_group)
        self.lbl_folder_preview.setWordWrap(True)
        dir_layout.addWidget(self.lbl_folder_preview)

        main_layout.addWidget(dir_group)
        self.setAcceptDrops(True)

        # 3. Two-Column Configuration Grid
        config_layout = QHBoxLayout()
        config_layout.setSpacing(16)

        # 3a. Left Column: Entity Selection Group
        entity_group = QGroupBox("PII Detection Types", container)
        entity_vbox = QVBoxLayout(entity_group)
        entity_vbox.setContentsMargins(16, 14, 16, 14)
        entity_vbox.setSpacing(10)

        # Quick action controls
        btn_bar = QHBoxLayout()
        btn_bar.setSpacing(8)

        self.btn_select_all_entities = QPushButton("Select All", entity_group)
        self.btn_select_all_entities.setFixedHeight(26)
        self.btn_select_all_entities.setStyleSheet("font-size: 11px; padding: 2px 10px;")
        self.btn_select_all_entities.clicked.connect(self._select_all_entities)

        self.btn_clear_entities = QPushButton("Deselect All", entity_group)
        self.btn_clear_entities.setFixedHeight(26)
        self.btn_clear_entities.setStyleSheet("font-size: 11px; padding: 2px 10px;")
        self.btn_clear_entities.clicked.connect(self._deselect_all_entities)

        self.lbl_selected_count = QLabel("All Selected", entity_group)
        self.lbl_selected_count.setStyleSheet("font-size: 11px; color: #60a5fa; font-weight: 600;")

        btn_bar.addWidget(self.btn_select_all_entities)
        btn_bar.addWidget(self.btn_clear_entities)
        btn_bar.addStretch()
        btn_bar.addWidget(self.lbl_selected_count)
        entity_vbox.addLayout(btn_bar)

        # Scroll area for dynamic entities
        self.entity_scroll = QScrollArea(entity_group)
        self.entity_scroll.setWidgetResizable(True)
        self.entity_scroll.setFixedHeight(135)
        self.entity_scroll.setStyleSheet(
            "background-color: transparent; border: 1px solid #1e2e4a; border-radius: 8px;"
        )

        self.entity_container = QWidget()
        self.entity_grid = QGridLayout(self.entity_container)
        self.entity_grid.setContentsMargins(10, 8, 10, 8)
        self.entity_grid.setSpacing(8)
        self.entity_scroll.setWidget(self.entity_container)
        entity_vbox.addWidget(self.entity_scroll)

        config_layout.addWidget(entity_group, 3)

        # 3b. Right Column: Scan Engine & Concurrency Configuration Group
        engine_group = QGroupBox("Engine && Concurrency Settings", container)
        engine_vbox = QVBoxLayout(engine_group)
        engine_vbox.setContentsMargins(16, 14, 16, 14)
        engine_vbox.setSpacing(12)

        # Concurrent Workers Section
        worker_header = QHBoxLayout()
        worker_lbl = QLabel("Concurrent Worker Threads:", engine_group)
        worker_lbl.setStyleSheet("font-weight: 600; font-size: 12px;")
        self.lbl_workers_val = QLabel("", engine_group)
        self.lbl_workers_val.setStyleSheet(
            "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); "
            "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 12px;"
        )
        worker_header.addWidget(worker_lbl)
        worker_header.addStretch()
        worker_header.addWidget(self.lbl_workers_val)
        engine_vbox.addLayout(worker_header)

        self.slider_workers = QSlider(Qt.Horizontal, engine_group)
        self.slider_workers.setRange(1, 8)
        default_workers = config_manager.max_workers
        self.slider_workers.setValue(default_workers)
        self.slider_workers.valueChanged.connect(self._on_workers_changed)
        engine_vbox.addWidget(self.slider_workers)

        worker_guide = QLabel("1 (Sequential)   •   2 (Balanced)   •   4 (Fast)   •   8 (Turbo)", engine_group)
        worker_guide.setStyleSheet("color: #64748b; font-size: 10px; font-weight: 600;")
        engine_vbox.addWidget(worker_guide)

        self._on_workers_changed(default_workers)

        # Divider
        divider = QFrame(engine_group)
        divider.setFrameShape(QFrame.HLine)
        divider.setFrameShadow(QFrame.Sunken)
        divider.setStyleSheet("color: #1e293b; margin-top: 4px; margin-bottom: 4px;")
        engine_vbox.addWidget(divider)

        # Confidence Threshold Section
        thresh_header = QHBoxLayout()
        thresh_lbl = QLabel("Minimum Confidence Threshold:", engine_group)
        thresh_lbl.setStyleSheet("font-weight: 600; font-size: 12px;")
        self.lbl_threshold_val = QLabel("0.60 (60%)", engine_group)
        self.lbl_threshold_val.setStyleSheet(
            "background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); "
            "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 12px;"
        )
        thresh_header.addWidget(thresh_lbl)
        thresh_header.addStretch()
        thresh_header.addWidget(self.lbl_threshold_val)
        engine_vbox.addLayout(thresh_header)

        self.slider_threshold = QSlider(Qt.Horizontal, engine_group)
        self.slider_threshold.setRange(10, 100)
        default_thresh = int(config_manager.confidence_threshold * 100)
        self.slider_threshold.setValue(default_thresh)
        self.slider_threshold.valueChanged.connect(self._on_slider_changed)
        engine_vbox.addWidget(self.slider_threshold)

        thresh_desc = QLabel("Higher threshold reduces false positives; lower finds subtle entity matches.", engine_group)
        thresh_desc.setWordWrap(True)
        thresh_desc.setStyleSheet("color: #64748b; font-size: 11px;")
        engine_vbox.addWidget(thresh_desc)
        engine_vbox.addStretch()

        config_layout.addWidget(engine_group, 2)
        main_layout.addLayout(config_layout)

        # 4. Primary Action Controls Bar
        controls_bar = QHBoxLayout()
        controls_bar.setSpacing(14)

        self.btn_start = QPushButton("  ▶  Start Audit Scan", container)
        self.btn_start.setObjectName("primaryButton")
        self.btn_start.setFixedHeight(42)
        self.btn_start.setMinimumWidth(180)
        self.btn_start.clicked.connect(self._on_start_scan)

        self.btn_pause = QPushButton("⏸  Pause", container)
        self.btn_pause.setObjectName("warningButton")
        self.btn_pause.setFixedHeight(42)
        self.btn_pause.setMinimumWidth(110)
        self.btn_pause.setEnabled(False)
        self.btn_pause.clicked.connect(self._on_toggle_pause)

        self.btn_cancel = QPushButton("⏹  Cancel", container)
        self.btn_cancel.setObjectName("dangerButton")
        self.btn_cancel.setFixedHeight(42)
        self.btn_cancel.setMinimumWidth(110)
        self.btn_cancel.setEnabled(False)
        self.btn_cancel.clicked.connect(self._on_cancel_scan)

        controls_bar.addWidget(self.btn_start)
        controls_bar.addWidget(self.btn_pause)
        controls_bar.addWidget(self.btn_cancel)
        controls_bar.addStretch()

        main_layout.addLayout(controls_bar)

        # 5. Live Progress & Telemetry KPIs
        progress_box = QGroupBox("Live Scan Progress && Telemetry", container)
        progress_vbox = QVBoxLayout(progress_box)
        progress_vbox.setContentsMargins(18, 18, 18, 18)
        progress_vbox.setSpacing(14)

        # Progress bar
        self.progress_bar = QProgressBar(progress_box)
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFixedHeight(22)
        progress_vbox.addWidget(self.progress_bar)

        # Current file indicator
        file_row = QHBoxLayout()
        self.lbl_current_file = QLabel("Ready to scan", progress_box)
        self.lbl_current_file.setStyleSheet("color: #94a3b8; font-family: monospace; font-size: 12px;")
        file_row.addWidget(self.lbl_current_file)
        file_row.addStretch()
        progress_vbox.addLayout(file_row)

        # Metric Cards Grid (Guaranteed minimum dimensions, never collapses)
        metrics_layout = QHBoxLayout()
        metrics_layout.setSpacing(14)

        self.card_scanned = StatCard("Files Scanned", "0", "#38bdf8", "📁", progress_box)
        self.card_flagged = StatCard("Files with PII", "0", "#f87171", "⚠️", progress_box)
        self.card_findings = StatCard("Total Findings", "0", "#fbbf24", "🔍", progress_box)
        self.card_time = StatCard("Elapsed Time", "0.0s", "#34d399", "⏱️", progress_box)

        metrics_layout.addWidget(self.card_scanned)
        metrics_layout.addWidget(self.card_flagged)
        metrics_layout.addWidget(self.card_findings)
        metrics_layout.addWidget(self.card_time)

        progress_vbox.addLayout(metrics_layout)
        main_layout.addWidget(progress_box)

        # 6. Live Activity Log Viewer
        self.log_viewer = LogViewer(container)
        main_layout.addWidget(self.log_viewer)

        # Finalize root scroll area
        scroll.setWidget(container)
        root_vbox.addWidget(scroll)

    def _load_entities(self) -> None:
        """Query Presidio dynamically for supported entities and populate checkboxes."""
        try:
            detector = PresidioDetector.get_instance()
            entities = detector.get_supported_entities()
        except Exception:
            entities = ["EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "PERSON", "IP_ADDRESS", "US_SSN"]

        saved_entities = config_manager.selected_entities

        row = 0
        col = 0
        cols_per_row = 2

        for entity in sorted(entities):
            cb = QCheckBox(entity, self.entity_container)
            is_checked = (not saved_entities) or (entity in saved_entities)
            cb.setChecked(is_checked)
            cb.stateChanged.connect(self._on_entity_checkbox_changed)
            self.entity_checkboxes[entity] = cb
            self.entity_grid.addWidget(cb, row, col)

            col += 1
            if col >= cols_per_row:
                col = 0
                row += 1

        self._update_selected_count_label()

    def _on_entity_checkbox_changed(self) -> None:
        self._update_selected_count_label()

    def _update_selected_count_label(self) -> None:
        total = len(self.entity_checkboxes)
        selected = sum(1 for cb in self.entity_checkboxes.values() if cb.isChecked())
        if selected == total:
            self.lbl_selected_count.setText(f"All ({total}) Selected")
        elif selected == 0:
            self.lbl_selected_count.setText("None Selected (Warning)")
        else:
            self.lbl_selected_count.setText(f"{selected} of {total} Selected")

    def _select_all_entities(self) -> None:
        for cb in self.entity_checkboxes.values():
            cb.setChecked(True)
        self._update_selected_count_label()

    def _deselect_all_entities(self) -> None:
        for cb in self.entity_checkboxes.values():
            cb.setChecked(False)
        self._update_selected_count_label()

    def _get_active_entities(self) -> Optional[List[str]]:
        selected = [ent for ent, cb in self.entity_checkboxes.items() if cb.isChecked()]
        if len(selected) == len(self.entity_checkboxes):
            return None  # All selected
        return selected

    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        for url in event.mimeData().urls():
            local_path = url.toLocalFile()
            if os.path.isdir(local_path):
                self.edit_folder.setText(os.path.normpath(local_path))
                config_manager.set("last_scanned_folder", os.path.normpath(local_path))
                break

    def _update_folder_preview(self) -> None:
        folder = self.edit_folder.text().strip()
        if not folder or not os.path.isdir(folder):
            self.lbl_folder_preview.setText(
                "💡 Note: Click 'Browse Directory...' or paste a target folder to scan all documents recursively."
            )
            self.lbl_folder_preview.setStyleSheet("color: #64748b; font-size: 11px;")
            return

        # Enumerate matching files in folder
        exts = {e.lower() for e in config_manager.supported_extensions}
        found_files = []
        total_count = 0
        try:
            for dirpath, _, filenames in os.walk(folder):
                for fn in filenames:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext in exts:
                        total_count += 1
                        if len(found_files) < 4:
                            found_files.append(fn)
        except Exception:
            pass

        if total_count > 0:
            preview_str = ", ".join(found_files)
            if total_count > 4:
                preview_str += f", ... (+{total_count - 4} more)"
            self.lbl_folder_preview.setText(
                f"✓ Detected {total_count} supported document(s) in selected folder: [{preview_str}]"
            )
            self.lbl_folder_preview.setStyleSheet("color: #34d399; font-size: 12px; font-weight: 600;")
        else:
            self.lbl_folder_preview.setText(
                "⚠️ No supported documents (.docx, .pdf, .txt, .csv, etc.) found in this folder."
            )
            self.lbl_folder_preview.setStyleSheet("color: #fbbf24; font-size: 12px;")

    def _on_browse_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(
            self, "Select Folder to Scan (Click 'Select Folder' at bottom right)",
            self.edit_folder.text() or os.path.expanduser("~")
        )
        if folder:
            norm_folder = os.path.normpath(folder)
            self.edit_folder.setText(norm_folder)
            config_manager.set("last_scanned_folder", norm_folder)
            self._update_folder_preview()

    def _on_slider_changed(self, val: int) -> None:
        score = val / 100.0
        self.lbl_threshold_val.setText(f"{score:.2f} ({val}%)")

    def _on_workers_changed(self, val: int) -> None:
        if val == 1:
            tier = "1 Worker [Sequential]"
        elif val == 2:
            tier = "2 Workers [Balanced]"
        elif val == 4:
            tier = "4 Workers [Fast - High CPU]"
        elif val < 4:
            tier = f"{val} Workers [Balanced]"
        else:
            tier = f"{val} Workers [Turbo]"
        self.lbl_workers_val.setText(tier)

    def _on_start_scan(self) -> None:
        folder = self.edit_folder.text().strip()
        if not folder or not os.path.isdir(folder):
            QMessageBox.warning(self, "Invalid Directory", "Please select a valid existing directory to scan.")
            return

        # Check if at least one entity is selected
        active_entities = self._get_active_entities()
        if active_entities is not None and len(active_entities) == 0:
            QMessageBox.warning(self, "No Entities Selected", "Please select at least one PII entity type to detect.")
            return

        # Reset UI
        self.progress_bar.setValue(0)
        self.card_scanned.set_value("0")
        self.card_flagged.set_value("0")
        self.card_findings.set_value("0")
        self.card_time.set_value("0.0s")
        self.lbl_current_file.setText(f"Initializing scan for {folder}...")
        self.log_viewer.clear()

        # Update button and input states
        self.btn_start.setEnabled(False)
        self.btn_browse.setEnabled(False)
        self.edit_folder.setEnabled(False)
        self.slider_threshold.setEnabled(False)
        self.slider_workers.setEnabled(False)
        self.btn_pause.setEnabled(True)
        self.btn_pause.setText("⏸  Pause")
        self.btn_cancel.setEnabled(True)

        # Launch Worker Thread
        threshold = self.slider_threshold.value() / 100.0
        workers = self.slider_workers.value()
        config_manager.max_workers = workers

        self.worker = ScanWorker(
            target_folder=folder,
            confidence_threshold=threshold,
            selected_entities=active_entities,
            supported_extensions=config_manager.supported_extensions,
            max_file_size_mb=config_manager.max_file_size_mb,
            max_workers=workers,
            ocr_enabled=config_manager.ocr_enabled,
            parent=self
        )

        self.worker.progress_updated.connect(self._on_worker_progress)
        self.worker.finding_discovered.connect(self._on_worker_finding)
        self.worker.log_emitted.connect(self._on_worker_log)
        self.worker.scan_finished.connect(self._on_worker_finished)
        self.worker.scan_error.connect(self._on_worker_error)

        self.worker.start()

    def _on_toggle_pause(self) -> None:
        if not self.worker:
            return
        if self.worker.is_paused():
            self.worker.resume()
            self.btn_pause.setText("⏸  Pause")
            self.lbl_current_file.setText("Resuming scan...")
        else:
            self.worker.pause()
            self.btn_pause.setText("▶  Resume")
            self.lbl_current_file.setText("Scan paused.")

    def _on_cancel_scan(self) -> None:
        if self.worker:
            self.worker.cancel()
            self.lbl_current_file.setText("Cancelling scan...")
            self.btn_cancel.setEnabled(False)
            self.btn_pause.setEnabled(False)

    def _on_worker_progress(self, scanned: int, total: int, current_file: str, elapsed: float) -> None:
        pct = int((scanned / total) * 100) if total > 0 else 0
        self.progress_bar.setValue(pct)
        self.card_scanned.set_value(f"{scanned}/{total}")
        self.card_time.set_value(f"{elapsed:.1f}s")
        # Format filename to fit
        display_name = os.path.basename(current_file)
        self.lbl_current_file.setText(f"Scanning: {display_name}")
        self.lbl_current_file.setToolTip(current_file)

    def _on_worker_finding(self, finding: dict) -> None:
        current_findings = int(self.card_findings.get_value()) + 1
        self.card_findings.set_value(str(current_findings))
        if self.worker and self.worker.scanner:
            self.card_flagged.set_value(str(self.worker.scanner.files_with_pii))

    def _on_worker_log(self, message: str, level: str) -> None:
        self.log_viewer.append_log(message, level)

    def _on_worker_finished(self, summary: dict) -> None:
        self.progress_bar.setValue(100)
        self.card_scanned.set_value(str(summary.get("files_scanned", 0)))
        self.card_flagged.set_value(str(summary.get("files_with_pii", 0)))
        self.card_findings.set_value(str(summary.get("total_findings", 0)))
        self.card_time.set_value(f"{summary.get('duration_seconds', 0):.1f}s")
        self.lbl_current_file.setText(f"Scan finished: {summary.get('status', 'done').upper()}")

        # Restore button states
        self.btn_start.setEnabled(True)
        self.btn_browse.setEnabled(True)
        self.edit_folder.setEnabled(True)
        self.slider_threshold.setEnabled(True)
        self.slider_workers.setEnabled(True)
        self.btn_pause.setEnabled(False)
        self.btn_pause.setText("⏸  Pause")
        self.btn_cancel.setEnabled(False)

        # Notify parent / main window
        self.scan_completed_signal.emit(summary)

    def _on_worker_error(self, err_msg: str) -> None:
        QMessageBox.critical(self, "Scan Error", f"An error occurred during the scan:\n{err_msg}")
        self.btn_start.setEnabled(True)
        self.btn_browse.setEnabled(True)
        self.edit_folder.setEnabled(True)
        self.slider_threshold.setEnabled(True)
        self.slider_workers.setEnabled(True)
        self.btn_pause.setEnabled(False)
        self.btn_cancel.setEnabled(False)
