"""
Theme & Styling System for CLAISSIFY
A single, fixed QSS design system matching the exact enterprise cybersecurity
palette specified for the app's dashboard redesign: a deep navy sidebar,
a light gray-tinted workspace holding white panels with hairline borders,
blue as the one interactive accent, and green/amber/red reserved strictly
for genuine success/warning/danger states - never decoration.
"""

# Exact palette from the design brief - not derived from a component
# library this time, so these are named for what they mean rather than a
# Tailwind-style numeric scale.
_PRIMARY_NAVY = "#0B1626"       # window chrome
_SIDEBAR_BG = "#101C2D"          # sidebar navy
_SIDEBAR_HOVER_BG = "#16273D"    # between sidebar bg and active bg
_SIDEBAR_ACTIVE_BG = "#18345A"   # sidebar active nav background
_SIDEBAR_BORDER = "#1C2C42"

_BLUE = "#1677FF"                # primary interactive/accent blue
_BLUE_ACTION = "#1769E0"         # bright action blue (primary buttons)
_BLUE_LIGHT_BG = "#EEF5FF"       # light blue background (tints, selection)

_APP_BG = "#F5F7FA"              # main application background
_CARD_BG = "#FFFFFF"

_TEXT_PRIMARY = "#152238"
_TEXT_SECONDARY = "#64748B"
_TEXT_MUTED = "#94A3B8"
_BORDER = "#DCE3EC"

_SUCCESS = "#15966B"
_SUCCESS_BG = "#EAF8F1"
_WARNING = "#D98A00"
_WARNING_BG = "#FFF7E6"
_DANGER = "#D92D20"
_DANGER_BG = "#FFF0EF"
_DISABLED = "#CBD5E1"

# Retained for scrollbar/hover shades not covered by the named palette above -
# a lightweight two-step gray scale used only where a border/bg colour alone
# isn't visually distinct enough for its purpose.
_GRAY_TRACK = "#EEF1F5"
_GRAY_HANDLE = "#C7D0DC"

THEME_QSS = f"""
/* Global Application Styles.
   Deliberately no background-color on the generic QWidget selector: in Qt
   Style Sheets that would make every widget - including plain QLabels that
   sit on the dark sidebar - paint an opaque background, hiding whatever
   their parent container painted underneath (this is exactly what made the
   sidebar title and footer status labels render as invisible white-on-white
   in an earlier iteration of this theme). Backgrounds are set only on
   specific containers below (#sidebar, #topBar, #contentArea, .card, form
   controls, etc.) that are actually meant to paint one. */
QWidget {{
    color: {_TEXT_PRIMARY};
    font-family: "Segoe UI", "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif;
    font-size: 13px;
    selection-background-color: {_BLUE_LIGHT_BG};
    selection-color: {_TEXT_PRIMARY};
}}

QMainWindow {{
    background-color: {_CARD_BG};
}}

/* Dialogs & message boxes are separate top-level windows, so - just like
   QMainWindow above - they need their own explicit background rather than
   inheriting one from a parent container. Without this, applying the theme
   at the QApplication level (see main_window.py's _apply_initial_theme())
   would force this theme's dark navy text color onto every dialog via the
   base QWidget rule above, while leaving the background whatever the OS's
   native/dark-mode palette happens to provide - the same "text merges into
   its own background" problem this theme exists to prevent, just from the
   opposite direction. */
QDialog, QMessageBox {{
    background-color: {_CARD_BG};
}}

/* Custom Title Bar - replaces the native OS one (see MainWindow's
   FramelessWindowHint); dark navy like a native Windows title bar rather
   than white, so it still reads as "window chrome" rather than content. */
#customTitleBar {{
    background-color: {_PRIMARY_NAVY};
    border-bottom: 1px solid {_SIDEBAR_BORDER};
}}

/* Window & Top Header Bar */
#topBar {{
    background-color: {_CARD_BG};
    border-bottom: 1px solid {_BORDER};
    padding: 8px 20px;
}}

#topBarTitle {{
    font-size: 15px;
    font-weight: 700;
    color: {_TEXT_PRIMARY};
    letter-spacing: 0.2px;
}}

#topBarStatus {{
    font-size: 12px;
    color: {_TEXT_SECONDARY};
}}

/* Sidebar Navigation */
#sidebar {{
    background-color: {_SIDEBAR_BG};
    border-right: 1px solid {_SIDEBAR_BORDER};
    min-width: 260px;
    max-width: 280px;
}}

#sidebarTitle {{
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
    padding: 20px 18px 4px 18px;
    letter-spacing: 0.2px;
}}

#sidebarSubtitle {{
    font-size: 11px;
    color: {_TEXT_MUTED};
    padding: 0 18px 18px 18px;
    border-bottom: 1px solid {_SIDEBAR_BORDER};
    font-weight: 500;
}}

/* One QPushButton per nav item hosts its own icon/title/subtitle via a child
   layout (see MainWindow._create_nav_button) rather than two separate
   widgets styled to look joined - so only the button's own background/
   border/radius need styling here; there is no second widget to keep in
   sync, and no seam between two independently-painted boxes to hide. */
#sidebarNavButton {{
    background-color: transparent;
    border: none;
    border-radius: 6px;
}}

#sidebarNavButton:hover {{
    background-color: {_SIDEBAR_HOVER_BG};
}}

#sidebarNavButton:checked {{
    background-color: {_SIDEBAR_ACTIVE_BG};
    border-left: 3px solid {_BLUE};
}}

#sidebarFooter {{
    border-top: 1px solid {_SIDEBAR_BORDER};
    padding: 14px 16px;
    background-color: {_SIDEBAR_BG};
}}

/* Content Area */
#contentArea {{
    background-color: {_APP_BG};
}}

/* Scroll Areas */
QScrollArea {{
    background: transparent;
    border: none;
}}

QScrollArea > QWidget > QWidget {{
    background: transparent;
}}

/* Scrollbars */
QScrollBar:vertical {{
    border: none;
    background-color: {_GRAY_TRACK};
    width: 10px;
    margin: 0px;
    border-radius: 5px;
}}
QScrollBar::handle:vertical {{
    background-color: {_GRAY_HANDLE};
    min-height: 28px;
    border-radius: 5px;
    margin: 1px;
}}
QScrollBar::handle:vertical:hover {{
    background-color: {_TEXT_MUTED};
}}
QScrollBar::handle:vertical:pressed {{
    background-color: {_TEXT_SECONDARY};
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    border: none;
    background: none;
    height: 0px;
}}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
    background: none;
}}

QScrollBar:horizontal {{
    border: none;
    background-color: {_GRAY_TRACK};
    height: 10px;
    margin: 0px;
    border-radius: 5px;
}}
QScrollBar::handle:horizontal {{
    background-color: {_GRAY_HANDLE};
    min-width: 28px;
    border-radius: 5px;
    margin: 1px;
}}
QScrollBar::handle:horizontal:hover {{
    background-color: {_TEXT_MUTED};
}}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    border: none;
    background: none;
    width: 0px;
}}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {{
    background: none;
}}

/* Cards and Panels - white, hairline border, restrained radius (Qt/QSS has
   no box-shadow, so the spec's "very subtle shadow" is approximated with
   just the border). */
.card, QGroupBox {{
    background-color: {_CARD_BG};
    border: 1px solid {_BORDER};
    border-radius: 10px;
    padding: 20px 16px 16px 16px;
    margin-top: 14px;
}}

QGroupBox::title {{
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 0 8px;
    color: {_TEXT_PRIMARY};
    font-weight: 700;
    font-size: 13px;
    background-color: transparent;
    border: none;
}}

/* ui/components/card.py's Card widget - title/description sit inside the
   card with normal padding, unlike QGroupBox's title which overlaps the
   top border. Padding is 0 here because Card's own layout margins already
   provide the spacing. */
QFrame#card {{
    background-color: {_CARD_BG};
    border: 1px solid {_BORDER};
    border-radius: 10px;
    padding: 0px;
}}

#cardTitle {{
    font-size: 17px;
    font-weight: 700;
    color: {_TEXT_PRIMARY};
}}

#cardDescription {{
    font-size: 12px;
    color: {_TEXT_SECONDARY};
}}

/* Metric Stats Cards */
#statCard {{
    background-color: {_CARD_BG};
    border: 1px solid {_BORDER};
    border-radius: 10px;
    padding: 14px 16px;
    min-height: 80px;
    min-width: 90px;
}}

#statCard:hover {{
    border-color: {_TEXT_MUTED};
}}

#statCardLabel {{
    font-size: 11px;
    font-weight: 700;
    color: {_TEXT_SECONDARY};
    text-transform: uppercase;
    letter-spacing: 0.6px;
}}

#statCardValue {{
    font-size: 26px;
    font-weight: 800;
    color: {_TEXT_PRIMARY};
    margin-top: 4px;
}}

/* Push Buttons */
QPushButton {{
    background-color: {_CARD_BG};
    color: {_TEXT_SECONDARY};
    border: 1px solid {_BORDER};
    border-radius: 8px;
    padding: 8px 18px;
    font-weight: 600;
    font-size: 13px;
}}

QPushButton:hover {{
    background-color: {_APP_BG};
    border-color: {_TEXT_MUTED};
    color: {_TEXT_PRIMARY};
}}

QPushButton:pressed {{
    background-color: {_GRAY_TRACK};
}}

QPushButton:disabled {{
    background-color: {_CARD_BG};
    color: {_DISABLED};
    border-color: {_BORDER};
}}

/* Primary buttons use the one accent color - blue */
QPushButton#primaryButton {{
    background-color: {_BLUE_ACTION};
    color: #ffffff;
    border: 1px solid {_BLUE_ACTION};
    font-weight: 700;
}}

QPushButton#primaryButton:hover {{
    background-color: #1558BE;
    border-color: #1558BE;
}}

QPushButton#primaryButton:pressed {{
    background-color: #12489E;
}}

QPushButton#primaryButton:disabled {{
    background-color: {_DISABLED};
    color: #ffffff;
    border-color: {_DISABLED};
}}

/* Semantic action buttons keep functional color - not decorative */
QPushButton#dangerButton {{
    background-color: {_DANGER};
    color: #ffffff;
    border: 1px solid {_DANGER};
    font-weight: 700;
}}

QPushButton#dangerButton:hover {{
    background-color: #B92419;
}}

QPushButton#dangerButton:disabled {{
    background-color: {_CARD_BG};
    color: {_DISABLED};
    border-color: {_BORDER};
}}

QPushButton#warningButton {{
    background-color: {_WARNING};
    color: #ffffff;
    border: 1px solid {_WARNING};
    font-weight: 700;
}}

QPushButton#warningButton:hover {{
    background-color: #B87500;
}}

QPushButton#warningButton:disabled {{
    background-color: {_CARD_BG};
    color: {_DISABLED};
    border-color: {_BORDER};
}}

QPushButton#successButton {{
    background-color: {_SUCCESS};
    color: #ffffff;
    border: 1px solid {_SUCCESS};
    font-weight: 700;
}}

QPushButton#successButton:hover {{
    background-color: #117F59;
}}

/* Line Edits, Combos, SpinBoxes */
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {{
    background-color: {_CARD_BG};
    color: {_TEXT_PRIMARY};
    border: 1px solid {_BORDER};
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
}}

QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus {{
    border: 1px solid {_BLUE};
    background-color: {_CARD_BG};
}}

QComboBox::drop-down {{
    subcontrol-origin: padding;
    subcontrol-position: top right;
    width: 28px;
    border-left: 1px solid {_BORDER};
}}

QComboBox QAbstractItemView {{
    background-color: {_CARD_BG};
    border: 1px solid {_BORDER};
    selection-background-color: {_BLUE_LIGHT_BG};
    selection-color: {_TEXT_PRIMARY};
    color: {_TEXT_PRIMARY};
    padding: 4px;
}}

/* Sliders */
QSlider::groove:horizontal {{
    height: 6px;
    background: {_BORDER};
    border-radius: 3px;
}}

QSlider::sub-page:horizontal {{
    background: {_BLUE};
    border-radius: 3px;
}}

QSlider::handle:horizontal {{
    background: #ffffff;
    border: 3px solid {_BLUE};
    width: 18px;
    margin-top: -6px;
    margin-bottom: -6px;
    border-radius: 9px;
}}

QSlider::handle:horizontal:hover {{
    background: {_BLUE_LIGHT_BG};
    border-color: {_BLUE_ACTION};
}}

/* Progress Bar */
QProgressBar {{
    background-color: {_GRAY_TRACK};
    border: 1px solid {_BORDER};
    border-radius: 8px;
    text-align: center;
    color: {_TEXT_PRIMARY};
    font-weight: 700;
    height: 22px;
    font-size: 12px;
}}

QProgressBar::chunk {{
    background-color: {_BLUE};
    border-radius: 7px;
}}

/* Table View */
QTableWidget, QTableView {{
    background-color: {_CARD_BG};
    alternate-background-color: {_APP_BG};
    border: 1px solid {_BORDER};
    border-radius: 8px;
    gridline-color: {_GRAY_TRACK};
    color: {_TEXT_PRIMARY};
}}

QTableWidget::item {{
    padding: 8px 12px;
    border-bottom: 1px solid {_GRAY_TRACK};
}}

QTableWidget::item:selected {{
    background-color: {_BLUE_LIGHT_BG};
    color: {_TEXT_PRIMARY};
}}

QHeaderView::section {{
    background-color: {_APP_BG};
    color: {_TEXT_SECONDARY};
    padding: 10px 12px;
    border: none;
    border-right: 1px solid {_BORDER};
    border-bottom: 2px solid {_BORDER};
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}

/* Badges / Labels - semantic colors, never decorative */
#badgeOffline {{
    background-color: {_SUCCESS_BG};
    color: {_SUCCESS};
    border: 1px solid #BFE8D9;
    border-radius: 12px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
}}

#badgeStatus {{
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 700;
}}

/* Log Console */
QPlainTextEdit#logConsole {{
    background-color: {_CARD_BG};
    color: {_TEXT_SECONDARY};
    border: 1px solid {_BORDER};
    border-radius: 8px;
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 12px;
    padding: 10px;
}}

/* Checkboxes */
QCheckBox {{
    spacing: 8px;
    color: {_TEXT_PRIMARY};
    font-size: 12px;
    font-weight: 500;
}}

QCheckBox::indicator {{
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid {_BORDER};
    background-color: {_CARD_BG};
}}

QCheckBox::indicator:hover {{
    border-color: {_BLUE};
}}

QCheckBox::indicator:checked {{
    background-color: {_BLUE};
    border-color: {_BLUE};
}}

/* Radio Buttons - a filled ring rather than Qt's small default dot */
QRadioButton {{
    spacing: 8px;
    color: {_TEXT_PRIMARY};
    font-size: 13px;
    font-weight: 500;
}}

QRadioButton::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 1.5px solid {_BORDER};
    background-color: {_CARD_BG};
}}

QRadioButton::indicator:hover {{
    border-color: {_BLUE};
}}

QRadioButton::indicator:checked {{
    border: 5px solid {_BLUE};
    background-color: {_CARD_BG};
}}

/* Tab Widget */
QTabWidget::pane {{
    border: 1px solid {_BORDER};
    border-radius: 8px;
    background-color: {_CARD_BG};
    top: -1px;
}}

QTabBar::tab {{
    background-color: {_APP_BG};
    color: {_TEXT_SECONDARY};
    border: 1px solid {_BORDER};
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    padding: 10px 20px;
    font-weight: 600;
    margin-right: 4px;
}}

QTabBar::tab:selected {{
    background-color: {_CARD_BG};
    color: {_TEXT_PRIMARY};
    border-color: {_BORDER};
    border-bottom: 2px solid {_BLUE};
}}

QTabBar::tab:hover:!selected {{
    background-color: {_BORDER};
    color: {_TEXT_PRIMARY};
}}

/* Status Bar */
QStatusBar {{
    background-color: {_CARD_BG};
    border-top: 1px solid {_BORDER};
    color: {_TEXT_SECONDARY};
    font-size: 12px;
    padding: 2px 10px;
}}
"""


def get_theme_qss(theme_name: str = "") -> str:
    """
    Return the application's single QSS stylesheet.
    `theme_name` is accepted for backward compatibility with older call
    sites but is ignored - there is only one fixed theme (see module
    docstring; Phase 6 removed the Dark/Light toggle).
    """
    return THEME_QSS
