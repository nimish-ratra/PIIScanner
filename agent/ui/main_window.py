"""
ClAIssify - Main Window Controller
Coordinates sidebar navigation, top bar (search + user profile), stacked
views (Dashboard/Scan, Results, History, Live Monitoring, Cloud Extender,
Settings), and inter-view workflows.
"""

import getpass
import socket
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QStackedWidget, QPushButton, QLabel, QFrame,
    QStatusBar, QButtonGroup, QLineEdit, QMenu, QApplication
)
from PySide6.QtCore import Qt, QSize, QEvent, QPropertyAnimation, QEasingCurve, QParallelAnimationGroup
from PySide6.QtGui import QIcon, QShortcut, QKeySequence, QTransform

from backend.config import config_manager
from backend.tika_extractor import check_java_status
from ui.theme import get_theme_qss
from ui.icons import icon as get_icon
from ui.views.scan_view import ScanView
from ui.views.results_view import ResultsView
from ui.views.history_view import HistoryView
from ui.views.live_monitoring_view import LiveMonitoringView
from ui.views.settings_view import SettingsView
from ui.views.onboarding_dialog import OnboardingDialog

_NAV_ICON_COLOR = "#AEB9C7"  # matches inactive nav text color


class MainWindow(QMainWindow):
    """Primary application frame hosting the sidebar navigation and view stack."""

    # Width (px) around the frameless window's edge that still resizes the
    # window via the OS, even though there's no native border to grab.
    _RESIZE_MARGIN = 6

    def __init__(self):
        super().__init__()
        self.setWindowTitle("ClAIssify - Classify. Govern. Protect.")
        self.resize(1600, 900)
        self.setMinimumSize(1180, 720)

        # Frameless so our own title bar (below) replaces the native one,
        # matching the reference design's dark title bar with the app's own
        # branding instead of the OS default. Known trade-off: Windows draws
        # no drop shadow or rounded corners around a frameless window, and
        # loses the Windows 11 snap-layout hover menu on the maximize button,
        # AND loses DWM's native minimize/restore animation (a frameless
        # window just vanishes/reappears instantly instead of the usual
        # genie-to-taskbar effect) - all three would need native WinAPI
        # hooks (DWM/WM_NCHITTEST) to restore natively, out of scope here.
        # The minimize/restore case is faked instead with a plain opacity
        # fade in _on_minimize_clicked()/changeEvent() below - close enough
        # to "fluid" without needing those hooks.
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint)
        self._was_minimized = False
        self.setMouseTracking(True)

        icon_path = Path(__file__).parent.parent / "packaging" / "assets" / "app_icon.png"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))

        self._init_ui()
        self._wire_signals()
        self._apply_initial_theme()
        self._check_first_run()

    def _init_ui(self) -> None:
        outer_widget = QWidget(self)
        outer_widget.setMouseTracking(True)
        self.setCentralWidget(outer_widget)

        outer_vbox = QVBoxLayout(outer_widget)
        outer_vbox.setContentsMargins(0, 0, 0, 0)
        outer_vbox.setSpacing(0)
        outer_vbox.addWidget(self._build_title_bar())

        central_widget = QWidget(outer_widget)
        central_widget.setMouseTracking(True)
        outer_vbox.addWidget(central_widget, 1)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Left Sidebar Navigation
        self._sidebar_collapsed = False
        self._sidebar_expanded_width = 270  # theme.py's #sidebar min/max-width range is 260-280px
        self._sidebar_collapsed_width = 68
        self._sidebar_nav_text_widgets: List[QWidget] = []  # hidden when collapsed, shown when expanded

        sidebar = QFrame(self)
        self.sidebar = sidebar
        sidebar.setObjectName("sidebar")
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        sidebar_layout.setSpacing(4)

        # Brand Header
        brand_row = QHBoxLayout()
        brand_row.setContentsMargins(20, 20, 20, 4)
        brand_row.setSpacing(10)

        lbl_brand_icon = QLabel(sidebar)
        brand_icon_path = Path(__file__).parent.parent / "packaging" / "assets" / "app_icon.png"
        if brand_icon_path.exists():
            lbl_brand_icon.setPixmap(
                QIcon(str(brand_icon_path)).pixmap(34, 34)
            )
        else:
            lbl_brand_icon.setPixmap(get_icon("shield", "#ffffff", 18).pixmap(18, 18))
        lbl_brand_icon.setFixedSize(34, 34)
        lbl_brand_icon.setAlignment(Qt.AlignCenter)

        brand_text_col = QVBoxLayout()
        brand_text_col.setSpacing(0)
        lbl_brand = QLabel(sidebar)
        lbl_brand.setTextFormat(Qt.RichText)
        lbl_brand.setText('Cl<span style="color:#1677FF;">AI</span>ssify')
        lbl_brand.setObjectName("sidebarTitle")
        lbl_brand.setStyleSheet("padding: 0;")
        lbl_brand_sub = QLabel(sidebar)
        lbl_brand_sub.setTextFormat(Qt.RichText)
        lbl_brand_sub.setText(
            '<span style="color:#4C9AFF;">Classify.</span> '
            '<span style="color:#2DD4BF;">Govern.</span> '
            '<span style="color:#F87171;">Protect.</span>'
        )
        lbl_brand_sub.setObjectName("sidebarSubtitle")
        lbl_brand_sub.setStyleSheet("padding: 0; border: none;")
        brand_text_col.addWidget(lbl_brand)
        brand_text_col.addWidget(lbl_brand_sub)

        brand_row.addWidget(lbl_brand_icon)
        brand_row.addLayout(brand_text_col)
        brand_row.addStretch()
        self._sidebar_nav_text_widgets.append(lbl_brand)
        self._sidebar_nav_text_widgets.append(lbl_brand_sub)

        self.btn_sidebar_toggle = QPushButton(sidebar)
        self.btn_sidebar_toggle.setFlat(True)
        self.btn_sidebar_toggle.setFixedSize(24, 24)
        self.btn_sidebar_toggle.setStyleSheet("background: transparent; border: none;")
        self.btn_sidebar_toggle.clicked.connect(self._toggle_sidebar)
        brand_row.addWidget(self.btn_sidebar_toggle)
        sidebar_layout.addLayout(brand_row)
        sidebar_layout.addSpacing(12)

        # Nav Buttons
        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)

        self.btn_nav_scan = self._create_nav_button(
            sidebar_layout, "Scan Directory", "Scan files for sensitive data", "search", 0)
        self.btn_nav_results = self._create_nav_button(
            sidebar_layout, "Results & Action", "View findings and take action", "clipboard-list", 1)
        self.btn_nav_history = self._create_nav_button(
            sidebar_layout, "Scan History", "Past scans and reports", "clock", 2)
        self.btn_nav_live = self._create_nav_button(
            sidebar_layout, "Live Monitoring", "Real-time file monitoring", "activity", 3)
        self.btn_nav_settings = self._create_nav_button(
            sidebar_layout, "Settings & Health", "Configure and system status", "settings", 4)

        sidebar_layout.addStretch()

        # Sidebar Footer
        sidebar_footer = QFrame(sidebar)
        self.sidebar_footer = sidebar_footer
        sidebar_footer.setObjectName("sidebarFooter")
        footer_layout = QVBoxLayout(sidebar_footer)
        footer_layout.setContentsMargins(14, 12, 14, 12)
        footer_layout.setSpacing(8)

        # Service status + inline start/stop control
        status_row = QHBoxLayout()
        status_row.setSpacing(6)
        self.lbl_sidebar_status_dot = QLabel(sidebar_footer)
        self.lbl_sidebar_status_dot.setFixedSize(8, 8)
        self.lbl_sidebar_status_dot.setStyleSheet("background-color: #D92D20; border-radius: 4px;")
        self.lbl_service_status = QLabel("Service: Offline", sidebar_footer)
        self.lbl_service_status.setStyleSheet("font-size: 12px; color: #D92D20; font-weight: 700;")
        status_row.addWidget(self.lbl_sidebar_status_dot)
        status_row.addWidget(self.lbl_service_status)
        status_row.addStretch()
        footer_layout.addLayout(status_row)

        lbl_status_sub = QLabel("All systems operational", sidebar_footer)
        lbl_status_sub.setStyleSheet("font-size: 10px; color: #7C8AA0; margin-left: 14px;")
        footer_layout.addWidget(lbl_status_sub)

        self.lbl_java_status = QLabel(sidebar_footer)
        self.lbl_java_status.setStyleSheet("font-size: 10px; font-weight: 500;")
        footer_layout.addWidget(self.lbl_java_status)
        self._refresh_java_status_label()

        self.btn_top_service_toggle = QPushButton("Start Service", sidebar_footer)
        self.btn_top_service_toggle.setFixedHeight(26)
        self.btn_top_service_toggle.setStyleSheet(
            "background: #15966B; color: #ffffff; border: none; border-radius: 6px; "
            "padding: 0 12px; font-weight: 700; font-size: 11px;"
        )
        self.btn_top_service_toggle.clicked.connect(self._on_top_service_toggle)
        footer_layout.addWidget(self.btn_top_service_toggle)

        version_row = QHBoxLayout()
        version_row.setSpacing(4)
        lbl_version = QLabel("v1.0.0", sidebar_footer)
        lbl_version.setStyleSheet("font-size: 10px; color: #7C8AA0;")
        btn_about = QPushButton("Privacy && Help", sidebar_footer)
        btn_about.setFlat(True)
        btn_about.setStyleSheet(
            "font-size: 10px; color: #AEB9C7; background: transparent; border: none; text-align: left; padding: 0;"
        )
        btn_about.clicked.connect(self._show_onboarding)
        version_row.addWidget(lbl_version)
        version_row.addWidget(QLabel("•", sidebar_footer))
        version_row.addWidget(btn_about)
        version_row.addStretch()
        footer_layout.addLayout(version_row)

        sidebar_layout.addWidget(sidebar_footer)
        root_layout.addWidget(sidebar)
        self._set_sidebar_collapsed_visuals(False)  # sets the toggle button's initial icon/tooltip

        # 2. Right Content Container (Top Bar + Stacked Pages)
        content_container = QWidget(self)
        content_layout = QVBoxLayout(content_container)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        # Enterprise Top Utility Bar
        top_bar = QFrame(content_container)
        top_bar.setObjectName("topBar")
        top_bar_layout = QHBoxLayout(top_bar)
        top_bar_layout.setContentsMargins(24, 8, 24, 8)
        top_bar_layout.setSpacing(16)

        top_bar.setFixedHeight(70)

        # Search box - Ctrl+K focuses it; Enter jumps to a matching nav item
        self.edit_search = QLineEdit(top_bar)
        self.edit_search.setPlaceholderText("Search settings, help or documentation...")
        self.edit_search.setFixedHeight(36)
        self.edit_search.setMaximumWidth(360)
        self.edit_search.addAction(get_icon("search", "#94A3B8", 16), QLineEdit.LeadingPosition)
        self.edit_search.returnPressed.connect(self._on_search_submitted)
        QShortcut(QKeySequence("Ctrl+K"), self, activated=lambda: (self.edit_search.setFocus(), self.edit_search.selectAll()))

        lbl_kbd_hint = QLabel("Ctrl + K", top_bar)
        lbl_kbd_hint.setStyleSheet(
            "background: #F5F7FA; color: #64748B; border: 1px solid #DCE3EC; border-radius: 5px; "
            "padding: 1px 6px; font-size: 10px; font-weight: 600;"
        )

        top_bar_layout.addWidget(self.edit_search)
        top_bar_layout.addWidget(lbl_kbd_hint)
        top_bar_layout.addStretch()

        # Three live-status chips, then the user profile block.
        self.lbl_topbar_service_dot, self.lbl_topbar_service_line1, self.lbl_topbar_service_line2 = \
            self._add_status_chip(top_bar_layout, "monitor", "Service Online", "Local Engine Active", dot=True)
        self._add_separator(top_bar_layout)
        self._add_status_chip(top_bar_layout, "shield-check", "Zero Telemetry", "All processing local", dot=True, dot_color="#15966B")
        self._add_separator(top_bar_layout)
        hostname = socket.gethostname()
        self._add_status_chip(top_bar_layout, "monitor", hostname, "Local Scanner", dot=False)

        # User profile block (this app has no login/accounts - "user" here
        # means the OS account running the scanner, shown for personalization)
        display_name = getpass.getuser().replace(".", " ").replace("_", " ").title()
        initials = "".join(w[0] for w in display_name.split()[:2]).upper() or "U"

        profile_row = QHBoxLayout()
        profile_row.setSpacing(6)
        profile_row.setContentsMargins(12, 0, 0, 0)

        lbl_avatar = QLabel(initials, top_bar)
        lbl_avatar.setFixedSize(32, 32)
        lbl_avatar.setAlignment(Qt.AlignCenter)
        lbl_avatar.setStyleSheet(
            "background-color: #1677FF; color: #ffffff; border-radius: 16px; font-weight: 700; font-size: 12px;"
        )

        self.btn_profile_menu = QPushButton(top_bar)
        self.btn_profile_menu.setIcon(get_icon("chevron-down", "#64748B", 14))
        self.btn_profile_menu.setFlat(True)
        self.btn_profile_menu.setFixedSize(24, 24)
        self.btn_profile_menu.setStyleSheet("background: transparent; border: none;")
        self.btn_profile_menu.clicked.connect(self._show_profile_menu)

        profile_row.addWidget(lbl_avatar)
        profile_row.addWidget(self.btn_profile_menu)
        top_bar_layout.addLayout(profile_row)
        content_layout.addWidget(top_bar)

        # Stacked Views
        self.stack = QStackedWidget(content_container)
        self.stack.setObjectName("contentArea")

        self.view_scan = ScanView(self)
        self.view_results = ResultsView(self)
        self.view_history = HistoryView(self)
        self.view_live = LiveMonitoringView(self)
        self.view_settings = SettingsView(self)

        self.stack.addWidget(self.view_scan)       # Index 0
        self.stack.addWidget(self.view_results)    # Index 1
        self.stack.addWidget(self.view_history)    # Index 2
        self.stack.addWidget(self.view_live)       # Index 3
        self.stack.addWidget(self.view_settings)   # Index 4

        content_layout.addWidget(self.stack, 1)
        root_layout.addWidget(content_container, 1)

        # 3. Status Bar (kept for transient messages like search results, but
        # hidden by default so no persistent footer bar takes up space)
        self.status_bar = QStatusBar(self)
        self.setStatusBar(self.status_bar)
        self.status_bar.setVisible(False)

        # Default to Scan Tab
        self.btn_nav_scan.setChecked(True)

    def _build_title_bar(self) -> QFrame:
        """Custom title bar replacing the native one (see the FramelessWindowHint
        note in __init__): app icon + wordmark, then minimize/maximize/close."""
        bar = QFrame(self)
        bar.setObjectName("customTitleBar")
        bar.setFixedHeight(36)
        bar.setMouseTracking(True)
        bar.mousePressEvent = self._title_bar_mouse_press
        bar.mouseDoubleClickEvent = lambda event: self._toggle_maximize()

        layout = QHBoxLayout(bar)
        layout.setContentsMargins(12, 0, 0, 0)
        layout.setSpacing(8)

        lbl_icon = QLabel(bar)
        icon_path = Path(__file__).parent.parent / "packaging" / "assets" / "app_icon.png"
        if icon_path.exists():
            lbl_icon.setPixmap(QIcon(str(icon_path)).pixmap(16, 16))
        else:
            lbl_icon.setPixmap(get_icon("shield", "#1677FF", 16).pixmap(16, 16))

        lbl_title = QLabel("ClAIssify — Classify. Govern. Protect.", bar)
        lbl_title.setStyleSheet("color: #C7D0DC; font-size: 12px; font-weight: 600; background: transparent;")

        layout.addWidget(lbl_icon)
        layout.addWidget(lbl_title)
        layout.addStretch()

        btn_min = self._make_title_bar_button("minus")
        btn_min.clicked.connect(self._on_minimize_clicked)

        self.btn_maximize = self._make_title_bar_button("square")
        self.btn_maximize.clicked.connect(self._toggle_maximize)

        btn_close = self._make_title_bar_button("x", is_close=True)
        btn_close.clicked.connect(self.close)

        layout.addWidget(btn_min)
        layout.addWidget(self.btn_maximize)
        layout.addWidget(btn_close)
        return bar

    def _make_title_bar_button(self, icon_name: str, is_close: bool = False) -> QPushButton:
        btn = QPushButton(self)
        btn.setIcon(get_icon(icon_name, "#C7D0DC", 12))
        btn.setIconSize(QSize(12, 12))
        btn.setFixedSize(46, 36)
        btn.setFlat(True)
        hover_bg = "#D92D20" if is_close else "#1C2C42"
        btn.setStyleSheet(
            "QPushButton { background: transparent; border: none; border-radius: 0px; }"
            f"QPushButton:hover {{ background-color: {hover_bg}; }}"
        )
        return btn

    def _title_bar_mouse_press(self, event) -> None:
        if event.button() == Qt.LeftButton:
            handle = self.windowHandle()
            if handle is not None:
                handle.startSystemMove()

    def _on_minimize_clicked(self) -> None:
        """Fade out, then actually minimize once invisible - see the frameless-
        window comment in __init__ for why this exists instead of just calling
        showMinimized() directly (which is instant/abrupt on a frameless window)."""
        self._minimize_anim = QPropertyAnimation(self, b"windowOpacity", self)
        self._minimize_anim.setDuration(180)
        self._minimize_anim.setStartValue(1.0)
        self._minimize_anim.setEndValue(0.0)
        self._minimize_anim.setEasingCurve(QEasingCurve.InCubic)
        self._minimize_anim.finished.connect(self._finish_minimize)
        self._minimize_anim.start()

    def _finish_minimize(self) -> None:
        self.showMinimized()
        self.setWindowOpacity(1.0)  # already hidden in the taskbar - reset so it's not invisible on restore

    def changeEvent(self, event) -> None:
        super().changeEvent(event)
        if event.type() == QEvent.WindowStateChange:
            if self._was_minimized and not self.isMinimized():
                self._animate_restore()
            self._was_minimized = self.isMinimized()

    def _animate_restore(self) -> None:
        self.setWindowOpacity(0.0)
        self._restore_anim = QPropertyAnimation(self, b"windowOpacity", self)
        self._restore_anim.setDuration(180)
        self._restore_anim.setStartValue(0.0)
        self._restore_anim.setEndValue(1.0)
        self._restore_anim.setEasingCurve(QEasingCurve.OutCubic)
        self._restore_anim.start()

    def _toggle_maximize(self) -> None:
        if self.isMaximized():
            self.showNormal()
        else:
            self.showMaximized()

    def _edge_at(self, pos) -> Qt.Edges:
        """Which window edge(s) a point sits within the resize margin of, for
        a frameless window (which has no native border to grab for resizing)."""
        if self.isMaximized():
            return Qt.Edges()
        m = self._RESIZE_MARGIN
        rect = self.rect()
        edges = Qt.Edges()
        if pos.x() <= m:
            edges |= Qt.Edge.LeftEdge
        if pos.x() >= rect.width() - m:
            edges |= Qt.Edge.RightEdge
        if pos.y() <= m:
            edges |= Qt.Edge.TopEdge
        if pos.y() >= rect.height() - m:
            edges |= Qt.Edge.BottomEdge
        return edges

    _EDGE_CURSORS = {
        frozenset({Qt.Edge.TopEdge}): Qt.SizeVerCursor,
        frozenset({Qt.Edge.BottomEdge}): Qt.SizeVerCursor,
        frozenset({Qt.Edge.LeftEdge}): Qt.SizeHorCursor,
        frozenset({Qt.Edge.RightEdge}): Qt.SizeHorCursor,
        frozenset({Qt.Edge.TopEdge, Qt.Edge.LeftEdge}): Qt.SizeFDiagCursor,
        frozenset({Qt.Edge.BottomEdge, Qt.Edge.RightEdge}): Qt.SizeFDiagCursor,
        frozenset({Qt.Edge.TopEdge, Qt.Edge.RightEdge}): Qt.SizeBDiagCursor,
        frozenset({Qt.Edge.BottomEdge, Qt.Edge.LeftEdge}): Qt.SizeBDiagCursor,
    }

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            edges = self._edge_at(event.position().toPoint())
            handle = self.windowHandle()
            if edges and handle is not None:
                handle.startSystemResize(edges)
                return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        edges = self._edge_at(event.position().toPoint())
        cursor = self._EDGE_CURSORS.get(frozenset(e for e in (Qt.Edge.TopEdge, Qt.Edge.BottomEdge, Qt.Edge.LeftEdge, Qt.Edge.RightEdge) if edges & e))
        self.setCursor(cursor if cursor else Qt.ArrowCursor)
        super().mouseMoveEvent(event)

    def _create_nav_button(self, sidebar_layout: QVBoxLayout, text: str, subtitle: str, icon_name: str, index: int) -> QPushButton:
        """One QPushButton whose title+subtitle are drawn by child labels in
        its own internal layout - not two separate widgets styled to look
        connected. Two adjacent bordered boxes always show a seam somewhere
        (anti-aliasing, sub-pixel rounding); one widget painting its own
        single background/border underneath its own content cannot."""
        btn = QPushButton(self)
        btn.setObjectName("sidebarNavButton")
        btn.setCheckable(True)
        btn.clicked.connect(lambda: self._switch_tab(index))
        self.nav_group.addButton(btn, index)

        btn_vbox = QVBoxLayout(btn)
        btn_vbox.setContentsMargins(18, 10, 18, 10)
        btn_vbox.setSpacing(3)

        title_row = QHBoxLayout()
        title_row.setSpacing(10)

        lbl_icon = QLabel(btn)
        lbl_icon.setFixedSize(18, 18)
        lbl_icon.setAttribute(Qt.WA_TransparentForMouseEvents)
        title_row.addWidget(lbl_icon)

        lbl_title = QLabel(text, btn)
        lbl_title.setObjectName("sidebarNavButtonTitle")
        lbl_title.setAttribute(Qt.WA_TransparentForMouseEvents)
        title_row.addWidget(lbl_title)
        title_row.addStretch()
        btn_vbox.addLayout(title_row)

        lbl_subtitle = QLabel(subtitle, btn)
        lbl_subtitle.setObjectName("sidebarNavButtonSubtitle")
        lbl_subtitle.setAttribute(Qt.WA_TransparentForMouseEvents)
        lbl_subtitle.setContentsMargins(28, 0, 0, 0)  # align under the title text, past the icon
        btn_vbox.addWidget(lbl_subtitle)
        self._sidebar_nav_text_widgets.append(lbl_title)
        self._sidebar_nav_text_widgets.append(lbl_subtitle)

        # Qt Style Sheets' `margin` property doesn't reliably inset a widget
        # within its layout cell once that widget hosts its own child layout
        # (as this button now does) - confirmed by checking btn.geometry().x()
        # after the QSS `margin: 2px 12px` was still 0, not 12. A plain
        # QHBoxLayout with real contentsMargins is the reliable way to get
        # the same 12px left/right inset from the sidebar's edges.
        row = QHBoxLayout()
        row.setContentsMargins(12, 2, 12, 2)
        row.addWidget(btn)
        sidebar_layout.addLayout(row)

        btn.toggled.connect(lambda checked, li=lbl_icon, lt=lbl_title, ls=lbl_subtitle, ic=icon_name: self._on_nav_toggled(checked, li, lt, ls, ic))
        self._on_nav_toggled(False, lbl_icon, lbl_title, lbl_subtitle, icon_name)

        # QPushButton overrides sizeHint()/minimumSizeHint() based on its own
        # native text/icon (both unused here - content is drawn entirely by
        # btn_vbox's child labels instead), so it does NOT derive its size
        # from the installed child layout the way a plain QWidget would. Left
        # alone, the sidebar's layout allocates the button only that tiny
        # native sizeHint, squeezing btn_vbox's rows down to a few px each -
        # a QLabel doesn't scale its pixmap to a shrunk box, so only the top
        # sliver of each 18x18 icon (and of the title/subtitle text) actually
        # painted, looking like a garbled fragment instead of the full icon.
        # Explicitly sizing the button from its own layout's real sizeHint
        # (now that all child labels have their final content) fixes this.
        btn.setMinimumHeight(btn_vbox.sizeHint().height())
        return btn

    def _on_nav_toggled(self, checked: bool, lbl_icon: QLabel, lbl_title: QLabel, lbl_subtitle: QLabel, icon_name: str) -> None:
        icon_color = "#ffffff" if checked else _NAV_ICON_COLOR
        lbl_icon.setPixmap(get_icon(icon_name, icon_color, 18).pixmap(18, 18))
        lbl_title.setStyleSheet(
            f"background: transparent; font-size: 13px; font-weight: 700; color: {'#ffffff' if checked else '#AEB9C7'};"
        )
        lbl_subtitle.setStyleSheet(
            f"background: transparent; font-size: 10px; font-weight: 500; color: {'#C7D9F5' if checked else '#7C8AA0'};"
        )

    def _toggle_sidebar(self) -> None:
        self._sidebar_collapsed = not self._sidebar_collapsed
        target_width = self._sidebar_collapsed_width if self._sidebar_collapsed else self._sidebar_expanded_width
        current_width = self.sidebar.width()

        # Two widths (min and max) both drive a QFrame's actual layout width
        # in Qt, and theme.py's stylesheet sets both via #sidebar's min/max-
        # width - animating just one leaves the other pinned by the QSS
        # value, either capping the expand or refusing the collapse. Direct
        # setMinimumWidth/setMaximumWidth calls override the stylesheet's
        # values going forward, as long as nothing re-applies a stylesheet
        # to this widget afterward.
        anim_min = QPropertyAnimation(self.sidebar, b"minimumWidth", self)
        anim_min.setDuration(220)
        anim_min.setStartValue(current_width)
        anim_min.setEndValue(target_width)
        anim_min.setEasingCurve(QEasingCurve.InOutCubic)

        anim_max = QPropertyAnimation(self.sidebar, b"maximumWidth", self)
        anim_max.setDuration(220)
        anim_max.setStartValue(current_width)
        anim_max.setEndValue(target_width)
        anim_max.setEasingCurve(QEasingCurve.InOutCubic)

        self._sidebar_anim_group = QParallelAnimationGroup(self)
        self._sidebar_anim_group.addAnimation(anim_min)
        self._sidebar_anim_group.addAnimation(anim_max)
        self._sidebar_anim_group.start()

        self._set_sidebar_collapsed_visuals(self._sidebar_collapsed)

    def _set_sidebar_collapsed_visuals(self, collapsed: bool) -> None:
        for widget in self._sidebar_nav_text_widgets:
            widget.setVisible(not collapsed)
        # The footer (service status, Java status, version/help row) has no
        # icon-only equivalent worth building yet - hidden wholesale rather
        # than half-rendering truncated text in a 68px rail.
        self.sidebar_footer.setVisible(not collapsed)

        icon = get_icon("chevron-right", _NAV_ICON_COLOR, 14).pixmap(14, 14)
        if not collapsed:
            icon = icon.transformed(QTransform().scale(-1, 1))
        self.btn_sidebar_toggle.setIcon(QIcon(icon))
        self.btn_sidebar_toggle.setToolTip("Expand sidebar" if collapsed else "Collapse sidebar")

    def _add_status_chip(self, layout, icon_name: str, line1: str, line2: str, dot: bool = True, dot_color: str = "#15966B"):
        """Add a small icon-or-dot + two-line status chip to the top bar. Returns (dot_label, line1_label, line2_label)."""
        row = QHBoxLayout()
        row.setSpacing(6)

        dot_label = None
        if dot:
            dot_label = QLabel(self)
            dot_label.setFixedSize(8, 8)
            dot_label.setStyleSheet(f"background-color: {dot_color}; border-radius: 4px;")
            row.addWidget(dot_label, 0, Qt.AlignVCenter)
        else:
            icon_label = QLabel(self)
            icon_label.setPixmap(get_icon(icon_name, "#64748B", 16).pixmap(16, 16))
            row.addWidget(icon_label, 0, Qt.AlignVCenter)

        text_col = QVBoxLayout()
        text_col.setSpacing(0)
        line1_label = QLabel(line1, self)
        line1_label.setStyleSheet("font-size: 12px; font-weight: 700; color: #152238;")
        line2_label = QLabel(line2, self)
        line2_label.setStyleSheet("font-size: 10px; color: #64748B;")
        text_col.addWidget(line1_label)
        text_col.addWidget(line2_label)
        row.addLayout(text_col)

        layout.addLayout(row)
        return dot_label, line1_label, line2_label

    def _add_separator(self, layout) -> None:
        sep = QFrame(self)
        sep.setFixedWidth(1)
        sep.setFixedHeight(28)
        sep.setStyleSheet("background-color: #DCE3EC;")
        layout.addWidget(sep)

    def _switch_tab(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        if index == 2:
            self.view_history.refresh_history()
        elif index == 3:
            self.view_live.poll_timer.setInterval(2500)
            self.view_live.refresh_events()
        else:
            # Relax polling to 6000ms when user is working on Scan, Results, or Settings
            self.view_live.poll_timer.setInterval(6000)

    def _wire_signals(self) -> None:
        # When scan completes, feed results into ResultsView and switch to Results tab
        self.view_scan.scan_completed_signal.connect(self._on_scan_completed)

        # When a historical scan is selected, load into ResultsView and switch tab
        self.view_history.load_scan_signal.connect(self._on_load_history_scan)

        # Live monitoring status updates sidebar footer indicator
        self.view_live.status_changed_signal.connect(self._on_live_status_changed)
        self._on_live_status_changed(self.view_live.is_active())

    def _on_live_status_changed(self, is_active: bool) -> None:
        self.view_scan._update_service_badge(is_active)
        if is_active:
            self.lbl_service_status.setText("Service: Online")
            self.lbl_service_status.setStyleSheet("font-size: 12px; color: #15966B; font-weight: 700;")
            self.btn_top_service_toggle.setText("Stop Service")
            self.btn_top_service_toggle.setStyleSheet(
                "background: #D92D20; color: #ffffff; border: none; border-radius: 6px; "
                "padding: 0 12px; font-weight: 700; font-size: 11px;"
            )
            self.lbl_topbar_service_dot.setStyleSheet("background-color: #15966B; border-radius: 4px;")
            self.lbl_topbar_service_line1.setText("Service Online")
            self.lbl_topbar_service_line2.setText("Local Engine Active")
            self.lbl_sidebar_status_dot.setStyleSheet("background-color: #15966B; border-radius: 4px;")
        else:
            self.lbl_service_status.setText("Service: Offline")
            self.lbl_service_status.setStyleSheet("font-size: 12px; color: #D92D20; font-weight: 700;")
            self.btn_top_service_toggle.setText("Start Service")
            self.btn_top_service_toggle.setStyleSheet(
                "background: #15966B; color: #ffffff; border: none; border-radius: 6px; "
                "padding: 0 12px; font-weight: 700; font-size: 11px;"
            )
            self.lbl_topbar_service_dot.setStyleSheet("background-color: #D92D20; border-radius: 4px;")
            self.lbl_topbar_service_line1.setText("Service Offline")
            self.lbl_topbar_service_line2.setText("Local Engine Inactive")
            self.lbl_sidebar_status_dot.setStyleSheet("background-color: #D92D20; border-radius: 4px;")

    def _refresh_java_status_label(self) -> None:
        java_status = check_java_status()
        if java_status.get("available"):
            self.lbl_java_status.setText("JVM Connected")
            self.lbl_java_status.setStyleSheet("font-size: 10px; color: #15966B; font-weight: 600;")
        else:
            self.lbl_java_status.setText("Java Missing")
            self.lbl_java_status.setStyleSheet("font-size: 10px; color: #D92D20; font-weight: 600;")

    def _on_top_service_toggle(self) -> None:
        """Start/stop the enforcement microservice from the sidebar footer."""
        from service.enforcement_policy import policy_manager
        from service.service_controller import ServiceController

        is_running = ServiceController.is_running(policy_manager.api_port)
        self.btn_top_service_toggle.setEnabled(False)
        if is_running:
            self.lbl_service_status.setText("Service: Stopping...")
            ServiceController.stop(policy_manager.api_port)
        else:
            self.lbl_service_status.setText("Service: Starting...")
            ServiceController.start(policy_manager.api_port)
        self.btn_top_service_toggle.setEnabled(True)
        self.view_live._check_service_status()

    def _on_search_submitted(self) -> None:
        """Basic keyword router: jump to the nav tab whose name matches the query."""
        query = self.edit_search.text().strip().lower()
        if not query:
            return
        routes = [
            (("dashboard", "scan", "directory", "audit"), 0),
            (("result", "action", "finding"), 1),
            (("history",), 2),
            (("live", "monitor", "saveguard"), 3),
            (("setting", "health", "config", "diagnostic"), 4),
        ]
        for keywords, index in routes:
            if any(kw in query for kw in keywords):
                self.nav_group.button(index).setChecked(True)
                self._switch_tab(index)
                self.edit_search.clear()
                return
        self.status_bar.showMessage(f"No match for '{query}' - try a page name like 'settings' or 'scan'.", 4000)

    def _show_profile_menu(self) -> None:
        menu = QMenu(self)
        act_settings = menu.addAction(get_icon("settings", "#18181b", 14), "Settings")
        act_privacy = menu.addAction(get_icon("shield-check", "#18181b", 14), "Privacy && Help")
        chosen = menu.exec(self.btn_profile_menu.mapToGlobal(self.btn_profile_menu.rect().bottomRight()))
        if chosen == act_settings:
            self.nav_group.button(4).setChecked(True)
            self._switch_tab(4)
        elif chosen == act_privacy:
            self._show_onboarding()

    def _on_scan_completed(self, summary: Dict[str, Any]) -> None:
        findings = self.view_scan.worker.scanner.findings if self.view_scan.worker and self.view_scan.worker.scanner else []
        self.view_results.set_scan_results(summary, findings)
        self.view_history.refresh_history()
        self.status_bar.showMessage(
            f"Scan Complete: {summary.get('files_with_pii', 0)} files flagged with PII ({summary.get('total_findings', 0)} findings)."
        )
        # Switch to results tab so the user can immediately review findings
        self.btn_nav_results.setChecked(True)
        self.stack.setCurrentIndex(1)

    def _on_load_history_scan(self, scan_meta: Dict[str, Any], findings: List[Dict[str, Any]]) -> None:
        self.view_results.set_scan_results(scan_meta, findings)
        self.btn_nav_results.setChecked(True)
        self.stack.setCurrentIndex(1)
        self.status_bar.showMessage(f"Loaded past scan from {scan_meta.get('started_at')}")

    def _apply_initial_theme(self) -> None:
        # QApplication-level, not self.setStyleSheet() - a stylesheet
        # scoped to MainWindow only cascades to MainWindow's own
        # descendants. QMessageBox and every QDialog (onboarding,
        # activation, license gate, watermark review, PII selector, etc.)
        # are separate top-level windows even when given a parent for
        # modality, so they never inherited this app's theme at all -
        # falling back entirely to the OS's native/dark-mode Qt palette,
        # which is what caused popup text to visually merge into its own
        # background on a dark-mode Windows install. Applying the same
        # stylesheet at the QApplication level makes every top-level
        # window in the app - dialogs included - use this one consistent
        # theme instead of whatever the OS happens to be in.
        QApplication.instance().setStyleSheet(get_theme_qss())

    def _check_first_run(self) -> None:
        if not config_manager.first_run_complete:
            # Show onboarding modal dialog
            self._show_onboarding()

    def _show_onboarding(self) -> None:
        dlg = OnboardingDialog(self)
        dlg.exec()

    def closeEvent(self, event) -> None:
        """Cleanly terminate any running UI workers upon application exit."""
        try:
            if hasattr(self, "view_live") and self.view_live:
                if hasattr(self.view_live, "poll_timer") and self.view_live.poll_timer:
                    self.view_live.poll_timer.stop()
                if getattr(self.view_live, "_status_worker", None) and self.view_live._status_worker.isRunning():
                    self.view_live._status_worker.wait(500)
            if hasattr(self, "view_scan") and self.view_scan:
                if getattr(self.view_scan, "_preview_worker", None) and self.view_scan._preview_worker.isRunning():
                    self.view_scan._preview_worker.cancel()
                    self.view_scan._preview_worker.wait(500)
        except Exception:
            pass
        super().closeEvent(event)
