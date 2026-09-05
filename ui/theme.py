"""
Theme & Styling System for PII Sentinel
Provides cohesive Dark and Light mode QSS stylesheets, color tokens, and font setup.
"""

DARK_THEME_QSS = """
/* Global Application Styles */
QWidget {
    background-color: #0b0f19;
    color: #f1f5f9;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    font-size: 13px;
    selection-background-color: #3b82f6;
    selection-color: #ffffff;
}

/* Sidebar Navigation */
#sidebar {
    background-color: #070a10;
    border-right: 1px solid #1e293b;
    min-width: 230px;
    max-width: 230px;
}

#sidebarTitle {
    font-size: 17px;
    font-weight: 700;
    color: #60a5fa;
    padding: 18px 16px 4px 16px;
    letter-spacing: 0.5px;
}

#sidebarSubtitle {
    font-size: 11px;
    color: #64748b;
    padding: 0 16px 18px 16px;
    border-bottom: 1px solid #1e293b;
}

#sidebarNavButton {
    background-color: transparent;
    color: #94a3b8;
    text-align: left;
    padding: 12px 18px;
    border: none;
    border-radius: 8px;
    margin: 4px 12px;
    font-size: 13px;
    font-weight: 600;
}

#sidebarNavButton:hover {
    background-color: #1e293b;
    color: #ffffff;
}

#sidebarNavButton:checked {
    background-color: #1e3a8a;
    color: #93c5fd;
    font-weight: 700;
    border-left: 3px solid #3b82f6;
}

#sidebarFooter {
    border-top: 1px solid #1e293b;
    padding: 14px;
    background-color: #05070c;
}

/* Content Area */
#contentArea {
    background-color: #0b0f19;
}

/* Cards and Panels */
.card, QGroupBox {
    background-color: #131b2e;
    border: 1px solid #23314d;
    border-radius: 10px;
    padding: 16px;
    margin-top: 8px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 8px;
    color: #93c5fd;
    font-weight: 700;
    font-size: 13px;
}

/* Metric Stats Cards */
#statCard {
    background-color: #131b2e;
    border: 1px solid #23314d;
    border-radius: 10px;
    padding: 14px 16px;
}

#statCardLabel {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

#statCardValue {
    font-size: 26px;
    font-weight: 800;
    color: #f8fafc;
    margin-top: 4px;
}

/* Push Buttons */
QPushButton {
    background-color: #1e293b;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 600;
    font-size: 13px;
}

QPushButton:hover {
    background-color: #334155;
    border-color: #475569;
}

QPushButton:pressed {
    background-color: #0f172a;
}

QPushButton:disabled {
    background-color: #0f172a;
    color: #475569;
    border-color: #1e293b;
}

QPushButton#primaryButton {
    background-color: #2563eb;
    color: #ffffff;
    border: 1px solid #3b82f6;
    font-weight: 700;
}

QPushButton#primaryButton:hover {
    background-color: #1d4ed8;
}

QPushButton#primaryButton:pressed {
    background-color: #1e40af;
}

QPushButton#dangerButton {
    background-color: #dc2626;
    color: #ffffff;
    border: 1px solid #ef4444;
}

QPushButton#dangerButton:hover {
    background-color: #b91c1c;
}

QPushButton#warningButton {
    background-color: #d97706;
    color: #ffffff;
    border: 1px solid #f59e0b;
}

QPushButton#warningButton:hover {
    background-color: #b45309;
}

QPushButton#successButton {
    background-color: #059669;
    color: #ffffff;
    border: 1px solid #10b981;
}

QPushButton#successButton:hover {
    background-color: #047857;
}

/* Line Edits & Search Boxes */
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background-color: #070a10;
    color: #f8fafc;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 13px;
}

QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {
    border: 1px solid #3b82f6;
}

/* Sliders */
QSlider::groove:horizontal {
    height: 6px;
    background: #1e293b;
    border-radius: 3px;
}

QSlider::sub-page:horizontal {
    background: #3b82f6;
    border-radius: 3px;
}

QSlider::handle:horizontal {
    background: #ffffff;
    border: 2px solid #3b82f6;
    width: 16px;
    margin-top: -5px;
    margin-bottom: -5px;
    border-radius: 8px;
}

QSlider::handle:horizontal:hover {
    background: #93c5fd;
}

/* Progress Bar */
QProgressBar {
    background-color: #070a10;
    border: 1px solid #1e293b;
    border-radius: 6px;
    text-align: center;
    color: #ffffff;
    font-weight: 700;
    height: 18px;
}

QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #2563eb, stop:1 #38bdf8);
    border-radius: 5px;
}

/* Table View */
QTableWidget, QTableView {
    background-color: #0c111e;
    alternate-background-color: #111827;
    border: 1px solid #1e293b;
    border-radius: 8px;
    gridline-color: #1e293b;
    color: #e2e8f0;
}

QTableWidget::item {
    padding: 6px 10px;
    border-bottom: 1px solid #192233;
}

QTableWidget::item:selected {
    background-color: #1e3a8a;
    color: #ffffff;
}

QHeaderView::section {
    background-color: #070a10;
    color: #94a3b8;
    padding: 8px 10px;
    border: none;
    border-right: 1px solid #1e293b;
    border-bottom: 2px solid #1e293b;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
}

/* Scrollbars */
QScrollBar:vertical {
    background-color: #070a10;
    width: 10px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background-color: #334155;
    min-height: 20px;
    border-radius: 5px;
    margin: 2px;
}

QScrollBar::handle:vertical:hover {
    background-color: #475569;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
    height: 0;
}

QScrollBar:horizontal {
    background-color: #070a10;
    height: 10px;
    margin: 0;
}

QScrollBar::handle:horizontal {
    background-color: #334155;
    min-width: 20px;
    border-radius: 5px;
    margin: 2px;
}

/* Badges / Labels */
#badgeOffline {
    background-color: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
}

/* Log Console */
QPlainTextEdit#logConsole {
    background-color: #05070c;
    color: #94a3b8;
    border: 1px solid #1e293b;
    border-radius: 6px;
    font-family: "Cascadia Code", Consolas, Menlo, monospace;
    font-size: 12px;
    padding: 8px;
}

/* Checkboxes */
QCheckBox {
    spacing: 8px;
    color: #e2e8f0;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #475569;
    background-color: #070a10;
}

QCheckBox::indicator:checked {
    background-color: #2563eb;
    border-color: #3b82f6;
}

/* Status Bar */
QStatusBar {
    background-color: #070a10;
    border-top: 1px solid #1e293b;
    color: #64748b;
    font-size: 12px;
}
"""

LIGHT_THEME_QSS = """
/* Global Application Styles - Light */
QWidget {
    background-color: #f8fafc;
    color: #0f172a;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    font-size: 13px;
    selection-background-color: #2563eb;
    selection-color: #ffffff;
}

#sidebar {
    background-color: #ffffff;
    border-right: 1px solid #e2e8f0;
    min-width: 230px;
    max-width: 230px;
}

#sidebarTitle {
    font-size: 17px;
    font-weight: 700;
    color: #1e40af;
    padding: 18px 16px 4px 16px;
}

#sidebarSubtitle {
    font-size: 11px;
    color: #64748b;
    padding: 0 16px 18px 16px;
    border-bottom: 1px solid #e2e8f0;
}

#sidebarNavButton {
    background-color: transparent;
    color: #475569;
    text-align: left;
    padding: 12px 18px;
    border: none;
    border-radius: 8px;
    margin: 4px 12px;
    font-size: 13px;
    font-weight: 600;
}

#sidebarNavButton:hover {
    background-color: #f1f5f9;
    color: #0f172a;
}

#sidebarNavButton:checked {
    background-color: #dbeafe;
    color: #1d4ed8;
    font-weight: 700;
    border-left: 3px solid #2563eb;
}

#sidebarFooter {
    border-top: 1px solid #e2e8f0;
    padding: 14px;
    background-color: #ffffff;
}

#contentArea {
    background-color: #f8fafc;
}

.card, QGroupBox {
    background-color: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    margin-top: 8px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 8px;
    color: #1d4ed8;
    font-weight: 700;
    font-size: 13px;
}

#statCard {
    background-color: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 16px;
}

#statCardLabel {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
}

#statCardValue {
    font-size: 26px;
    font-weight: 800;
    color: #0f172a;
    margin-top: 4px;
}

QPushButton {
    background-color: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 600;
}

QPushButton:hover {
    background-color: #f1f5f9;
}

QPushButton#primaryButton {
    background-color: #2563eb;
    color: #ffffff;
    border: 1px solid #1d4ed8;
}

QPushButton#primaryButton:hover {
    background-color: #1d4ed8;
}

QPushButton#dangerButton {
    background-color: #dc2626;
    color: #ffffff;
    border: 1px solid #b91c1c;
}

QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background-color: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 7px 12px;
}

QTableWidget, QTableView {
    background-color: #ffffff;
    alternate-background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    gridline-color: #e2e8f0;
    color: #0f172a;
}

QHeaderView::section {
    background-color: #f1f5f9;
    color: #475569;
    padding: 8px 10px;
    border: none;
    border-right: 1px solid #e2e8f0;
    border-bottom: 2px solid #e2e8f0;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
}

QPlainTextEdit#logConsole {
    background-color: #ffffff;
    color: #334155;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-family: Consolas, monospace;
    font-size: 12px;
}

QStatusBar {
    background-color: #ffffff;
    border-top: 1px solid #e2e8f0;
    color: #64748b;
}
"""


def get_theme_qss(theme_name: str = "dark") -> str:
    """Return the corresponding QSS stylesheet string."""
    if theme_name.lower() == "light":
        return LIGHT_THEME_QSS
    return DARK_THEME_QSS
