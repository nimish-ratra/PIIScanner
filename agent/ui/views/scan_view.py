"""
Scan View for CLAISSIFY
Provides responsive directory selection, dynamic PII entity chips,
worker concurrency slider, execution controls, KPI telemetry, and live activity logs.
Encased in a root QScrollArea to prevent any layout squishing or text clipping.
"""

import getpass
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QProgressBar, QFileDialog,
    QCheckBox, QScrollArea, QGridLayout, QFrame, QMessageBox,
    QButtonGroup
)
from PySide6.QtCore import Qt, Signal, QThread

from backend.config import config_manager
from backend.presidio_detector import PresidioDetector
from backend.drive_scanner import get_fixed_drives
from backend.database import db_manager
from ui.components.card import Card
from ui.components.metric_column import MetricColumn
from ui.components.status_badge import StatusBadge
from ui.icons import icon as get_icon, radio_pixmap, faded_pixmap
from ui.components.log_viewer import LogViewer
from ui.components.pii_selector_dialog import (
    PiiSelectorDialog, FileViewerDialog, ENTITY_CATEGORIES
)
from ui.workers.scan_worker import ScanWorker
from ui.views.watermark_review_dialog import WatermarkReviewDialog


class FolderPreviewWorker(QThread):
    """Asynchronously counts and discovers supported files in target directory without GUI hitching."""
    preview_ready = Signal(str, list, int)

    def __init__(self, folder: str, supported_extensions: list, parent=None):
        super().__init__(parent)
        self.folder = folder
        self.supported_extensions = set(e.lower() for e in supported_extensions)
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    def run(self):
        detected = []
        try:
            for dirpath, _, filenames in os.walk(self.folder):
                if self._is_cancelled:
                    return
                for fn in filenames:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext in self.supported_extensions:
                        rel = os.path.relpath(os.path.join(dirpath, fn), self.folder)
                        detected.append(rel)
                        if len(detected) >= 8000:
                            break
        except Exception:
            pass
        if not self._is_cancelled:
            self.preview_ready.emit(self.folder, detected, len(detected))


class ScanView(QWidget):
    """Main scanning interface."""

    # Emitted when a scan is finished and findings are ready
    scan_completed_signal = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.worker: Optional[ScanWorker] = None
        self._preview_worker: Optional[FolderPreviewWorker] = None
        self.all_supported_entities: List[str] = []
        self.selected_entities: List[str] = []
        self._detected_file_list: List[str] = []
        self.entity_checkboxes = {}  # Backwards compatibility
        self._full_system_scan_confirmed: bool = False
        # Total findings is still tracked (used in the "finished" summary and
        # in per-finding increments) even though the redesigned telemetry row
        # no longer has a visible slot for it - "Current File" took its place.
        self._total_findings: int = 0
        self._init_ui()
        self._load_entities()
        self._update_folder_preview()

    def _init_ui(self) -> None:
        # Outer layout containing root scroll area
        root_vbox = QVBoxLayout(self)
        root_vbox.setContentsMargins(0, 0, 0, 0)
        root_vbox.setSpacing(0)

        # Root ScrollArea ensures no content is squished on small screens or DPI scaling
        self.scroll_area = scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.viewport().setAttribute(Qt.WA_OpaquePaintEvent, False)

        container = QWidget()
        main_layout = QVBoxLayout(container)
        main_layout.setContentsMargins(24, 16, 24, 20)
        main_layout.setSpacing(14)

        # 1. Greeting Header
        header_row = QHBoxLayout()
        header_row.setSpacing(12)

        header_vbox = QVBoxLayout()
        header_vbox.setSpacing(2)

        hour = datetime.now().hour
        greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"
        display_name = getpass.getuser().replace(".", " ").replace("_", " ").title().split()[0]
        title_label = QLabel(f"{greeting}, {display_name} \U0001F44B", container)
        title_label.setStyleSheet("font-size: 22px; font-weight: 800; letter-spacing: -0.3px;")

        subtitle_label = QLabel(
            "Scan your local directories for sensitive data. All processing happens locally on your machine.",
            container
        )
        subtitle_label.setWordWrap(True)
        subtitle_label.setStyleSheet("font-size: 13px; color: #94a3b8;")

        header_vbox.addWidget(title_label)
        header_vbox.addWidget(subtitle_label)
        header_row.addLayout(header_vbox)
        header_row.addStretch()

        self.lbl_service_badge = StatusBadge(parent=container)
        self._update_service_badge(False)
        header_row.addWidget(self.lbl_service_badge, 0, Qt.AlignTop)

        main_layout.addLayout(header_row)

        # 2. Target Directory Card
        btn_change_target = QPushButton("Scan a different target", container)
        btn_change_target.setIcon(get_icon("chevron-right", "#1677FF", 14))
        btn_change_target.setLayoutDirection(Qt.RightToLeft)
        btn_change_target.setCursor(Qt.PointingHandCursor)
        btn_change_target.setFlat(True)
        btn_change_target.setStyleSheet(
            "QPushButton { border: none; background: transparent; color: #1677FF; "
            "font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { color: #1769E0; text-decoration: underline; }"
        )
        btn_change_target.clicked.connect(self._on_browse_folder)

        dir_group = Card(
            "Scan Scope & Target",
            "Choose a target folder to audit, or scan every fixed drive on this machine.",
            container,
            header_widget=btn_change_target,
            step_number=1,
        )
        dir_layout = dir_group.body_layout

        # Mode Selection: Single Directory vs Full System Scan - large
        # clickable "radio card" tiles rather than plain QRadioButtons, so
        # each option carries its own icon and one-line explanation.
        scope_row = QHBoxLayout()
        scope_row.setSpacing(12)
        self.radio_dir_scan = self._build_scope_tile(
            dir_group, "folder", "Target Directory", "Scan a specific folder"
        )
        self.radio_dir_scan.setChecked(True)
        self.radio_full_system = self._build_scope_tile(
            dir_group, "monitor", "Full System Scan", "Scan all local fixed drives"
        )
        self.btn_group_mode = QButtonGroup(dir_group)
        self.btn_group_mode.addButton(self.radio_dir_scan)
        self.btn_group_mode.addButton(self.radio_full_system)
        self.radio_dir_scan.toggled.connect(self._on_scan_mode_changed)

        scope_row.addWidget(self.radio_dir_scan, 1)
        scope_row.addWidget(self.radio_full_system, 1)
        dir_layout.addLayout(scope_row)

        input_row = QHBoxLayout()
        input_row.setSpacing(10)

        self.edit_folder = QLineEdit(dir_group)
        self.edit_folder.setFixedHeight(38)
        self.edit_folder.setPlaceholderText("Select or drag & drop folder to audit recursively...")
        self.edit_folder.addAction(get_icon("folder", "#94A3B8", 16), QLineEdit.LeadingPosition)
        self.edit_folder.setText(config_manager.get("last_scanned_folder", ""))
        self.edit_folder.textChanged.connect(self._update_folder_preview)

        self.btn_browse = QPushButton("Browse...", dir_group)
        self.btn_browse.setIcon(get_icon("folder", "#64748B", 18))
        self.btn_browse.setFixedHeight(38)
        self.btn_browse.setFixedWidth(110)
        self.btn_browse.clicked.connect(self._on_browse_folder)

        input_row.addWidget(self.edit_folder, 1)
        input_row.addWidget(self.btn_browse)
        dir_layout.addLayout(input_row)

        # Real-time folder preview status box: a headline row (icon + bold
        # summary + "View Details" link) plus a lighter detail line below it
        # (the actual filenames) - background/border recolor per state
        # (info/discovering/success/warning) via _set_preview_state().
        self.preview_box = QWidget(dir_group)
        self.preview_box.setObjectName("scanPreviewBox")
        preview_box_vbox = QVBoxLayout(self.preview_box)
        preview_box_vbox.setContentsMargins(12, 10, 12, 10)
        preview_box_vbox.setSpacing(2)

        preview_top_row = QHBoxLayout()
        preview_top_row.setSpacing(8)
        self.lbl_preview_icon = QLabel(self.preview_box)
        self.lbl_preview_icon.setFixedSize(16, 16)
        preview_top_row.addWidget(self.lbl_preview_icon)
        self.lbl_folder_preview = QLabel(self.preview_box)
        self.lbl_folder_preview.setWordWrap(True)
        preview_top_row.addWidget(self.lbl_folder_preview, 1)

        self.btn_view_all_files = QPushButton("View Details", self.preview_box)
        self.btn_view_all_files.setIcon(get_icon("chevron-right", "#15966B", 12))
        self.btn_view_all_files.setLayoutDirection(Qt.RightToLeft)
        self.btn_view_all_files.setFlat(True)
        self.btn_view_all_files.setCursor(Qt.PointingHandCursor)
        self.btn_view_all_files.setStyleSheet(
            "QPushButton { border: none; background: transparent; color: #15966B; "
            "font-size: 11px; font-weight: 700; }"
            "QPushButton:hover { text-decoration: underline; }"
        )
        self.btn_view_all_files.clicked.connect(self._on_view_all_files)
        self.btn_view_all_files.setVisible(False)
        preview_top_row.addWidget(self.btn_view_all_files)
        preview_box_vbox.addLayout(preview_top_row)

        self.lbl_preview_detail = QLabel(self.preview_box)
        self.lbl_preview_detail.setWordWrap(True)
        self.lbl_preview_detail.setContentsMargins(24, 0, 0, 0)
        self.lbl_preview_detail.setVisible(False)
        preview_box_vbox.addWidget(self.lbl_preview_detail)

        dir_layout.addWidget(self.preview_box)
        self.setAcceptDrops(True)

        # 3. Two-Column Grid: left column stacks Scan Scope -> PII Detection
        # Types -> scan controls -> progress; right column stacks Engine &
        # Performance -> Air-Gapped Environment. Both columns run to their
        # own natural height independently, rather than pairing single cards
        # against each other in one row (which left a gap under the shorter
        # side whenever the two cards' heights didn't happen to match).
        config_layout = QHBoxLayout()
        config_layout.setSpacing(16)

        left_col = QVBoxLayout()
        left_col.setSpacing(16)
        left_col.addWidget(dir_group)

        # 3a. Left Column: Dynamic PII Detection Types Configuration Group (Lag-Free Modal Approach)
        entity_header_widget = QWidget()
        entity_header_row = QHBoxLayout(entity_header_widget)
        entity_header_row.setContentsMargins(0, 0, 0, 0)
        entity_header_row.setSpacing(8)

        self.lbl_selected_count = QLabel("All 36 types active")
        self.lbl_selected_count.setStyleSheet(
            "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
            "border-radius: 12px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
        )
        btn_manage_types = QPushButton("Manage Types")
        btn_manage_types.setIcon(get_icon("chevron-right", "#ffffff", 12))
        btn_manage_types.setLayoutDirection(Qt.RightToLeft)
        btn_manage_types.setFixedHeight(28)
        btn_manage_types.setCursor(Qt.PointingHandCursor)
        btn_manage_types.setStyleSheet(
            "background: #1677FF; color: #ffffff; border: none; "
            "border-radius: 14px; padding: 4px 14px; font-size: 11px; font-weight: 700;"
        )
        btn_manage_types.clicked.connect(self._on_edit_entities)
        entity_header_row.addWidget(self.lbl_selected_count)
        entity_header_row.addWidget(btn_manage_types)

        entity_group = Card(
            "PII Detection Types",
            "Choose which sensitive data types this scan should look for.",
            container,
            header_widget=entity_header_widget,
            icon_name="file-text",
        )
        entity_vbox = entity_group.body_layout

        # Category tiles: one checkable box per ENTITY_CATEGORIES group,
        # toggling the whole category's entities on/off at once.
        self._category_short_info = {
            "India PII": ("India IDs", "Aadhaar, PAN, etc."),
            "Financial & Banking": ("Financial", "Cards, Accounts"),
            "Personal & Contact": ("Personal", "Email, Phone, Address"),
            "Developer Secrets": ("Secrets", "API keys, Tokens"),
            "Government & IDs": ("Gov & IDs", "Passports, Licenses"),
        }
        self.category_tile_checkboxes: dict = {}
        tiles_row = QHBoxLayout()
        tiles_row.setSpacing(10)
        for cat_name, (short_label, short_desc) in self._category_short_info.items():
            tile = QFrame(entity_group)
            tile.setObjectName("categoryTile")
            # Fixed, modest width so 5 tiles in a row never demand more
            # horizontal space than the (now narrower, two-column) card has -
            # an unconstrained tile sized purely to its unwrapped text was
            # what forced the whole page wider than its viewport.
            tile.setFixedWidth(128)
            # Scoped to #categoryTile, not a bare "QFrame" type selector -
            # QLabel is itself a QFrame subclass, so a generic type selector
            # here would cascade to lbl_desc below too, drawing a second
            # white bordered box tightly around just its own text.
            tile.setStyleSheet(
                "QFrame#categoryTile { background-color: #ffffff; border: 1px solid #d4d4d8; border-radius: 8px; }"
            )
            tile_vbox = QVBoxLayout(tile)
            tile_vbox.setContentsMargins(10, 8, 10, 8)
            tile_vbox.setSpacing(2)

            cb = QCheckBox(short_label, tile)
            cb.setIcon(get_icon(ENTITY_CATEGORIES.get(cat_name, {}).get("icon", "circle"), "#52525b", 14))
            cb.setStyleSheet("font-weight: 700; font-size: 12px;")
            cb.toggled.connect(lambda checked, c=cat_name: self._on_category_tile_toggled(c, checked))
            tile_vbox.addWidget(cb)

            lbl_desc = QLabel(short_desc, tile)
            lbl_desc.setWordWrap(True)
            lbl_desc.setStyleSheet("color: #71717a; font-size: 10px; margin-left: 22px; border: none; background: transparent;")
            tile_vbox.addWidget(lbl_desc)

            self.category_tile_checkboxes[cat_name] = cb
            tiles_row.addWidget(tile)

        entity_vbox.addLayout(tiles_row)

        # Info bar
        note_bar = QWidget(entity_group)
        note_bar.setStyleSheet(
            "background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px;"
        )
        note_row = QHBoxLayout(note_bar)
        note_row.setContentsMargins(10, 6, 10, 6)
        note_row.setSpacing(8)
        lbl_note_icon = QLabel(note_bar)
        lbl_note_icon.setFixedSize(14, 14)
        lbl_note_icon.setPixmap(get_icon("shield-check", "#52525b", 14).pixmap(14, 14))
        note_row.addWidget(lbl_note_icon)
        note_lbl = QLabel("Zero cloud communication. All detection runs locally on this machine.", note_bar)
        note_lbl.setWordWrap(True)
        note_lbl.setStyleSheet("color: #52525b; font-size: 11px; background: transparent; border: none;")
        note_row.addWidget(note_lbl, 1)
        entity_vbox.addWidget(note_bar)

        left_col.addWidget(entity_group)

        # 3b. Right Column: Scan Engine & Concurrency Configuration Group
        engine_group = Card(
            "Engine & Concurrency Settings",
            "Tune scan speed and detection sensitivity.",
            container
        )
        engine_vbox = engine_group.body_layout

        # Concurrent Workers Section
        worker_header = QHBoxLayout()
        worker_lbl = QLabel("Concurrent Worker Threads:", engine_group)
        worker_lbl.setWordWrap(True)
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
        max_limit = max(8, min((os.cpu_count() or 4) * 2, 32))
        self.slider_workers.setRange(1, max_limit)
        default_workers = config_manager.max_workers
        self.slider_workers.setValue(default_workers)
        self.slider_workers.valueChanged.connect(self._on_workers_changed)
        engine_vbox.addWidget(self.slider_workers)

        worker_guide = QLabel(f"1 (Sequential)   •   2 (Balanced)   •   4 (Fast)   •   {max_limit} (Turbo)", engine_group)
        worker_guide.setWordWrap(True)
        worker_guide.setStyleSheet("color: #64748b; font-size: 10px; font-weight: 600;")
        engine_vbox.addWidget(worker_guide)

        self._on_workers_changed(default_workers)

        # Divider
        divider = QFrame(engine_group)
        divider.setFrameShape(QFrame.HLine)
        divider.setFrameShadow(QFrame.Sunken)
        divider.setStyleSheet("color: #e4e4e7; margin-top: 4px; margin-bottom: 4px;")
        engine_vbox.addWidget(divider)

        # Confidence Threshold Section
        thresh_header = QHBoxLayout()
        thresh_lbl = QLabel("Minimum Confidence Threshold:", engine_group)
        thresh_lbl.setWordWrap(True)
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

        # 3c. "Air-Gapped Environment" trust card, stacked under Engine settings
        trust_card = QFrame(container)
        trust_card.setObjectName("card")
        trust_card.setStyleSheet(
            "QFrame#card { background-color: #ecfdf5; border: 1px solid #a7f3d0; }"
        )

        # Large, very low-opacity shield watermark in the card's bottom-right
        # corner - purely decorative, must never compete with the real
        # content, so it's parented directly to the card (not placed in
        # trust_vbox) and lowered behind everything in z-order; repositioned
        # on every resize since the card's size is not fixed.
        lbl_trust_watermark = QLabel(trust_card)
        lbl_trust_watermark.setAttribute(Qt.WA_TransparentForMouseEvents)
        watermark_size = 96
        lbl_trust_watermark.setPixmap(faded_pixmap("shield", "#059669", watermark_size, 0.10))
        lbl_trust_watermark.setFixedSize(watermark_size, watermark_size)
        lbl_trust_watermark.lower()

        def _position_trust_watermark(event, lbl=lbl_trust_watermark, card=trust_card):
            lbl.move(card.width() - lbl.width() - 4, card.height() - lbl.height() - 4)
            QFrame.resizeEvent(card, event)

        trust_card.resizeEvent = _position_trust_watermark

        trust_vbox = QVBoxLayout(trust_card)
        trust_vbox.setContentsMargins(16, 14, 16, 14)
        trust_vbox.setSpacing(8)

        trust_header = QHBoxLayout()
        trust_header.setSpacing(8)
        lbl_trust_icon = QLabel(trust_card)
        lbl_trust_icon.setPixmap(get_icon("shield", "#059669", 18).pixmap(18, 18))
        lbl_trust_title = QLabel("Air-Gapped Environment", trust_card)
        lbl_trust_title.setStyleSheet("font-size: 13px; font-weight: 700; color: #065f46; background: transparent;")
        trust_header.addWidget(lbl_trust_icon)
        trust_header.addWidget(lbl_trust_title)
        trust_header.addStretch()
        trust_vbox.addLayout(trust_header)

        lbl_trust_sub = QLabel("Zero telemetry • Local engines • Your data stays here", trust_card)
        lbl_trust_sub.setWordWrap(True)
        lbl_trust_sub.setStyleSheet("font-size: 11px; color: #64748B; background: transparent;")
        trust_vbox.addWidget(lbl_trust_sub)

        for point in ("No data leaves your machine", "No external API calls", "No file uploads", "Enterprise-grade privacy"):
            row = QHBoxLayout()
            row.setSpacing(6)
            lbl_check = QLabel(trust_card)
            lbl_check.setFixedSize(14, 14)
            lbl_check.setPixmap(get_icon("check-circle", "#059669", 14).pixmap(14, 14))
            lbl_text = QLabel(point, trust_card)
            lbl_text.setStyleSheet("font-size: 11px; color: #065f46; font-weight: 600; background: transparent;")
            row.addWidget(lbl_check)
            row.addWidget(lbl_text)
            row.addStretch()
            trust_vbox.addLayout(row)

        right_col = QVBoxLayout()
        right_col.setSpacing(16)
        right_col.addWidget(engine_group)
        # Stretch factor 1 (instead of a trailing addStretch()) so any
        # leftover height config_layout allocates to right_col - to match
        # left_col's height - grows trust_card's own green box down to meet
        # entity_group's bottom edge, rather than leaving it short with a
        # blank gap of unstyled background underneath.
        right_col.addWidget(trust_card, 1)

        # 4. Scan Control & Progress Card - controls, progress bar, and live
        # telemetry merged into one card (previously a separate controls bar
        # above a distinct "Live Scan Progress & Telemetry" card).
        btn_view_logs = QPushButton("View Scan Logs", container)
        btn_view_logs.setIcon(get_icon("chevron-right", "#1677FF", 12))
        btn_view_logs.setLayoutDirection(Qt.RightToLeft)
        btn_view_logs.setFlat(True)
        btn_view_logs.setCursor(Qt.PointingHandCursor)
        btn_view_logs.setStyleSheet(
            "QPushButton { border: none; background: transparent; color: #1677FF; "
            "font-size: 12px; font-weight: 700; }"
            "QPushButton:hover { color: #1769E0; text-decoration: underline; }"
        )
        btn_view_logs.clicked.connect(self._on_view_scan_logs)

        progress_header_widget = QWidget()
        progress_header_row = QHBoxLayout(progress_header_widget)
        progress_header_row.setContentsMargins(0, 0, 0, 0)
        progress_header_row.setSpacing(10)
        progress_header_row.addWidget(btn_view_logs)
        self.lbl_scan_status = StatusBadge("circle", "#64748B", "Ready", bg_color="#F1F5F9")
        progress_header_row.addWidget(self.lbl_scan_status)

        progress_box = Card(
            "Scan Control & Progress",
            "Start the scan to inspect files for sensitive information.",
            container,
            header_widget=progress_header_widget,
            step_number=4,
        )
        progress_vbox = progress_box.body_layout

        # Controls (left) + Progress bar (right), side by side
        control_progress_row = QHBoxLayout()
        control_progress_row.setSpacing(20)

        controls_bar = QHBoxLayout()
        controls_bar.setSpacing(10)

        self.btn_start = QPushButton("Start Audit Scan", progress_box)
        self.btn_start.setIcon(get_icon("play", "#ffffff", 16))
        self.btn_start.setObjectName("primaryButton")
        self.btn_start.setFixedHeight(42)
        self.btn_start.setMinimumWidth(160)
        self.btn_start.clicked.connect(self._on_start_scan)

        self.btn_pause = QPushButton("Pause", progress_box)
        self.btn_pause.setIcon(get_icon("pause", "#ffffff", 16))
        self.btn_pause.setObjectName("warningButton")
        self.btn_pause.setFixedHeight(42)
        self.btn_pause.setMinimumWidth(100)
        self.btn_pause.setEnabled(False)
        self.btn_pause.clicked.connect(self._on_toggle_pause)

        self.btn_cancel = QPushButton("Cancel", progress_box)
        self.btn_cancel.setIcon(get_icon("square", "#ffffff", 16))
        self.btn_cancel.setObjectName("dangerButton")
        self.btn_cancel.setFixedHeight(42)
        self.btn_cancel.setMinimumWidth(100)
        self.btn_cancel.setEnabled(False)
        self.btn_cancel.clicked.connect(self._on_cancel_scan)

        controls_bar.addWidget(self.btn_start)
        controls_bar.addWidget(self.btn_pause)
        controls_bar.addWidget(self.btn_cancel)
        control_progress_row.addLayout(controls_bar)

        progress_col = QVBoxLayout()
        progress_col.setSpacing(6)
        progress_label_row = QHBoxLayout()
        lbl_progress_caption = QLabel("Progress", progress_box)
        lbl_progress_caption.setStyleSheet("color: #64748B; font-size: 11px; font-weight: 600;")
        progress_label_row.addWidget(lbl_progress_caption)
        progress_label_row.addStretch()
        self.lbl_progress_pct = QLabel("0%", progress_box)
        self.lbl_progress_pct.setStyleSheet("color: #152238; font-size: 12px; font-weight: 700;")
        progress_label_row.addWidget(self.lbl_progress_pct)
        progress_col.addLayout(progress_label_row)

        self.progress_bar = QProgressBar(progress_box)
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(10)
        progress_col.addWidget(self.progress_bar)

        control_progress_row.addLayout(progress_col, 1)
        progress_vbox.addLayout(control_progress_row)

        # Live telemetry row - plain label/value columns, not boxed KPI cards
        metrics_layout = QHBoxLayout()
        metrics_layout.setSpacing(28)

        self.card_scanned = MetricColumn("Files Scanned", "0", progress_box)
        self.card_flagged = MetricColumn("PII Findings", "0", progress_box)
        self.lbl_current_file = MetricColumn("Current File", "—", progress_box)
        self.card_time = MetricColumn("Elapsed Time", "00:00:00", progress_box)
        self.card_rate = MetricColumn("Scan Rate", "0 files/sec", progress_box)

        metrics_layout.addWidget(self.card_scanned)
        metrics_layout.addWidget(self.card_flagged)
        metrics_layout.addWidget(self.lbl_current_file, 1)
        metrics_layout.addWidget(self.card_time)
        metrics_layout.addWidget(self.card_rate)

        progress_vbox.addLayout(metrics_layout)

        # progress_box is a full-width row of its own, below the two-column
        # grid - not a third item stacked inside left_col. Keeping it inside
        # left_col was forcing config_layout to stretch right_col to match
        # left_col's much taller combined height (dir_group + entity_group +
        # progress_box), and that leftover height landed on right_col's
        # trailing addStretch() as dead space beside progress_box, rather
        # than on trust_card itself.
        config_layout.addLayout(left_col, 7)
        config_layout.addLayout(right_col, 3)
        main_layout.addLayout(config_layout)
        main_layout.addWidget(progress_box)

        # 6. Live Activity Log Viewer
        self.log_viewer = LogViewer(container)
        main_layout.addWidget(self.log_viewer)

        # Finalize root scroll area
        scroll.setWidget(container)
        root_vbox.addWidget(scroll)

    def _update_service_badge(self, is_active: bool) -> None:
        """Reflect the enforcement microservice's live/offline state (pushed by MainWindow).
        Kept short - a pill badge, not a sentence; the top bar's own status
        chip already shows the fuller "Local Engine Active/Inactive" detail."""
        if is_active:
            self.lbl_service_badge.set_state(
                "shield-check", "#15966B", "Service Online", bg_color="#EAF8F1", border_color="#BFE8D9"
            )
        else:
            self.lbl_service_badge.set_state(
                "shield", "#94A3B8", "Service Offline", bg_color="#F1F5F9", border_color="#DCE3EC"
            )

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
            self.lbl_selected_count.setText(f"All {total} types active")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); "
                "border-radius: 12px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
            )
        elif selected == 0:
            self.lbl_selected_count.setText("0 active (Warning: None)")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); "
                "border-radius: 12px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
            )
        else:
            self.lbl_selected_count.setText(f"{selected} of {total} types active")
            self.lbl_selected_count.setStyleSheet(
                "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
                "border-radius: 12px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
            )

    def _update_category_summary(self) -> None:
        """Refresh each category tile's checkbox label/checked-state from self.selected_entities."""
        active_set = set(self.selected_entities)
        for cat_name, cb in self.category_tile_checkboxes.items():
            cat_data = ENTITY_CATEGORIES.get(cat_name, {"entities": []})
            cat_ents = [e for e, _ in cat_data["entities"] if e in self.all_supported_entities]
            short_label, _ = self._category_short_info[cat_name]
            if not cat_ents:
                continue
            act_count = sum(1 for e in cat_ents if e in active_set)

            cb.blockSignals(True)
            cb.setText(f"{short_label} ({act_count})" if act_count == len(cat_ents) else f"{short_label} ({act_count}/{len(cat_ents)})")
            cb.setCheckState(
                Qt.Checked if act_count == len(cat_ents)
                else Qt.Unchecked if act_count == 0
                else Qt.PartiallyChecked
            )
            cb.setTristate(act_count not in (0, len(cat_ents)))
            cb.blockSignals(False)

    def _build_scope_tile(self, parent: QWidget, icon_name: str, title: str, subtitle: str) -> QPushButton:
        """One large clickable 'radio card' for choosing the scan scope - a
        checkable QPushButton with its own child layout (icon/title/subtitle
        drawn by child labels), the same architecture as the sidebar nav
        buttons. setMinimumHeight() is set explicitly from the child
        layout's own sizeHint() once all content is in place, because
        QPushButton computes its native sizeHint from its own (unused) text/
        icon rather than the installed child layout - left unset, the tile
        gets squeezed down to a sliver by whatever row is sizing it (see
        CONTEXT.md Section 12.16 for the identical bug found in the sidebar)."""
        tile = QPushButton(parent)
        tile.setObjectName("scopeTile")
        tile.setCheckable(True)
        tile.setCursor(Qt.PointingHandCursor)

        row = QHBoxLayout(tile)
        row.setContentsMargins(14, 12, 14, 12)
        row.setSpacing(10)

        lbl_radio = QLabel(tile)
        lbl_radio.setFixedSize(16, 16)
        lbl_radio.setAttribute(Qt.WA_TransparentForMouseEvents)
        row.addWidget(lbl_radio)

        lbl_icon_box = QLabel(tile)
        lbl_icon_box.setFixedSize(32, 32)
        lbl_icon_box.setAlignment(Qt.AlignCenter)
        lbl_icon_box.setAttribute(Qt.WA_TransparentForMouseEvents)
        row.addWidget(lbl_icon_box)

        text_col = QVBoxLayout()
        text_col.setSpacing(1)
        lbl_title = QLabel(title, tile)
        lbl_title.setAttribute(Qt.WA_TransparentForMouseEvents)
        text_col.addWidget(lbl_title)
        lbl_subtitle = QLabel(subtitle, tile)
        lbl_subtitle.setAttribute(Qt.WA_TransparentForMouseEvents)
        text_col.addWidget(lbl_subtitle)
        row.addLayout(text_col, 1)

        tile.toggled.connect(
            lambda checked, li=lbl_radio, lib=lbl_icon_box, lt=lbl_title, ls=lbl_subtitle, ic=icon_name, t=tile:
            self._on_scope_tile_toggled(t, checked, li, lib, lt, ls, ic)
        )
        self._on_scope_tile_toggled(tile, False, lbl_radio, lbl_icon_box, lbl_title, lbl_subtitle, icon_name)
        tile.setMinimumHeight(row.sizeHint().height())
        return tile

    def _on_scope_tile_toggled(
        self, tile: QPushButton, checked: bool,
        lbl_radio: QLabel, lbl_icon_box: QLabel, lbl_title: QLabel, lbl_subtitle: QLabel, icon_name: str
    ) -> None:
        lbl_radio.setPixmap(radio_pixmap(checked, "#1677FF" if checked else "#CBD5E1", 16))
        icon_color = "#1677FF" if checked else "#64748B"
        lbl_icon_box.setPixmap(get_icon(icon_name, icon_color, 18).pixmap(18, 18))
        lbl_icon_box.setStyleSheet(
            f"background-color: {'#EEF5FF' if checked else '#F1F5F9'}; border-radius: 8px;"
        )
        lbl_title.setStyleSheet(
            "font-weight: 700; font-size: 13px; color: #152238; background: transparent;"
        )
        lbl_subtitle.setStyleSheet(
            "font-size: 11px; color: #64748B; background: transparent;"
        )
        if checked:
            tile.setStyleSheet(
                "QPushButton#scopeTile { background-color: #EEF5FF; border: 1.5px solid #1677FF; border-radius: 10px; }"
            )
        else:
            tile.setStyleSheet(
                "QPushButton#scopeTile { background-color: #ffffff; border: 1px solid #E4E4E7; border-radius: 10px; }"
                "QPushButton#scopeTile:hover { border-color: #94A3B8; }"
            )

    def _on_category_tile_toggled(self, cat_name: str, checked: bool) -> None:
        """A category tile's checkbox toggles every entity in that category on/off at once."""
        cat_data = ENTITY_CATEGORIES.get(cat_name, {"entities": []})
        cat_ents = [e for e, _ in cat_data["entities"] if e in self.all_supported_entities]
        if checked:
            for e in cat_ents:
                if e not in self.selected_entities:
                    self.selected_entities.append(e)
        else:
            self.selected_entities = [e for e in self.selected_entities if e not in cat_ents]
        config_manager.selected_entities = self.selected_entities
        self._update_selected_count_label()
        self._update_category_summary()

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

    # Preview box background/border per state - keeps the four transitions
    # below focused on their own text content instead of repeating colors.
    _PREVIEW_STATE_STYLES = {
        "neutral": ("#F8FAFC", "#E2E8F0"),
        "info": ("#EFF6FF", "#BFDBFE"),
        "success": ("#ECFDF5", "#A7F3D0"),
        "warning": ("#FFFBEB", "#FDE68A"),
    }

    def _set_preview_state(self, state: str) -> None:
        # Scoped to the #scanPreviewBox id, not a bare "QWidget" type
        # selector - Qt Style Sheets cascade by type down the widget tree,
        # so a generic "QWidget { border: ... }" rule set here would also
        # match every child QLabel inside the box (QLabel IS-A QWidget),
        # drawing a second border tightly around each label's own text
        # since the child labels' own stylesheets only override
        # `background`, not `border`.
        bg, border = self._PREVIEW_STATE_STYLES[state]
        self.preview_box.setStyleSheet(
            f"QWidget#scanPreviewBox {{ background-color: {bg}; border: 1px solid {border}; border-radius: 8px; }}"
        )

    def _update_folder_preview(self) -> None:
        folder = self.edit_folder.text().strip()
        if not folder or not os.path.isdir(folder):
            if self._preview_worker and self._preview_worker.isRunning():
                self._preview_worker.cancel()
            self._set_preview_state("neutral")
            self.lbl_preview_icon.setPixmap(get_icon("lightbulb", "#64748b", 16).pixmap(16, 16))
            self.lbl_folder_preview.setText(
                "Click 'Browse...' or paste a target folder to scan all documents recursively."
            )
            self.lbl_folder_preview.setStyleSheet("color: #64748b; font-size: 12px; font-weight: 600; background: transparent;")
            self.lbl_folder_preview.setToolTip("")
            self.lbl_preview_detail.setVisible(False)
            self.btn_view_all_files.setVisible(False)
            self._detected_file_list = []
            return

        self.edit_folder.setToolTip(f"Full Target Folder Path: {folder}")
        self._set_preview_state("info")
        self.lbl_preview_icon.setPixmap(get_icon("folder", "#38bdf8", 16).pixmap(16, 16))
        self.lbl_folder_preview.setText(f"Discovering supported documents in {os.path.basename(folder)}...")
        self.lbl_folder_preview.setStyleSheet("color: #1d4ed8; font-size: 12px; font-weight: 600; background: transparent;")
        self.lbl_preview_detail.setVisible(False)
        self.btn_view_all_files.setVisible(False)

        if self._preview_worker and self._preview_worker.isRunning():
            self._preview_worker.cancel()

        self._preview_worker = FolderPreviewWorker(folder, config_manager.supported_extensions, self)
        self._preview_worker.preview_ready.connect(self._on_preview_ready)
        self._preview_worker.start()

    def _on_preview_ready(self, folder: str, detected: List[str], total_count: int) -> None:
        if self.edit_folder.text().strip() != folder:
            return  # Path changed while worker was running

        self._detected_file_list = detected
        if total_count > 0:
            self._set_preview_state("success")
            self.lbl_preview_icon.setPixmap(get_icon("check-circle", "#15966B", 16).pixmap(16, 16))
            self.lbl_folder_preview.setText(
                f"Detected {total_count} supported document(s) in selected folder"
            )
            self.lbl_folder_preview.setStyleSheet("color: #15966B; font-size: 12px; font-weight: 700; background: transparent;")

            shown = [os.path.basename(f) for f in detected[:5]]
            detail_text = ", ".join(shown)
            if total_count > 5:
                detail_text += f", ... (+{total_count - 5} more)"
            self.lbl_preview_detail.setText(detail_text)
            self.lbl_preview_detail.setStyleSheet("color: #15966B; font-size: 11px; background: transparent;")
            self.lbl_preview_detail.setVisible(True)

            self.btn_view_all_files.setVisible(True)

            tooltip_files = "\n".join(detected[:60])
            if total_count > 60:
                tooltip_files += f"\n... and {total_count - 60} more files (click 'View Details' to inspect full list)"
            self.lbl_folder_preview.setToolTip(f"Discovered Documents ({total_count} total):\n{tooltip_files}")
        else:
            self._set_preview_state("warning")
            self.lbl_preview_icon.setPixmap(get_icon("alert-triangle", "#D98A00", 16).pixmap(16, 16))
            self.lbl_folder_preview.setText(
                "No supported documents (.docx, .pdf, .txt, .csv, etc.) found in this folder."
            )
            self.lbl_folder_preview.setStyleSheet("color: #B45309; font-size: 12px; font-weight: 600; background: transparent;")
            self.lbl_folder_preview.setToolTip("")
            self.lbl_preview_detail.setVisible(False)
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

    def _on_scan_mode_changed(self) -> None:
        """Handle toggle between single folder scan and full system scan."""
        if self.radio_full_system.isChecked():
            # Per-session friction guard confirmation dialog (re-prompts once per app launch)
            if not self._full_system_scan_confirmed:
                res = QMessageBox.warning(
                    self,
                    "Confirm Full System Scan Scope",
                    "Launching a Full System Scan will inspect every fixed local drive on this computer.\n\n"
                    "Because this encompasses your entire filesystem, the scan may take a long time.\n\n"
                    "Default noise/system directories (Windows, Program Files, ProgramData, node_modules, .git) "
                    "will be automatically skipped to optimize speed.\n\n"
                    "Do you wish to proceed with Full System Scan mode?",
                    QMessageBox.Yes | QMessageBox.Cancel,
                    QMessageBox.Cancel
                )
                if res != QMessageBox.Yes:
                    self.radio_dir_scan.setChecked(True)
                    return
                self._full_system_scan_confirmed = True

            self.edit_folder.setEnabled(False)
            self.btn_browse.setEnabled(False)
            drives = get_fixed_drives()
            drive_names = [f"{d.mountpoint} ({d.fstype or 'Fixed'})" for d in drives]
            self._set_preview_state("info")
            self.lbl_preview_icon.setPixmap(get_icon("monitor", "#38bdf8", 16).pixmap(16, 16))
            self.lbl_folder_preview.setText(
                f"Full System Scope: {len(drives)} local fixed drive(s) detected"
            )
            self.lbl_folder_preview.setStyleSheet("color: #1d4ed8; font-size: 12px; font-weight: 700; background: transparent;")
            self.lbl_preview_detail.setText(
                f"{', '.join(drive_names)}. System folders (Windows, Program Files, ProgramData, node_modules, .git) excluded."
            )
            self.lbl_preview_detail.setStyleSheet("color: #1d4ed8; font-size: 11px; background: transparent;")
            self.lbl_preview_detail.setVisible(True)
            self.btn_view_all_files.setVisible(False)
        else:
            self.edit_folder.setEnabled(True)
            self.btn_browse.setEnabled(True)
            self._update_folder_preview()

    def _on_start_scan(self) -> None:
        standalone = os.environ.get("CLAISSIFY_STANDALONE", "0") == "1"
        if not standalone:
            from backend import license_client
            # Live check so immediate admin revokes block the scan immediately
            allowed, reason = license_client.refresh_policy(timeout_seconds=2.0)
            if not allowed:
                QMessageBox.critical(
                    self,
                    "Scanning Blocked",
                    f"Unable to start scan: {reason}.\nPlease verify your license status in Settings or contact your administrator.",
                )
                if hasattr(self, "window") and callable(self.window):
                    win = self.window()
                    if hasattr(win, "_handle_license_lost"):
                        win._handle_license_lost(reason)
                return

        is_full_system = self.radio_full_system.isChecked()
        if is_full_system:
            drives = get_fixed_drives()
            if not drives:
                QMessageBox.warning(self, "No Fixed Drives", "No fixed local drives detected on this system.")
                return
            target_folder = [d.mountpoint for d in drives]
            scan_source = "full_system_scan"
            exclusions = config_manager.get("system_scan_exclusions", [])
            display_target = ", ".join(d.mountpoint for d in drives)
        else:
            folder = self.edit_folder.text().strip()
            if not folder or not os.path.isdir(folder):
                QMessageBox.warning(self, "Invalid Directory", "Please select a valid existing directory to scan.")
                return
            target_folder = folder
            scan_source = "directory_scan"
            exclusions = []
            display_target = folder

        # Check if at least one entity is selected
        active_entities = self._get_active_entities()
        if active_entities is not None and len(active_entities) == 0:
            QMessageBox.warning(self, "No Entities Selected", "Please select at least one PII entity type to detect.")
            return

        # Reset UI
        self.progress_bar.setValue(0)
        self.lbl_progress_pct.setText("0%")
        self.card_scanned.set_value("0")
        self.card_flagged.set_value("0")
        self._total_findings = 0
        self.card_rate.set_value("0 files/sec")
        self.card_time.set_value("00:00:00")
        self.lbl_current_file.set_value("Initializing...")
        self.lbl_scan_status.set_state("activity", "#1677FF", "Scanning", bg_color="#EEF5FF")
        self.log_viewer.clear()

        # Update button and input states
        self.btn_start.setEnabled(False)
        self.btn_browse.setEnabled(False)
        self.edit_folder.setEnabled(False)
        self.radio_dir_scan.setEnabled(False)
        self.radio_full_system.setEnabled(False)
        self.slider_threshold.setEnabled(False)
        self.slider_workers.setEnabled(False)
        self.btn_pause.setEnabled(True)
        self.btn_pause.setText("Pause")
        self.btn_pause.setIcon(get_icon("pause", "#ffffff", 16))
        self.btn_cancel.setEnabled(True)

        # Launch Worker Thread
        threshold = self.slider_threshold.value() / 100.0
        workers = self.slider_workers.value()
        config_manager.max_workers = workers

        self.worker = ScanWorker(
            target_folder=target_folder,
            confidence_threshold=threshold,
            selected_entities=active_entities,
            supported_extensions=config_manager.supported_extensions,
            max_file_size_mb=config_manager.max_file_size_mb,
            max_workers=workers,
            ocr_enabled=config_manager.ocr_enabled,
            scan_source=scan_source,
            exclusion_patterns=exclusions,
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
            self.btn_pause.setText("Pause")
            self.btn_pause.setIcon(get_icon("pause", "#ffffff", 16))
            self.lbl_scan_status.set_state("activity", "#1677FF", "Scanning", bg_color="#EEF5FF")
        else:
            self.worker.pause()
            self.btn_pause.setText("Resume")
            self.btn_pause.setIcon(get_icon("play", "#ffffff", 16))
            self.lbl_scan_status.set_state("pause", "#D98A00", "Paused", bg_color="#FFF7E6")

    def _on_cancel_scan(self) -> None:
        if self.worker:
            self.worker.cancel()
            self.lbl_scan_status.set_state("x-circle", "#D92D20", "Cancelling", bg_color="#FFF0EF")
            self.btn_cancel.setEnabled(False)
            self.btn_pause.setEnabled(False)

    def _on_view_scan_logs(self) -> None:
        """Expand the log console if collapsed and scroll it into view."""
        self.log_viewer.expand()
        self.scroll_area.ensureWidgetVisible(self.log_viewer)

    @staticmethod
    def _format_elapsed(seconds: float) -> str:
        total = int(seconds)
        h, rem = divmod(total, 3600)
        m, s = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"

    def _on_worker_progress(self, scanned: int, total: int, current_file: str, elapsed: float) -> None:
        pct = int((scanned / total) * 100) if total > 0 else 0
        self.progress_bar.setValue(pct)
        self.lbl_progress_pct.setText(f"{pct}%")
        self.card_scanned.set_value(f"{scanned}/{total}")
        self.card_time.set_value(self._format_elapsed(elapsed))
        rate_str = f"{(scanned / elapsed):.1f} files/sec" if elapsed > 0.5 and scanned > 0 else "—"
        self.card_rate.set_value(rate_str)
        # Format filename to fit
        display_name = os.path.basename(current_file)
        self.lbl_current_file.set_value(display_name)
        self.lbl_current_file.label_value.setToolTip(current_file)

    def _on_worker_finding(self, finding: dict) -> None:
        self._total_findings += 1
        if self.worker and self.worker.scanner:
            self.card_flagged.set_value(str(self.worker.scanner.files_with_pii))

    def _on_worker_log(self, message: str, level: str) -> None:
        self.log_viewer.append_log(message, level)

    def _on_worker_finished(self, summary: dict) -> None:
        self.progress_bar.setValue(100)
        self.lbl_progress_pct.setText("100%")
        scanned = summary.get("files_scanned", 0)
        dur = summary.get('duration_seconds', 0)
        self.card_scanned.set_value(str(scanned))
        self.card_flagged.set_value(str(summary.get("files_with_pii", 0)))
        self._total_findings = summary.get("total_findings", 0)
        self.card_time.set_value(self._format_elapsed(dur))
        self.card_rate.set_value(f"{(scanned / dur):.1f} files/sec" if dur > 0 else "—")
        self.lbl_current_file.set_value("—")
        status_upper = summary.get('status', 'done').upper()
        highest_tier = summary.get("highest_classification", "")
        status_tooltip = f"Highest Sensitivity: {highest_tier}" if highest_tier else ""
        self.lbl_scan_status.set_state("check-circle", "#15966B", status_upper.title(), bg_color="#EAF8F1")
        if status_tooltip:
            self.lbl_scan_status.setToolTip(status_tooltip)

        # Restore button states
        self.btn_start.setEnabled(True)
        self.btn_browse.setEnabled(True)
        self.edit_folder.setEnabled(not self.radio_full_system.isChecked())
        self.radio_dir_scan.setEnabled(True)
        self.radio_full_system.setEnabled(True)
        self.slider_threshold.setEnabled(True)
        self.slider_workers.setEnabled(True)
        self.btn_pause.setEnabled(False)
        self.btn_pause.setText("Pause")
        self.btn_pause.setIcon(get_icon("pause", "#ffffff", 16))
        self.btn_cancel.setEnabled(False)

        # Notify parent / main window
        self.scan_completed_signal.emit(summary)

        # Section 3: Watermark Candidates Review Workflow
        if config_manager.get("watermark_enabled", True):
            scan_id = summary.get("scan_id")
            min_tier = config_manager.get("watermark_min_tier", "Confidential")
            candidates = db_manager.get_watermark_candidates(scan_id=scan_id, min_tier=min_tier)
            if candidates and os.environ.get("QT_QPA_PLATFORM") != "offscreen":
                dlg = WatermarkReviewDialog(candidates, self)
                dlg.exec()

    def _on_worker_error(self, err_msg: str) -> None:
        QMessageBox.critical(self, "Scan Error", f"An error occurred during the scan:\n{err_msg}")
        self.lbl_scan_status.set_state("x-circle", "#D92D20", "Error", bg_color="#FFF0EF")
        self.btn_start.setEnabled(True)
        self.btn_browse.setEnabled(True)
        self.edit_folder.setEnabled(True)
        self.slider_threshold.setEnabled(True)
        self.slider_workers.setEnabled(True)
        self.btn_pause.setEnabled(False)
        self.btn_cancel.setEnabled(False)
