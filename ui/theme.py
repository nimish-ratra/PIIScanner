"""
Theme & Styling System for PII Sentinel
Provides cohesive, enterprise-grade Dark ("Obsidian Slate") and Light ("Studio Slate")
QSS stylesheets, color tokens, and font specifications.
"""

DARK_THEME_QSS = """
/* Global Application Styles - Enterprise Dark */
QWidget {
    background-color: #090d16;
    color: #f1f5f9;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif;
    font-size: 13px;
    selection-background-color: #2563eb;
    selection-color: #ffffff;
}

/* Window & Top Header Bar */
#topBar {
    background-color: #0d1322;
    border-bottom: 1px solid #1e293b;
    padding: 8px 20px;
}

#topBarTitle {
    font-size: 15px;
    font-weight: 800;
    color: #f8fafc;
    letter-spacing: 0.5px;
}

#topBarStatus {
    font-size: 12px;
    color: #94a3b8;
}

#themeToggleButton {
    background-color: #162036;
    color: #f8fafc;
    border: 1px solid #2a3b5c;
    border-radius: 16px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
}

#themeToggleButton:hover {
    background-color: #202d4a;
    border-color: #3b82f6;
    color: #60a5fa;
}

/* Sidebar Navigation */
#sidebar {
    background-color: #070a12;
    border-right: 1px solid #1a2336;
    min-width: 240px;
    max-width: 240px;
}

#sidebarTitle {
    font-size: 18px;
    font-weight: 800;
    color: #38bdf8;
    padding: 20px 18px 4px 18px;
    letter-spacing: 0.5px;
}

#sidebarSubtitle {
    font-size: 11px;
    color: #64748b;
    padding: 0 18px 18px 18px;
    border-bottom: 1px solid #162032;
    font-weight: 500;
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
    background-color: #131b2e;
    color: #f8fafc;
}

#sidebarNavButton:checked {
    background-color: #172554;
    color: #60a5fa;
    font-weight: 700;
    border-left: 3px solid #38bdf8;
}

#sidebarFooter {
    border-top: 1px solid #162032;
    padding: 14px 16px;
    background-color: #05070e;
}

/* Content Area */
#contentArea {
    background-color: #090d16;
}

/* Scroll Areas */
QScrollArea {
    background: transparent;
    border: none;
}

QScrollArea > QWidget > QWidget {
    background: transparent;
}

/* Scrollbars - Modern Hardware-Accelerated Sleek Style */
QScrollBar:vertical {
    border: none;
    background-color: #070a12;
    width: 10px;
    margin: 0px;
    border-radius: 5px;
}
QScrollBar::handle:vertical {
    background-color: #1e293b;
    min-height: 28px;
    border-radius: 5px;
    margin: 1px;
}
QScrollBar::handle:vertical:hover {
    background-color: #38bdf8;
}
QScrollBar::handle:vertical:pressed {
    background-color: #0284c7;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    border: none;
    background: none;
    height: 0px;
}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
}

QScrollBar:horizontal {
    border: none;
    background-color: #070a12;
    height: 10px;
    margin: 0px;
    border-radius: 5px;
}
QScrollBar::handle:horizontal {
    background-color: #1e293b;
    min-width: 28px;
    border-radius: 5px;
    margin: 1px;
}
QScrollBar::handle:horizontal:hover {
    background-color: #38bdf8;
}
QScrollBar::handle:horizontal:pressed {
    background-color: #0284c7;
}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    border: none;
    background: none;
    width: 0px;
}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {
    background: none;
}

/* Cards and Panels */
.card, QGroupBox {
    background-color: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 20px 16px 16px 16px;
    margin-top: 14px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 8px;
    color: #38bdf8;
    font-weight: 700;
    font-size: 13px;
    background-color: transparent;
    border: none;
}

/* Metric Stats Cards */
#statCard {
    background-color: #0d1527;
    border: 1px solid #1e2e4a;
    border-radius: 10px;
    padding: 14px 16px;
    min-height: 80px;
    min-width: 130px;
}

#statCard:hover {
    border-color: #2e436d;
    background-color: #101a30;
}

#statCardLabel {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.6px;
}

#statCardValue {
    font-size: 26px;
    font-weight: 800;
    color: #f8fafc;
    margin-top: 4px;
}

/* Push Buttons */
QPushButton {
    background-color: #162032;
    color: #f8fafc;
    border: 1px solid #2b3b55;
    border-radius: 8px;
    padding: 8px 18px;
    font-weight: 600;
    font-size: 13px;
}

QPushButton:hover {
    background-color: #22324e;
    border-color: #3d547b;
    color: #ffffff;
}

QPushButton:pressed {
    background-color: #0d1424;
}

QPushButton:disabled {
    background-color: #0c121e;
    color: #475569;
    border-color: #172236;
}

QPushButton#primaryButton {
    background-color: #2563eb;
    color: #ffffff;
    border: 1px solid #3b82f6;
    font-weight: 700;
}

QPushButton#primaryButton:hover {
    background-color: #1d4ed8;
    border-color: #60a5fa;
}

QPushButton#primaryButton:pressed {
    background-color: #1e40af;
}

QPushButton#dangerButton {
    background-color: #b91c1c;
    color: #ffffff;
    border: 1px solid #ef4444;
    font-weight: 700;
}

QPushButton#dangerButton:hover {
    background-color: #991b1b;
}

QPushButton#warningButton {
    background-color: #d97706;
    color: #ffffff;
    border: 1px solid #f59e0b;
    font-weight: 700;
}

QPushButton#warningButton:hover {
    background-color: #b45309;
}

QPushButton#successButton {
    background-color: #059669;
    color: #ffffff;
    border: 1px solid #10b981;
    font-weight: 700;
}

QPushButton#successButton:hover {
    background-color: #047857;
}

/* Line Edits, Combos, SpinBoxes */
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background-color: #070a14;
    color: #f8fafc;
    border: 1px solid #243248;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
}

QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {
    border: 1px solid #38bdf8;
    background-color: #0a0f1e;
}

QComboBox::drop-down {
    subcontrol-origin: padding;
    subcontrol-position: top right;
    width: 28px;
    border-left: 1px solid #243248;
}

QComboBox QAbstractItemView {
    background-color: #0d1527;
    border: 1px solid #243248;
    selection-background-color: #1d4ed8;
    color: #f8fafc;
    padding: 4px;
}

/* Sliders */
QSlider::groove:horizontal {
    height: 6px;
    background: #1a253b;
    border-radius: 3px;
}

QSlider::sub-page:horizontal {
    background: #3b82f6;
    border-radius: 3px;
}

QSlider::handle:horizontal {
    background: #ffffff;
    border: 3px solid #3b82f6;
    width: 18px;
    margin-top: -6px;
    margin-bottom: -6px;
    border-radius: 9px;
}

QSlider::handle:horizontal:hover {
    background: #bfdbfe;
    border-color: #60a5fa;
}

/* Progress Bar */
QProgressBar {
    background-color: #070a14;
    border: 1px solid #1e293b;
    border-radius: 8px;
    text-align: center;
    color: #ffffff;
    font-weight: 700;
    height: 22px;
    font-size: 12px;
}

QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #2563eb, stop:1 #38bdf8);
    border-radius: 7px;
}

/* Table View */
QTableWidget, QTableView {
    background-color: #0c1220;
    alternate-background-color: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 8px;
    gridline-color: #182236;
    color: #f1f5f9;
}

QTableWidget::item {
    padding: 8px 12px;
    border-bottom: 1px solid #151f33;
}

QTableWidget::item:selected {
    background-color: #172554;
    color: #ffffff;
}

QHeaderView::section {
    background-color: #070b14;
    color: #94a3b8;
    padding: 10px 12px;
    border: none;
    border-right: 1px solid #182236;
    border-bottom: 2px solid #1e293b;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* Scrollbars */
QScrollBar:vertical {
    background-color: #070a12;
    width: 10px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background-color: #22314d;
    min-height: 24px;
    border-radius: 5px;
    margin: 2px;
}

QScrollBar::handle:vertical:hover {
    background-color: #3b5078;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
    height: 0;
}

QScrollBar:horizontal {
    background-color: #070a12;
    height: 10px;
    margin: 0;
}

QScrollBar::handle:horizontal {
    background-color: #22314d;
    min-width: 24px;
    border-radius: 5px;
    margin: 2px;
}

/* Badges / Labels */
#badgeOffline {
    background-color: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.35);
    border-radius: 12px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
}

#badgeStatus {
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
}

/* Log Console */
QPlainTextEdit#logConsole {
    background-color: #050811;
    color: #94a3b8;
    border: 1px solid #1a2438;
    border-radius: 8px;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 12px;
    padding: 10px;
}

/* Checkboxes */
QCheckBox {
    spacing: 8px;
    color: #f1f5f9;
    font-size: 12px;
    font-weight: 500;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #374a6d;
    background-color: #070a14;
}

QCheckBox::indicator:hover {
    border-color: #60a5fa;
}

QCheckBox::indicator:checked {
    background-color: #2563eb;
    border-color: #38bdf8;
}

/* Tab Widget */
QTabWidget::pane {
    border: 1px solid #1e293b;
    border-radius: 8px;
    background-color: #0b0f19;
    top: -1px;
}

QTabBar::tab {
    background-color: #111827;
    color: #94a3b8;
    border: 1px solid #1e293b;
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 10px 20px;
    font-weight: 600;
    margin-right: 4px;
}

QTabBar::tab:selected {
    background-color: #0b0f19;
    color: #38bdf8;
    border-color: #2563eb;
    border-bottom: 2px solid #38bdf8;
}

QTabBar::tab:hover:!selected {
    background-color: #1a2336;
    color: #f8fafc;
}

/* Status Bar */
QStatusBar {
    background-color: #070a12;
    border-top: 1px solid #1a2336;
    color: #94a3b8;
    font-size: 12px;
    padding: 2px 10px;
}
"""

LIGHT_THEME_QSS = """
/* Global Application Styles - Enterprise Light */
QWidget {
    background-color: #f8fafc;
    color: #0f172a;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif;
    font-size: 13px;
    selection-background-color: #2563eb;
    selection-color: #ffffff;
}

/* Window & Top Header Bar */
#topBar {
    background-color: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 20px;
}

#topBarTitle {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 0.5px;
}

#topBarStatus {
    font-size: 12px;
    color: #475569;
}

#themeToggleButton {
    background-color: #f1f5f9;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
}

#themeToggleButton:hover {
    background-color: #e2e8f0;
    border-color: #2563eb;
    color: #1d4ed8;
}

/* Sidebar Navigation */
#sidebar {
    background-color: #ffffff;
    border-right: 1px solid #e2e8f0;
    min-width: 240px;
    max-width: 240px;
}

#sidebarTitle {
    font-size: 18px;
    font-weight: 800;
    color: #1d4ed8;
    padding: 20px 18px 4px 18px;
    letter-spacing: 0.5px;
}

#sidebarSubtitle {
    font-size: 11px;
    color: #64748b;
    padding: 0 18px 18px 18px;
    border-bottom: 1px solid #e2e8f0;
    font-weight: 500;
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
    background-color: #eff6ff;
    color: #1d4ed8;
    font-weight: 700;
    border-left: 3px solid #2563eb;
}

#sidebarFooter {
    border-top: 1px solid #e2e8f0;
    padding: 14px 16px;
    background-color: #f8fafc;
}

/* Content Area */
#contentArea {
    background-color: #f8fafc;
}

/* Scroll Areas */
QScrollArea {
    background: transparent;
    border: none;
}

QScrollArea > QWidget > QWidget {
    background: transparent;
}

/* Scrollbars - Studio Slate Light Theme */
QScrollBar:vertical {
    border: none;
    background-color: #f1f5f9;
    width: 10px;
    margin: 0px;
    border-radius: 5px;
}
QScrollBar::handle:vertical {
    background-color: #cbd5e1;
    min-height: 28px;
    border-radius: 5px;
    margin: 1px;
}
QScrollBar::handle:vertical:hover {
    background-color: #2563eb;
}
QScrollBar::handle:vertical:pressed {
    background-color: #1d4ed8;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    border: none;
    background: none;
    height: 0px;
}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
}

QScrollBar:horizontal {
    border: none;
    background-color: #f1f5f9;
    height: 10px;
    margin: 0px;
    border-radius: 5px;
}
QScrollBar::handle:horizontal {
    background-color: #cbd5e1;
    min-width: 28px;
    border-radius: 5px;
    margin: 1px;
}
QScrollBar::handle:horizontal:hover {
    background-color: #2563eb;
}
QScrollBar::handle:horizontal:pressed {
    background-color: #1d4ed8;
}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    border: none;
    background: none;
    width: 0px;
}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {
    background: none;
}

/* Cards and Panels */
.card, QGroupBox {
    background-color: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 20px 16px 16px 16px;
    margin-top: 14px;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 8px;
    color: #0f172a;
    font-weight: 700;
    font-size: 13px;
    background-color: transparent;
    border: none;
}

/* Metric Stats Cards */
#statCard {
    background-color: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 16px;
    min-height: 80px;
    min-width: 130px;
}

#statCard:hover {
    border-color: #cbd5e1;
    background-color: #fbfcfe;
}

#statCardLabel {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.6px;
}

#statCardValue {
    font-size: 26px;
    font-weight: 800;
    color: #0f172a;
    margin-top: 4px;
}

/* Push Buttons */
QPushButton {
    background-color: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 18px;
    font-weight: 600;
    font-size: 13px;
}

QPushButton:hover {
    background-color: #f1f5f9;
    border-color: #94a3b8;
    color: #020617;
}

QPushButton:pressed {
    background-color: #e2e8f0;
}

QPushButton:disabled {
    background-color: #f8fafc;
    color: #94a3b8;
    border-color: #e2e8f0;
}

QPushButton#primaryButton {
    background-color: #2563eb;
    color: #ffffff;
    border: 1px solid #1d4ed8;
    font-weight: 700;
}

QPushButton#primaryButton:hover {
    background-color: #1d4ed8;
    border-color: #1e40af;
}

QPushButton#primaryButton:pressed {
    background-color: #1e40af;
}

QPushButton#dangerButton {
    background-color: #dc2626;
    color: #ffffff;
    border: 1px solid #b91c1c;
    font-weight: 700;
}

QPushButton#dangerButton:hover {
    background-color: #b91c1c;
}

QPushButton#warningButton {
    background-color: #d97706;
    color: #ffffff;
    border: 1px solid #b45309;
    font-weight: 700;
}

QPushButton#warningButton:hover {
    background-color: #b45309;
}

QPushButton#successButton {
    background-color: #059669;
    color: #ffffff;
    border: 1px solid #047857;
    font-weight: 700;
}

QPushButton#successButton:hover {
    background-color: #047857;
}

/* Line Edits, Combos, SpinBoxes */
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background-color: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
}

QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {
    border: 1px solid #2563eb;
    background-color: #ffffff;
}

QComboBox::drop-down {
    subcontrol-origin: padding;
    subcontrol-position: top right;
    width: 28px;
    border-left: 1px solid #cbd5e1;
}

QComboBox QAbstractItemView {
    background-color: #ffffff;
    border: 1px solid #cbd5e1;
    selection-background-color: #eff6ff;
    selection-color: #1d4ed8;
    color: #0f172a;
    padding: 4px;
}

/* Sliders */
QSlider::groove:horizontal {
    height: 6px;
    background: #e2e8f0;
    border-radius: 3px;
}

QSlider::sub-page:horizontal {
    background: #2563eb;
    border-radius: 3px;
}

QSlider::handle:horizontal {
    background: #ffffff;
    border: 3px solid #2563eb;
    width: 18px;
    margin-top: -6px;
    margin-bottom: -6px;
    border-radius: 9px;
}

QSlider::handle:horizontal:hover {
    background: #eff6ff;
    border-color: #1d4ed8;
}

/* Progress Bar */
QProgressBar {
    background-color: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    text-align: center;
    color: #0f172a;
    font-weight: 700;
    height: 22px;
    font-size: 12px;
}

QProgressBar::chunk {
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #2563eb, stop:1 #38bdf8);
    border-radius: 7px;
}

/* Table View */
QTableWidget, QTableView {
    background-color: #ffffff;
    alternate-background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    gridline-color: #f1f5f9;
    color: #0f172a;
}

QTableWidget::item {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
}

QTableWidget::item:selected {
    background-color: #eff6ff;
    color: #1d4ed8;
}

QHeaderView::section {
    background-color: #f1f5f9;
    color: #475569;
    padding: 10px 12px;
    border: none;
    border-right: 1px solid #e2e8f0;
    border-bottom: 2px solid #cbd5e1;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* Scrollbars */
QScrollBar:vertical {
    background-color: #f8fafc;
    width: 10px;
    margin: 0;
}

QScrollBar::handle:vertical {
    background-color: #cbd5e1;
    min-height: 24px;
    border-radius: 5px;
    margin: 2px;
}

QScrollBar::handle:vertical:hover {
    background-color: #94a3b8;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
    height: 0;
}

QScrollBar:horizontal {
    background-color: #f8fafc;
    height: 10px;
    margin: 0;
}

QScrollBar::handle:horizontal {
    background-color: #cbd5e1;
    min-width: 24px;
    border-radius: 5px;
    margin: 2px;
}

/* Badges / Labels */
#badgeOffline {
    background-color: rgba(5, 150, 105, 0.12);
    color: #059669;
    border: 1px solid rgba(5, 150, 105, 0.3);
    border-radius: 12px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
}

#badgeStatus {
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
}

/* Log Console */
QPlainTextEdit#logConsole {
    background-color: #ffffff;
    color: #334155;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 12px;
    padding: 10px;
}

/* Checkboxes */
QCheckBox {
    spacing: 8px;
    color: #0f172a;
    font-size: 12px;
    font-weight: 500;
}

QCheckBox::indicator {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #cbd5e1;
    background-color: #ffffff;
}

QCheckBox::indicator:hover {
    border-color: #2563eb;
}

QCheckBox::indicator:checked {
    background-color: #2563eb;
    border-color: #1d4ed8;
}

/* Tab Widget */
QTabWidget::pane {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background-color: #ffffff;
    top: -1px;
}

QTabBar::tab {
    background-color: #f1f5f9;
    color: #64748b;
    border: 1px solid #e2e8f0;
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 10px 20px;
    font-weight: 600;
    margin-right: 4px;
}

QTabBar::tab:selected {
    background-color: #ffffff;
    color: #2563eb;
    border-color: #cbd5e1;
    border-bottom: 2px solid #2563eb;
}

QTabBar::tab:hover:!selected {
    background-color: #e2e8f0;
    color: #0f172a;
}

/* Status Bar */
QStatusBar {
    background-color: #ffffff;
    border-top: 1px solid #e2e8f0;
    color: #64748b;
    font-size: 12px;
    padding: 2px 10px;
}
"""


def get_theme_qss(theme_name: str = "dark") -> str:
    """Return the corresponding QSS stylesheet string."""
    if str(theme_name).lower() == "light":
        return LIGHT_THEME_QSS
    return DARK_THEME_QSS
