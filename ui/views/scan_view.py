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
from ui.components.pii_selector_dialog import (
    PiiSelectorDialog, PiiViewerDialog, FileViewerDialog, ENTITY_CATEGORIES
)
from ui.workers.scan_worker import ScanWorker


class ScanView(QWidget):
    """Main scanning interface."""

    # Emitted when a scan is finished and findings are ready
    scan_completed_signal = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.worker: Optional[ScanWorker] = None
        self.all_supported_entities: List[str] = []
        self.selected_entities: List[str] = []
        self._detected_file_list: List[str] = []
        self.entity_checkboxes = {}  # Backwards compatibility
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

        # Real-time folder preview row & full file list inspector button
        preview_row = QHBoxLayout()
        self.lbl_folder_preview = QLabel(dir_group)
        self.lbl_folder_preview.setWordWrap(True)
        preview_row.addWidget(self.lbl_folder_preview, 1)

        self.btn_view_all_files = QPushButton("📄 View All Files", dir_group)
        self.btn_view_all_files.setFixedHeight(28)
        self.btn_view_all_files.setStyleSheet(
            "background: rgba(30, 41, 59, 0.8); color: #38bdf8; border: 1px solid #1e293b; "
            "border-radius: 6px; padding: 2px 12px; font-size: 11px; font-weight: 600;"
        )
        self.btn_view_all_files.clicked.connect(self._on_view_all_files)
        self.btn_view_all_files.setVisible(False)
        preview_row.addWidget(self.btn_view_all_files)

        dir_layout.addLayout(preview_row)

        main_layout.addWidget(dir_group)
        self.setAcceptDrops(True)

        # 3. Two-Column Configuration Grid
        config_layout = QHBoxLayout()
        config_layout.setSpacing(16)

        # 3a. Left Column: Dynamic PII Detection Types Configuration Group (Lag-Free Modal Approach)
        entity_group = QGroupBox("PII Detection Types", container)
        entity_vbox = QVBoxLayout(entity_group)
        entity_vbox.setContentsMargins(16, 14, 16, 14)
        entity_vbox.setSpacing(12)

        # Active status header row
        hdr_row = QHBoxLayout()
        hdr_lbl = QLabel("Active Detection Configuration:", entity_group)
        hdr_lbl.setStyleSheet("font-weight: 600; font-size: 12px; color: #e2e8f0;")
        self.lbl_selected_count = QLabel("All 36 Types Active", entity_group)
        self.lbl_selected_count.setStyleSheet(
            "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
            "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 11px;"
        )
        hdr_row.addWidget(hdr_lbl)
        hdr_row.addStretch()
        hdr_row.addWidget(self.lbl_selected_count)
        entity_vbox.addLayout(hdr_row)

        # Categorized Summary Card
        self.card_category_summary = QWidget(entity_group)
        self.card_category_summary.setStyleSheet(
            "background-color: #0d1322; border: 1px solid #1e293b; border-radius: 8px;"
        )
        card_layout = QVBoxLayout(self.card_category_summary)
        card_layout.setContentsMargins(12, 10, 12, 10)
        card_layout.setSpacing(6)

        self.lbl_category_summary = QLabel(self.card_category_summary)
        self.lbl_category_summary.setStyleSheet("color: #94a3b8; font-size: 12px; font-weight: 500;")
        self.lbl_category_summary.setWordWrap(True)
        card_layout.addWidget(self.lbl_category_summary)

        note_lbl = QLabel("Zero cloud communication. All Presidio NER & Regex recognizers run locally.", self.card_category_summary)
        note_lbl.setStyleSheet("color: #64748b; font-size: 11px;")
        card_layout.addWidget(note_lbl)

        entity_vbox.addWidget(self.card_category_summary)

        # Prominent Buttons Row: "View Current PII Types" & "Edit PII Detection Types..."
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        self.btn_view_entities = QPushButton("👁️ View Current PII Types", entity_group)
        self.btn_view_entities.setFixedHeight(36)
        self.btn_view_entities.setStyleSheet(
            "background-color: #162036; color: #f1f5f9; border: 1px solid #2a3b5c; "
            "border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 600;"
        )
        self.btn_view_entities.clicked.connect(self._on_view_entities)

        self.btn_edit_entities = QPushButton("⚙️ Edit PII Detection Types...", entity_group)
        self.btn_edit_entities.setFixedHeight(36)
        self.btn_edit_entities.setStyleSheet(
            "background-color: #2563eb; color: #ffffff; border: 1px solid #3b82f6; "
            "border-radius: 6px; padding: 6px 16px; font-size: 12px; font-weight: 700;"
        )
        self.btn_edit_entities.clicked.connect(self._on_edit_entities)

        btn_row.addWidget(self.btn_view_entities)
        btn_row.addWidget(self.btn_edit_entities)
        entity_vbox.addLayout(btn_row)

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
        metrics_layout.setSpacing(12)

        self.card_scanned = StatCard("Files Scanned", "0", "#38bdf8", "📁", progress_box)
        self.card_flagged = StatCard("Files with PII", "0", "#f87171", "⚠️", progress_box)
        self.card_findings = StatCard("Total Findings", "0", "#fbbf24", "🔍", progress_box)
        self.card_rate = StatCard("Scan Rate", "0 f/s", "#a855f7", "⚡", progress_box)
        self.card_time = StatCard("Elapsed Time", "0.0s", "#34d399", "⏱️", progress_box)

        metrics_layout.addWidget(self.card_scanned)
        metrics_layout.addWidget(self.card_flagged)
        metrics_layout.addWidget(self.card_findings)
        metrics_layout.addWidget(self.card_rate)
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
        """Query Presidio dynamically for supported entities and initialize active selection."""
        try:
            detector = PresidioDetector.get_instance()
            self.all_supported_entities = detector.get_supported_entities()
        except Exception:
            self.all_supported_entities = [
                "IN_AADHAAR", "IN_PAN", "IN_GSTIN", "IN_IFSC", "IN_PASSPORT", "IN_VOTER_ID",
                "AWS_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "GOOGLE_API_KEY", "SLACK_TOKEN", "PRIVATE_KEY", "JWT_TOKEN",
                "CREDIT_CARD", "CRYPTO", "IBAN_CODE", "US_BANK_NUMBER",
                "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "LOCATION", "DATE_TIME", "AGE", "IP_ADDRESS", "URL", "NRP", "MEDICAL_LICENSE", "US_SSN", "US_PASSPORT",
                "US_DRIVER_LICENSE", "US_ITIN", "UK_NHS", "ES_NIF", "IT_FISCAL_CODE", "IT_DRIVER_LICENSE", "IT_PASSPORT"
            ]

        self.all_supported_entities = sorted(self.all_supported_entities)
        saved = config_manager.selected_entities
        if saved and len(saved) > 0:
            self.selected_entities = [e for e in saved if e in self.all_supported_entities]
        else:
            self.selected_entities = list(self.all_supported_entities)

        # Backwards compatibility dummy objects for any tests accessing entity_checkboxes
        self.entity_checkboxes = {
            e: type("DummyCB", (), {
                "isChecked": lambda _cb, ent=e: ent in self.selected_entities,
                "setChecked": lambda _cb, val, ent=e: self._set_entity_checked(ent, val)
            })()
            for e in self.all_supported_entities
        }

        self._update_selected_count_label()
        self._update_category_summary()

    def _set_entity_checked(self, entity: str, checked: bool) -> None:
        if checked and entity not in self.selected_entities:
            self.selected_entities.append(entity)
        elif not checked and entity in self.selected_entities:
            self.selected_entities.remove(entity)
        self._update_selected_count_label()
        self._update_category_summary()

    def _update_selected_count_label(self) -> None:
        total = len(self.all_supported_entities)
        selected = len(self.selected_entities)
        if selected == total:
            self.lbl_selected_count.setText(f"All {total} Types Active")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); "
                "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 11px;"
            )
        elif selected == 0:
            self.lbl_selected_count.setText("0 Active (Warning: None)")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); "
                "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 11px;"
            )
        else:
            self.lbl_selected_count.setText(f"{selected} of {total} Types Active")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
                "border-radius: 10px; padding: 2px 10px; font-weight: 700; font-size: 11px;"
            )

    def _update_category_summary(self) -> None:
        active_set = set(self.selected_entities)
        chips = []
        for cat_name, cat_data in ENTITY_CATEGORIES.items():
            cat_ents = [e for e, _ in cat_data["entities"] if e in self.all_supported_entities]
            if not cat_ents:
                continue
            act_count = sum(1 for e in cat_ents if e in active_set)
            chips.append(f"{cat_data['badge']}: {act_count}/{len(cat_ents)}")

        self.lbl_category_summary.setText("   •   ".join(chips))

    def _on_view_entities(self) -> None:
        """Open read-only viewer displaying active PII types."""
        dlg = PiiViewerDialog(self.selected_entities, self)
        dlg.exec()

    def _on_edit_entities(self) -> None:
        """Open modal configuration dialog to select active entities with zero scroll lag."""
        dlg = PiiSelectorDialog(self.all_supported_entities, self.selected_entities, self)
        if dlg.exec():
            self.selected_entities = dlg.get_selected_entities()
            config_manager.selected_entities = self.selected_entities
            self._update_selected_count_label()
            self._update_category_summary()

    def _select_all_entities(self) -> None:
        self.selected_entities = list(self.all_supported_entities)
        config_manager.selected_entities = self.selected_entities
        self._update_selected_count_label()
        self._update_category_summary()

    def _deselect_all_entities(self) -> None:
        self.selected_entities = []
        config_manager.selected_entities = []
        self._update_selected_count_label()
        self._update_category_summary()

    def _get_active_entities(self) -> Optional[List[str]]:
        if len(self.selected_entities) == len(self.all_supported_entities):
            return None  # Presidio convention: None means analyze all supported entities
        return list(self.selected_entities)

    def _on_view_all_files(self) -> None:
        """Open file explorer dialog displaying complete list of discovered files."""
        folder = self.edit_folder.text().strip()
        if self._detected_file_list and folder:
            dlg = FileViewerDialog(self._detected_file_list, folder, self)
            dlg.exec()

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
            self.lbl_folder_preview.setToolTip("")
            self.btn_view_all_files.setVisible(False)
            self._detected_file_list = []
            return

        self.edit_folder.setToolTip(f"Full Target Folder Path: {folder}")
        exts = {e.lower() for e in config_manager.supported_extensions}
        self._detected_file_list = []
        try:
            for dirpath, _, filenames in os.walk(folder):
                for fn in filenames:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext in exts:
                        rel = os.path.relpath(os.path.join(dirpath, fn), folder)
                        self._detected_file_list.append(rel)
        except Exception:
            pass

        total_count = len(self._detected_file_list)
        if total_count > 0:
            if total_count <= 8:
                names = [os.path.basename(f) for f in self._detected_file_list]
                preview_str = ", ".join(names)
                self.lbl_folder_preview.setText(
                    f"✓ Detected {total_count} supported document(s) in selected folder: [{preview_str}]"
                )
                self.btn_view_all_files.setVisible(False)
            else:
                first_few = [os.path.basename(f) for f in self._detected_file_list[:5]]
                preview_str = ", ".join(first_few)
                self.lbl_folder_preview.setText(
                    f"✓ Detected {total_count} supported document(s) in selected folder: [{preview_str}, ...]"
                )
                self.btn_view_all_files.setText(f"📄 View All {total_count} Files")
                self.btn_view_all_files.setVisible(True)

            self.lbl_folder_preview.setStyleSheet("color: #34d399; font-size: 12px; font-weight: 600;")
            tooltip_files = "\n".join(self._detected_file_list[:60])
            if total_count > 60:
                tooltip_files += f"\n... and {total_count - 60} more files (click 'View All Files' button to inspect full list)"
            self.lbl_folder_preview.setToolTip(f"Discovered Documents ({total_count} total):\n{tooltip_files}")
        else:
            self.lbl_folder_preview.setText(
                "⚠️ No supported documents (.docx, .pdf, .txt, .csv, etc.) found in this folder."
            )
            self.lbl_folder_preview.setStyleSheet("color: #fbbf24; font-size: 12px;")
            self.lbl_folder_preview.setToolTip("")
            self.btn_view_all_files.setVisible(False)

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
        self.card_rate.set_value("0 f/s")
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
        rate_str = f"{(scanned / elapsed):.1f} f/s" if elapsed > 0.5 and scanned > 0 else "—"
        self.card_rate.set_value(rate_str)
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
        scanned = summary.get("files_scanned", 0)
        dur = summary.get('duration_seconds', 0)
        self.card_scanned.set_value(str(scanned))
        self.card_flagged.set_value(str(summary.get("files_with_pii", 0)))
        self.card_findings.set_value(str(summary.get("total_findings", 0)))
        self.card_time.set_value(f"{dur:.1f}s")
        self.card_rate.set_value(f"{(scanned / dur):.1f} f/s" if dur > 0 else "—")
        highest_tier = summary.get("highest_classification", "")
        if highest_tier:
            self.lbl_current_file.setText(f"Scan finished: {summary.get('status', 'done').upper()}  |  Highest Sensitivity: {highest_tier}")
        else:
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
