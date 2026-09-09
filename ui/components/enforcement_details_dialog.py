"""
Enforcement Event Details Modal Dialog for PII Sentinel
Displays full, unclipped audit information for real-time save interception events,
including file location, source, Purview sensitivity tier, detected entity types,
action taken, and override audit rationale.
Strict privacy guarantee: Raw PII is never displayed; only safe redacted summaries.
"""

from typing import Dict, Any, Optional
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QWidget, QFrame, QScrollArea
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication

from backend.classifier import TIER_METADATA, SensitivityTier


def get_source_icon(source_str: str) -> str:
    s = str(source_str).lower()
    if "word" in s:
        return "📄 Word"
    elif "excel" in s:
        return "📊 Excel"
    elif "watch" in s or "file" in s:
        return "👁️ Watcher"
    return "🛡️ Service"


class EnforcementEventDetailsDialog(QDialog):
    """Modal dialog displaying audit details of an interception event."""

    def __init__(self, event: Dict[str, Any], parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.setWindowTitle("Interception Audit Inspector - PII Sentinel")
        self.resize(650, 480)
        self.setMinimumSize(550, 380)
        self.setModal(True)
        self.event = event
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(14)

        # Header Row: Title + Source + Tier Badge
        header = QHBoxLayout()
        vbox_hdr = QVBoxLayout()
        vbox_hdr.setSpacing(2)
        title = QLabel("Real-Time Interception Audit Record", self)
        title.setStyleSheet("font-size: 16px; font-weight: 800; color: #f8fafc;")
        ev_id = self.event.get("id", "N/A")
        ts = self.event.get("timestamp", "")
        subtitle = QLabel(f"Event #{ev_id}  •  {ts}", self)
        subtitle.setStyleSheet("font-size: 11px; color: #94a3b8;")
        vbox_hdr.addWidget(title)
        vbox_hdr.addWidget(subtitle)
        header.addLayout(vbox_hdr)
        header.addStretch()

        # App Source Badge
        src = self.event.get("app_source") or self.event.get("source", "Generic")
        lbl_src = QLabel(get_source_icon(src), self)
        lbl_src.setStyleSheet(
            "background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); "
            "border-radius: 10px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
        )
        header.addWidget(lbl_src)

        # Sensitivity Tier Badge
        tier = self.event.get("tier", SensitivityTier.GENERAL.value)
        meta = TIER_METADATA.get(tier, TIER_METADATA.get(SensitivityTier.GENERAL.value, {}))
        tier_color = meta.get("color", "#94a3b8")
        badge_text = f"{meta.get('badge_emoji', '⚪')} {tier}"
        lbl_tier = QLabel(badge_text, self)
        lbl_tier.setStyleSheet(
            f"background: rgba(255, 255, 255, 0.08); color: {tier_color}; border: 1px solid {tier_color}; "
            f"border-radius: 10px; padding: 4px 12px; font-weight: 700; font-size: 11px;"
        )
        header.addWidget(lbl_tier)
        layout.addLayout(header)

        # Scrollable container for details
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background: transparent; border: none;")

        container = QWidget()
        vbox_body = QVBoxLayout(container)
        vbox_body.setContentsMargins(0, 0, 0, 0)
        vbox_body.setSpacing(12)

        # 1. Action Taken & Override Status Card
        card_action = QFrame(container)
        card_action.setStyleSheet("background: #0d1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px;")
        vbox_act = QVBoxLayout(card_action)
        vbox_act.setSpacing(8)

        act_row = QHBoxLayout()
        lbl_act_hdr = QLabel("Enforcement Decision:", card_action)
        lbl_act_hdr.setStyleSheet("font-size: 11px; font-weight: 700; color: #94a3b8;")
        act_row.addWidget(lbl_act_hdr)

        action = str(self.event.get("action_taken", "ALLOW")).upper()
        lbl_act_val = QLabel(f" {action} ", card_action)
        if action in ("BLOCK", "BLOCKED", "QUARANTINE", "QUARANTINED"):
            lbl_act_val.setStyleSheet("background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; border-radius: 4px; font-weight: 800; font-size: 12px; padding: 2px 8px;")
        elif action in ("WARN", "WARNED"):
            lbl_act_val.setStyleSheet("background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; border-radius: 4px; font-weight: 800; font-size: 12px; padding: 2px 8px;")
        elif action in ("OVERRIDE", "OVERRIDDEN"):
            lbl_act_val.setStyleSheet("background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid #a855f7; border-radius: 4px; font-weight: 800; font-size: 12px; padding: 2px 8px;")
        else:
            lbl_act_val.setStyleSheet("background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; border-radius: 4px; font-weight: 800; font-size: 12px; padding: 2px 8px;")
        act_row.addWidget(lbl_act_val)
        act_row.addStretch()
        vbox_act.addLayout(act_row)

        override = bool(self.event.get("user_override"))
        override_reason = self.event.get("override_reason", "")
        if override:
            ov_box = QVBoxLayout()
            lbl_ov_title = QLabel("⚠️ User Override Executed:", card_action)
            lbl_ov_title.setStyleSheet("font-size: 11px; font-weight: 700; color: #fbbf24;")
            lbl_ov_text = QLabel(override_reason or "No justification rationale provided.", card_action)
            lbl_ov_text.setStyleSheet("font-size: 12px; color: #f1f5f9; background: #162036; border: 1px solid #2a3b5c; border-radius: 4px; padding: 6px 10px;")
            lbl_ov_text.setWordWrap(True)
            ov_box.addWidget(lbl_ov_title)
            ov_box.addWidget(lbl_ov_text)
            vbox_act.addLayout(ov_box)

        vbox_body.addWidget(card_action)

        # 2. File Path Card
        card_file = QFrame(container)
        card_file.setStyleSheet("background: #0d1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px;")
        vbox_f = QVBoxLayout(card_file)
        vbox_f.setSpacing(6)

        lbl_f_hdr = QLabel("Target File / Document Path:", card_file)
        lbl_f_hdr.setStyleSheet("font-size: 11px; font-weight: 700; color: #94a3b8;")
        vbox_f.addWidget(lbl_f_hdr)

        fpath = str(self.event.get("file_path", ""))
        lbl_f_val = QLabel(fpath, card_file)
        lbl_f_val.setStyleSheet("font-family: monospace; font-size: 12px; color: #f1f5f9;")
        lbl_f_val.setWordWrap(True)
        lbl_f_val.setTextInteractionFlags(Qt.TextSelectableByMouse)
        vbox_f.addWidget(lbl_f_val)

        btn_copy_path = QPushButton("📋 Copy Path", card_file)
        btn_copy_path.setFixedWidth(110)
        btn_copy_path.clicked.connect(lambda: QGuiApplication.clipboard().setText(fpath))
        vbox_f.addWidget(btn_copy_path)

        vbox_body.addWidget(card_file)

        # 3. Detected Entity Types & Findings Summary Card
        card_entities = QFrame(container)
        card_entities.setStyleSheet("background: #0d1322; border: 1px solid #1e293b; border-radius: 8px; padding: 10px;")
        vbox_ent = QVBoxLayout(card_entities)
        vbox_ent.setSpacing(6)

        lbl_ent_hdr = QLabel("Detected Entity Types & Findings (Redacted):", card_entities)
        lbl_ent_hdr.setStyleSheet("font-size: 11px; font-weight: 700; color: #94a3b8;")
        vbox_ent.addWidget(lbl_ent_hdr)

        det_types = self.event.get("detection_types") or ""
        if not det_types:
            summary = self.event.get("entity_summary", "")
            if summary:
                parts = [p.split(":")[0].strip() for p in summary.split(",") if p.strip()]
                det_types = ", ".join(parts)

        lbl_types_val = QLabel(f"<b>Categories:</b> {det_types or 'None'}", card_entities)
        lbl_types_val.setStyleSheet("color: #38bdf8; font-size: 12px;")
        vbox_ent.addWidget(lbl_types_val)

        summary_text = self.event.get("entity_summary") or "No entity summary available."
        lbl_sum_val = QLabel(f"<b>Summary:</b> {summary_text}", card_entities)
        lbl_sum_val.setStyleSheet("color: #cbd5e1; font-size: 12px;")
        lbl_sum_val.setWordWrap(True)
        vbox_ent.addWidget(lbl_sum_val)

        privacy_note = QLabel("🔒 Privacy Guarantee: Raw/unredacted PII is never logged or persisted to audit tables.", card_entities)
        privacy_note.setStyleSheet("color: #64748b; font-size: 10px; font-style: italic;")
        vbox_ent.addWidget(privacy_note)

        vbox_body.addWidget(card_entities)
        scroll.setWidget(container)
        layout.addWidget(scroll)

        # Footer Close Button
        btn_close = QPushButton("Close", self)
        btn_close.setFixedHeight(32)
        btn_close.clicked.connect(self.accept)
        layout.addWidget(btn_close)
