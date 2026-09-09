"""
PII Selector, Viewer, and File List Modal Dialogs for PII Sentinel
Provides dedicated, lag-free dialogs for managing Presidio entities and viewing scan files.
"""

import os
from typing import List, Dict, Set, Optional
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QScrollArea, QWidget, QGridLayout, QCheckBox,
    QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView,
    QMessageBox
)
from PySide6.QtCore import Qt


# Entity categories and metadata mapping (36 exact Presidio supported entities)
ENTITY_CATEGORIES = {
    "India PII": {
        "badge": "🇮🇳 India",
        "description": "India-specific government IDs, tax identifiers, and banking codes",
        "entities": [
            ("IN_AADHAAR", "Aadhaar 12-digit UIDAI number (Verhoeff checksum verified)"),
            ("IN_PAN", "Permanent Account Number (10 alphanumeric characters)"),
            ("IN_GSTIN", "Goods & Services Tax Identification Number (15 digits)"),
            ("IN_IFSC", "Indian Financial System Code (11 characters)"),
            ("IN_PASSPORT", "Indian Passport number (1 letter + 7 digits)"),
            ("IN_VOTER_ID", "Election Commission Voter ID / EPIC number"),
        ]
    },
    "Developer Secrets": {
        "badge": "🔑 Secrets",
        "description": "API tokens, private keys, and cloud infrastructure credentials",
        "entities": [
            ("AWS_ACCESS_KEY", "Amazon Web Services Access Key ID (AKIA/ASIA...)"),
            ("GITHUB_TOKEN", "GitHub Personal Access / OAuth / App token"),
            ("OPENAI_API_KEY", "OpenAI API secret key (sk-...)"),
            ("GOOGLE_API_KEY", "Google Cloud / Firebase API key (AIza...)"),
            ("SLACK_TOKEN", "Slack Bot / User authentication token (xoxb/xoxp/xoxa)"),
            ("PRIVATE_KEY", "RSA / DSA / EC / OpenSSH PEM Private Key blocks"),
            ("JWT_TOKEN", "JSON Web Token (RFC 7519 3-part signed token)"),
        ]
    },
    "Financial & Banking": {
        "badge": "💳 Financial",
        "description": "Credit cards, bank account numbers, crypto addresses, and IBANs",
        "entities": [
            ("CREDIT_CARD", "Credit and debit card numbers (Luhn checksum verified)"),
            ("CRYPTO", "Cryptocurrency wallet addresses (Bitcoin, Ethereum)"),
            ("IBAN_CODE", "International Bank Account Number (ISO 7064 Mod-97 verified)"),
            ("US_BANK_NUMBER", "US Bank routing and account numbers"),
        ]
    },
    "Personal & Contact": {
        "badge": "👤 Personal",
        "description": "Names, emails, phone numbers, addresses, and individual identifiers",
        "entities": [
            ("PERSON", "Individual full names and personal identity mentions"),
            ("EMAIL_ADDRESS", "Standard email addresses (RFC 5322)"),
            ("EMAIL", "Email address detector alias"),
            ("PHONE_NUMBER", "International and domestic phone numbers"),
            ("LOCATION", "Physical addresses, cities, provinces, and countries"),
            ("DATE_TIME", "Calendar dates, timestamps, and birthdates"),
            ("AGE", "Age specifications and age-related phrases"),
            ("IP_ADDRESS", "IPv4 and IPv6 network addresses"),
            ("MAC_ADDRESS", "Media Access Control hardware addresses"),
            ("URL", "Web URLs and domain names"),
            ("NRP", "Nationality, religious, or political group affiliations"),
        ]
    },
    "Government & IDs": {
        "badge": "🏛️ Gov & IDs",
        "description": "Government identification, tax IDs, driver licenses, and organizations",
        "entities": [
            ("US_SSN", "US Social Security Numbers (9 digits)"),
            ("US_PASSPORT", "US Passport book numbers"),
            ("US_DRIVER_LICENSE", "US State driver license numbers"),
            ("US_ITIN", "US Individual Taxpayer Identification Numbers"),
            ("UK_NHS", "UK National Health Service patient numbers"),
            ("ID", "General identification numbers and credentials"),
            ("ORGANIZATION", "Enterprise and company organization names"),
            ("MEDICAL_LICENSE", "Medical practitioner license numbers (DEA, State Board)"),
        ]
    }
}


class PiiSelectorDialog(QDialog):
    """
    Dedicated, lag-free modal dialog for configuring active PII detection entities.
    Features instant search filtering, category tabs, one-click category toggles,
    and bulk select/deselect operations.
    """

    def __init__(
        self,
        all_entities: List[str],
        selected_entities: Optional[List[str]],
        parent: Optional[QWidget] = None,
        mode: str = "batch"
    ):
        super().__init__(parent)
        self.mode = mode
        if mode == "realtime":
            self.setWindowTitle("Configure Real-Time Detection Types - PII Sentinel")
        else:
            self.setWindowTitle("Configure PII Detection Types - PII Sentinel")
        self.resize(780, 600)
        self.setMinimumSize(680, 500)
        self.setModal(True)
        self.setStyleSheet("""
            QDialog {
                background-color: #0b0f19;
                color: #f1f5f9;
            }
            QLabel {
                color: #f1f5f9;
            }
        """)

        self.all_entities = sorted(all_entities)
        # If None, default to all entities selected.
        # Otherwise, respect the exact selected subset.
        if selected_entities is None:
            self.current_selection: Set[str] = set(self.all_entities)
        else:
            self.current_selection: Set[str] = set(selected_entities)

        self.checkbox_map: Dict[str, QCheckBox] = {}
        self.category_checkboxes: Dict[str, QCheckBox] = {}
        self.category_entities_map: Dict[str, list] = {}
        self.entity_widgets: Dict[str, QWidget] = {}
        self.active_category_filter: Optional[str] = None

        self._build_ui()
        self._update_stats_label()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(14)

        # 1. Header with title and explanation
        header_box = QHBoxLayout()
        header_text = QVBoxLayout()
        if self.mode == "realtime":
            title_lbl = QLabel("Configure Real-Time Detection Entities", self)
            title_lbl.setStyleSheet("font-size: 16px; font-weight: 700; color: #f8fafc;")
            sub_lbl = QLabel(
                "Select which PII identifiers trigger real-time pre-save blocks in Office and file quarantine.",
                self
            )
        else:
            title_lbl = QLabel("Configure Detection Entities", self)
            title_lbl.setStyleSheet("font-size: 16px; font-weight: 700; color: #f8fafc;")
            sub_lbl = QLabel(
                "Select which PII identifiers, India-specific credentials, and Developer secrets to scan for.",
                self
            )
        sub_lbl.setStyleSheet("color: #94a3b8; font-size: 12px;")
        header_text.addWidget(title_lbl)
        header_text.addWidget(sub_lbl)
        header_box.addLayout(header_text)
        header_box.addStretch()

        self.lbl_counter_badge = QLabel("", self)
        self.lbl_counter_badge.setStyleSheet(
            "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
            "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
        )
        header_box.addWidget(self.lbl_counter_badge)
        layout.addLayout(header_box)

        # 2. Search & Filter Bar
        filter_bar = QHBoxLayout()
        filter_bar.setSpacing(10)

        self.search_box = QLineEdit(self)
        self.search_box.setPlaceholderText("🔍 Filter entities (e.g. PAN, Aadhaar, AWS, EMAIL, JWT)...")
        self.search_box.setStyleSheet(
            "background-color: #0d1322; border: 1px solid #1e293b; border-radius: 8px; "
            "padding: 8px 12px; color: #f1f5f9; font-size: 13px;"
        )
        self.search_box.textChanged.connect(self._apply_filter)
        filter_bar.addWidget(self.search_box, 3)

        action_btn_style = """
            QPushButton {
                background-color: #162036;
                color: #f1f5f9;
                border: 1px solid #2a3b5c;
                border-radius: 6px;
                padding: 7px 14px;
                font-size: 12px;
                font-weight: 600;
            }
            QPushButton:hover {
                background-color: #202d4a;
                border-color: #3b82f6;
                color: #60a5fa;
            }
        """

        # Fast action buttons
        btn_select_all = QPushButton("Select All", self)
        btn_select_all.clicked.connect(self._select_all)
        btn_select_all.setStyleSheet(action_btn_style)

        btn_deselect_all = QPushButton("Deselect All", self)
        btn_deselect_all.clicked.connect(self._deselect_all)
        btn_deselect_all.setStyleSheet(action_btn_style)

        btn_recommended = QPushButton("Recommended Defaults", self)
        btn_recommended.clicked.connect(self._select_recommended)
        btn_recommended.setStyleSheet(action_btn_style)

        filter_bar.addWidget(btn_select_all)
        filter_bar.addWidget(btn_deselect_all)
        filter_bar.addWidget(btn_recommended)
        layout.addLayout(filter_bar)

        # 3. Category Filter Chips
        chips_layout = QHBoxLayout()
        chips_layout.setSpacing(8)

        self.cat_buttons: Dict[str, QPushButton] = {}
        all_btn = QPushButton("All Categories (36)", self)
        all_btn.setCheckable(True)
        all_btn.setChecked(True)
        all_btn.clicked.connect(lambda: self._set_category_filter(None))
        self._style_chip(all_btn, active=True)
        chips_layout.addWidget(all_btn)
        self.cat_buttons["ALL"] = all_btn

        for cat_name, cat_data in ENTITY_CATEGORIES.items():
            count = len(cat_data["entities"])
            btn = QPushButton(f"{cat_data['badge']} ({count})", self)
            btn.setCheckable(True)
            btn.clicked.connect(lambda checked, c=cat_name: self._set_category_filter(c))
            self._style_chip(btn, active=False)
            chips_layout.addWidget(btn)
            self.cat_buttons[cat_name] = btn

        chips_layout.addStretch()
        layout.addLayout(chips_layout)

        # 4. Scrollable Container for categorized entity cards
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background-color: transparent; border: 1px solid #1e293b; border-radius: 8px;")

        container = QWidget()
        self.cards_layout = QVBoxLayout(container)
        self.cards_layout.setContentsMargins(14, 14, 14, 14)
        self.cards_layout.setSpacing(14)

        # Build category groups
        self.category_widgets: Dict[str, QWidget] = {}

        # First populate defined categories
        handled_entities = set()
        for cat_name, cat_data in ENTITY_CATEGORIES.items():
            cat_widget = self._build_category_section(cat_name, cat_data)
            self.cards_layout.addWidget(cat_widget)
            self.category_widgets[cat_name] = cat_widget
            for ent, _ in cat_data["entities"]:
                handled_entities.add(ent)

        # Any extra supported entities that weren't in the predefined list
        remaining = [e for e in self.all_entities if e not in handled_entities]
        if remaining:
            extra_data = {
                "badge": "⚙️ Additional",
                "description": "Other supported Presidio detection entities",
                "entities": [(e, f"Standard detector for {e}") for e in remaining]
            }
            extra_widget = self._build_category_section("Additional", extra_data)
            self.cards_layout.addWidget(extra_widget)
            self.category_widgets["Additional"] = extra_widget

        scroll.setWidget(container)
        layout.addWidget(scroll)

        # 5. Bottom Dialog Buttons
        bottom_bar = QHBoxLayout()
        self.lbl_status = QLabel("", self)
        self.lbl_status.setStyleSheet("color: #94a3b8; font-size: 12px;")
        bottom_bar.addWidget(self.lbl_status)
        bottom_bar.addStretch()

        btn_cancel = QPushButton("Cancel", self)
        btn_cancel.clicked.connect(self.reject)
        btn_cancel.setStyleSheet("padding: 8px 18px; font-size: 13px;")

        btn_save = QPushButton("Save && Apply Selection", self)
        btn_save.setStyleSheet(
            "background-color: #2563eb; color: #ffffff; font-weight: 700; "
            "border-radius: 8px; padding: 8px 22px; font-size: 13px;"
        )
        btn_save.clicked.connect(self._on_save_clicked)

        bottom_bar.addWidget(btn_cancel)
        bottom_bar.addWidget(btn_save)
        layout.addLayout(bottom_bar)

    def _on_save_clicked(self) -> None:
        if len(self.current_selection) == 0:
            QMessageBox.warning(
                self,
                "No PII Types Selected",
                "Please select at least one PII entity type to detect before saving.\n\n"
                "Tip: Click '⭐ Recommended' to quickly select standard detection types, or click 'Select All'."
            )
            return
        self.accept()

    def _style_chip(self, btn: QPushButton, active: bool) -> None:
        if active:
            btn.setStyleSheet(
                "background: #1e3a8a; color: #93c5fd; border: 1px solid #3b82f6; "
                "border-radius: 14px; padding: 4px 12px; font-size: 11px; font-weight: 700;"
            )
        else:
            btn.setStyleSheet(
                "background: #0f172a; color: #94a3b8; border: 1px solid #1e293b; "
                "border-radius: 14px; padding: 4px 12px; font-size: 11px; font-weight: 600;"
            )

    def _build_category_section(self, cat_name: str, cat_data: dict) -> QWidget:
        box = QWidget()
        box.setStyleSheet("background: #0d1322; border: 1px solid #1a253a; border-radius: 8px;")
        box_vbox = QVBoxLayout(box)
        box_vbox.setContentsMargins(14, 12, 14, 12)
        box_vbox.setSpacing(10)

        # Category Header with one-click category toggle
        header = QHBoxLayout()
        cat_cb = QCheckBox(cat_data["badge"], box)
        cat_cb.setCursor(Qt.PointingHandCursor)
        cat_cb.setStyleSheet("font-size: 13px; font-weight: 700; color: #e2e8f0;")
        header.addWidget(cat_cb)

        desc_lbl = QLabel(f"— {cat_data['description']}", box)
        desc_lbl.setStyleSheet("color: #64748b; font-size: 11px;")
        header.addWidget(desc_lbl)
        header.addStretch()

        box_vbox.addLayout(header)

        # Entity checkboxes grid (2 columns)
        grid = QGridLayout()
        grid.setSpacing(8)

        col = 0
        row = 0
        cat_entities = [(ent, desc) for ent, desc in cat_data["entities"] if ent in self.all_entities]
        self.category_entities_map[cat_name] = cat_entities

        for ent, desc in cat_entities:
            ent_widget = QWidget(box)
            ent_widget.setStyleSheet("background: transparent;")
            ent_box = QVBoxLayout(ent_widget)
            ent_box.setContentsMargins(4, 2, 4, 2)
            ent_box.setSpacing(2)

            cb = QCheckBox(ent, ent_widget)
            cb.setCursor(Qt.PointingHandCursor)
            cb.setStyleSheet("font-weight: 600; font-size: 12px; color: #f1f5f9;")
            cb.setChecked(ent in self.current_selection)
            # Use toggled signal with clean boolean
            cb.toggled.connect(lambda checked, e=ent: self._on_entity_toggled(e, checked))
            self.checkbox_map[ent] = cb

            ent_desc = QLabel(desc, ent_widget)
            ent_desc.setStyleSheet("color: #64748b; font-size: 10px; margin-left: 20px;")
            ent_desc.setWordWrap(True)

            ent_box.addWidget(cb)
            ent_box.addWidget(ent_desc)

            self.entity_widgets[ent] = ent_widget
            grid.addWidget(ent_widget, row, col)

            col += 1
            if col >= 2:
                col = 0
                row += 1

        box_vbox.addLayout(grid)

        # Wire up category toggle using clicked signal (fires on direct user click)
        def on_cat_clicked(checked: bool):
            for ent, _ in cat_entities:
                if ent in self.checkbox_map:
                    cb = self.checkbox_map[ent]
                    cb.blockSignals(True)
                    cb.setChecked(checked)
                    cb.blockSignals(False)
                    if checked:
                        self.current_selection.add(ent)
                    else:
                        self.current_selection.discard(ent)
            self._update_category_cb_state(cat_name, cat_entities)
            self._update_stats_label()

        cat_cb.clicked.connect(on_cat_clicked)
        self.category_checkboxes[cat_name] = cat_cb
        self._update_category_cb_state(cat_name, cat_entities)

        return box

    def _update_category_cb_state(self, cat_name: str, cat_entities: list) -> None:
        cat_cb = self.category_checkboxes.get(cat_name)
        if not cat_cb:
            return
        ents = [e for e, _ in cat_entities if e in self.checkbox_map]
        if not ents:
            return
        checked_count = sum(1 for e in ents if self.checkbox_map[e].isChecked())
        cat_cb.blockSignals(True)
        if checked_count == len(ents):
            cat_cb.setCheckState(Qt.CheckState.Checked)
        elif checked_count == 0:
            cat_cb.setCheckState(Qt.CheckState.Unchecked)
        else:
            cat_cb.setCheckState(Qt.CheckState.PartiallyChecked)
        cat_cb.blockSignals(False)

    def _on_entity_toggled(self, entity: str, checked: bool) -> None:
        if checked:
            self.current_selection.add(entity)
        else:
            self.current_selection.discard(entity)

        # Update category checkbox state
        for cat_name, cat_entities in self.category_entities_map.items():
            if any(e == entity for e, _ in cat_entities):
                self._update_category_cb_state(cat_name, cat_entities)
                break

        self._update_stats_label()

    def _update_stats_label(self) -> None:
        total = len(self.checkbox_map)
        selected = len(self.current_selection)
        if selected == 0:
            self.lbl_counter_badge.setText(f"0 of {total} Selected")
            self.lbl_counter_badge.setStyleSheet(
                "background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); "
                "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
            )
            self.lbl_status.setText("⚠️ At least 1 entity type must be selected to run scans.")
            self.lbl_status.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
        elif selected == total:
            self.lbl_counter_badge.setText(f"All {total} Selected")
            self.lbl_counter_badge.setStyleSheet(
                "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); "
                "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
            )
            self.lbl_status.setText(f"Active entities: {selected} / {total} (Full scanning coverage)")
            self.lbl_status.setStyleSheet("color: #94a3b8; font-size: 12px;")
        else:
            self.lbl_counter_badge.setText(f"{selected} of {total} Selected")
            self.lbl_counter_badge.setStyleSheet(
                "background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); "
                "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
            )
            self.lbl_status.setText(f"Active entities: {selected} / {total} customized")
            self.lbl_status.setStyleSheet("color: #94a3b8; font-size: 12px;")

    def _select_all(self) -> None:
        for ent, cb in self.checkbox_map.items():
            cb.blockSignals(True)
            cb.setChecked(True)
            cb.blockSignals(False)
            self.current_selection.add(ent)

        for cat_name, cat_entities in self.category_entities_map.items():
            self._update_category_cb_state(cat_name, cat_entities)
        self._update_stats_label()

    def _deselect_all(self) -> None:
        for ent, cb in self.checkbox_map.items():
            cb.blockSignals(True)
            cb.setChecked(False)
            cb.blockSignals(False)
            self.current_selection.discard(ent)

        for cat_name, cat_entities in self.category_entities_map.items():
            self._update_category_cb_state(cat_name, cat_entities)
        self._update_stats_label()

    def _select_recommended(self) -> None:
        # Recommended defaults: All India PII, All Secrets, Core PII
        recommended = {
            "IN_AADHAAR", "IN_PAN", "IN_GSTIN", "IN_IFSC", "IN_PASSPORT", "IN_VOTER_ID",
            "AWS_ACCESS_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY", "GOOGLE_API_KEY", "SLACK_TOKEN", "PRIVATE_KEY", "JWT_TOKEN",
            "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "PERSON", "LOCATION", "CRYPTO", "US_SSN"
        }
        for ent, cb in self.checkbox_map.items():
            is_rec = ent in recommended
            cb.blockSignals(True)
            cb.setChecked(is_rec)
            cb.blockSignals(False)
            if is_rec:
                self.current_selection.add(ent)
            else:
                self.current_selection.discard(ent)

        for cat_name, cat_entities in self.category_entities_map.items():
            self._update_category_cb_state(cat_name, cat_entities)
        self._update_stats_label()

    def _set_category_filter(self, category_name: Optional[str]) -> None:
        self.active_category_filter = category_name
        # Update chip styling
        for key, btn in self.cat_buttons.items():
            is_active = (key == "ALL" and category_name is None) or (key == category_name)
            btn.setChecked(is_active)
            self._style_chip(btn, active=is_active)

        self._apply_filter(self.search_box.text())

    def _apply_filter(self, query: str) -> None:
        q = query.strip().lower()
        for cat_name, cat_widget in self.category_widgets.items():
            cat_data = ENTITY_CATEGORIES.get(cat_name, {"entities": []})
            cat_matched = (self.active_category_filter is None or self.active_category_filter == cat_name)

            visible_in_cat = 0
            for ent, desc in cat_data["entities"]:
                widget = self.entity_widgets.get(ent)
                if not widget:
                    continue
                matches_search = (not q) or (q in ent.lower()) or (q in desc.lower())
                show = cat_matched and matches_search
                widget.setVisible(show)
                if show:
                    visible_in_cat += 1

            cat_widget.setVisible(visible_in_cat > 0)

    def get_selected_entities(self) -> List[str]:
        """Return list of selected entity names."""
        return sorted(list(self.current_selection))


class PiiViewerDialog(QDialog):
    """
    Spacious, read-only modal dialog displaying all currently active PII types
    categorized with descriptions, so the user can quickly inspect what is enabled.
    """

    def __init__(
        self,
        active_entities: List[str],
        parent: Optional[QWidget] = None,
        title: Optional[str] = None
    ):
        super().__init__(parent)
        self.setWindowTitle(title or "Current Active PII Detection Types - PII Sentinel")
        self.resize(700, 520)
        self.setModal(True)

        self.active_set = set(active_entities)
        self.setStyleSheet("""
            QDialog {
                background-color: #0b0f19;
                color: #f1f5f9;
            }
            QLabel {
                color: #f1f5f9;
            }
        """)
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(14)

        # Header
        header = QHBoxLayout()
        vbox = QVBoxLayout()
        title = QLabel("Currently Enabled PII Types", self)
        title.setStyleSheet("font-size: 16px; font-weight: 700; color: #f8fafc;")
        subtitle = QLabel("The scan engine will detect and analyze the following identifiers:", self)
        subtitle.setStyleSheet("color: #94a3b8; font-size: 12px;")
        vbox.addWidget(title)
        vbox.addWidget(subtitle)
        header.addLayout(vbox)
        header.addStretch()

        badge = QLabel(f"{len(self.active_set)} Types Active", self)
        badge.setStyleSheet(
            "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); "
            "border-radius: 12px; padding: 4px 14px; font-weight: 700; font-size: 12px;"
        )
        header.addWidget(badge)
        layout.addLayout(header)

        # Scrollable list of active entities
        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("background-color: transparent; border: 1px solid #1e293b; border-radius: 8px;")

        container = QWidget()
        vbox_cards = QVBoxLayout(container)
        vbox_cards.setContentsMargins(14, 14, 14, 14)
        vbox_cards.setSpacing(12)

        if len(self.active_set) == 0:
            lbl_empty = QLabel(
                "⚠️ No PII detection types are currently active.\n\n"
                "Click 'Edit PII Detection Types...' on the scan tab to enable detection types.",
                container
            )
            lbl_empty.setStyleSheet("color: #f87171; font-size: 13px; font-weight: 600; padding: 30px;")
            lbl_empty.setAlignment(Qt.AlignCenter)
            vbox_cards.addWidget(lbl_empty)
        else:
            for cat_name, cat_data in ENTITY_CATEGORIES.items():
                active_in_cat = [
                    (ent, desc) for ent, desc in cat_data["entities"]
                    if ent in self.active_set
                ]
                if not active_in_cat:
                    continue

                grp = QWidget()
                grp.setStyleSheet("background: #0d1322; border: 1px solid #1a253a; border-radius: 8px;")
                grp_vbox = QVBoxLayout(grp)
                grp_vbox.setContentsMargins(14, 12, 14, 12)
                grp_vbox.setSpacing(8)

                grp_hdr = QLabel(f"{cat_data['badge']} ({len(active_in_cat)} active)", grp)
                grp_hdr.setStyleSheet("font-size: 13px; font-weight: 700; color: #38bdf8;")
                grp_vbox.addWidget(grp_hdr)

                for ent, desc in active_in_cat:
                    row = QHBoxLayout()
                    lbl_name = QLabel(f"✓  {ent}", grp)
                    lbl_name.setStyleSheet("font-weight: 600; font-size: 12px; color: #f1f5f9; min-width: 180px;")
                    lbl_desc = QLabel(desc, grp)
                    lbl_desc.setStyleSheet("color: #94a3b8; font-size: 11px;")
                    lbl_desc.setWordWrap(True)
                    row.addWidget(lbl_name)
                    row.addWidget(lbl_desc, 1)
                    grp_vbox.addLayout(row)

                vbox_cards.addWidget(grp)

            # Check if any additional entities are active
            handled_entities = {ent for cat_data in ENTITY_CATEGORIES.values() for ent, _ in cat_data["entities"]}
            additional_active = [ent for ent in sorted(list(self.active_set)) if ent not in handled_entities]
            if additional_active:
                grp = QWidget()
                grp.setStyleSheet("background: #0d1322; border: 1px solid #1a253a; border-radius: 8px;")
                grp_vbox = QVBoxLayout(grp)
                grp_vbox.setContentsMargins(14, 12, 14, 12)
                grp_vbox.setSpacing(8)

                grp_hdr = QLabel(f"⚙️ Additional ({len(additional_active)} active)", grp)
                grp_hdr.setStyleSheet("font-size: 13px; font-weight: 700; color: #38bdf8;")
                grp_vbox.addWidget(grp_hdr)

                for ent in additional_active:
                    row = QHBoxLayout()
                    lbl_name = QLabel(f"✓  {ent}", grp)
                    lbl_name.setStyleSheet("font-weight: 600; font-size: 12px; color: #f1f5f9; min-width: 180px;")
                    lbl_desc = QLabel("Presidio supported detection entity", grp)
                    lbl_desc.setStyleSheet("color: #94a3b8; font-size: 11px;")
                    row.addWidget(lbl_name)
                    row.addWidget(lbl_desc, 1)
                    grp_vbox.addLayout(row)

                vbox_cards.addWidget(grp)

        scroll.setWidget(container)
        layout.addWidget(scroll)

        # Bottom Close Button
        btn_close = QPushButton("Close", self)
        btn_close.clicked.connect(self.accept)
        btn_close.setStyleSheet(
            "background-color: #2563eb; color: #ffffff; font-weight: 700; "
            "border-radius: 8px; padding: 8px 24px; font-size: 13px;"
        )
        btn_box = QHBoxLayout()
        btn_box.addStretch()
        btn_box.addWidget(btn_close)
        layout.addLayout(btn_box)


class FileViewerDialog(QDialog):
    """
    Modal dialog displaying all supported files discovered in a selected scan directory,
    addressing the user's issue where filenames ended with '....' restricting visibility.
    """

    def __init__(
        self,
        files: List[str],
        folder_path: str,
        parent: Optional[QWidget] = None
    ):
        super().__init__(parent)
        self.setWindowTitle(f"Discovered Documents ({len(files)}) - PII Sentinel")
        self.resize(720, 480)
        self.setModal(True)

        self.files = files
        self.folder_path = folder_path
        self.setStyleSheet("""
            QDialog {
                background-color: #0b0f19;
                color: #f1f5f9;
            }
            QLabel {
                color: #f1f5f9;
            }
        """)
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(12)

        # Header
        title = QLabel(f"Supported Documents in Selected Directory ({len(self.files)} files)", self)
        title.setStyleSheet("font-size: 15px; font-weight: 700; color: #f8fafc;")
        path_lbl = QLabel(f"Directory: {self.folder_path}", self)
        path_lbl.setStyleSheet("color: #94a3b8; font-size: 12px; font-family: monospace;")
        path_lbl.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(path_lbl)

        # Search box
        self.search_box = QLineEdit(self)
        self.search_box.setPlaceholderText("🔍 Filter files...")
        self.search_box.setStyleSheet(
            "background-color: #0d1322; border: 1px solid #1e293b; border-radius: 8px; "
            "padding: 6px 12px; color: #f1f5f9; font-size: 12px;"
        )
        self.search_box.textChanged.connect(self._filter_table)
        layout.addWidget(self.search_box)

        # Table
        self.table = QTableWidget(self)
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels(["Filename", "Relative Path"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setAlternatingRowColors(True)

        self._populate_table(self.files)
        layout.addWidget(self.table)

        # Close button
        btn_close = QPushButton("Close", self)
        btn_close.clicked.connect(self.accept)
        btn_close.setStyleSheet(
            "background-color: #2563eb; color: #ffffff; font-weight: 700; "
            "border-radius: 8px; padding: 7px 20px; font-size: 12px;"
        )
        btn_box = QHBoxLayout()
        btn_box.addStretch()
        btn_box.addWidget(btn_close)
        layout.addLayout(btn_box)

    def _populate_table(self, file_list: List[str]) -> None:
        self.table.setRowCount(len(file_list))
        for row, rel_path in enumerate(file_list):
            fname = os.path.basename(rel_path)
            item_name = QTableWidgetItem(fname)
            item_path = QTableWidgetItem(rel_path)
            item_path.setToolTip(rel_path)
            self.table.setItem(row, 0, item_name)
            self.table.setItem(row, 1, item_path)

    def _filter_table(self, query: str) -> None:
        q = query.strip().lower()
        for r in range(self.table.rowCount()):
            name_text = self.table.item(r, 0).text().lower()
            path_text = self.table.item(r, 1).text().lower()
            visible = (not q) or (q in name_text) or (q in path_text)
            self.table.setRowHidden(r, not visible)
