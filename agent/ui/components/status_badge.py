"""
StatusBadge - a small pill-shaped icon + text status indicator.

The standard replacement for the colored-dot/emoji status pills used
throughout the app before the Lucide icon sweep (e.g. "Service Healthy",
"REAL-TIME PROTECTION ACTIVE", "Service Online"/"Offline"). set_state() swaps
icon, text color, pill background, and pill border together in one call,
mirroring how the old code swapped one emoji-prefixed string.
"""

from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel

from ui.icons import icon as get_icon, dot_pixmap


class StatusBadge(QFrame):
    def __init__(
        self,
        icon_name: str = "circle",
        color: str = "#64748B",
        text: str = "",
        bg_color: str = None,
        border_color: str = None,
        size: int = 13,
        parent=None,
    ):
        super().__init__(parent)
        self.setObjectName("statusBadge")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 3, 10, 3)
        layout.setSpacing(5)

        self._icon_size = size
        self.lbl_icon = QLabel(self)
        self.lbl_icon.setFixedSize(size, size)
        self.lbl_icon.setStyleSheet("background: transparent; border: none;")
        self.lbl_text = QLabel(self)

        layout.addWidget(self.lbl_icon)
        layout.addWidget(self.lbl_text)

        self.set_state(icon_name, color, text, bg_color, border_color)

    def set_state(
        self,
        icon_name: str,
        color: str,
        text: str = None,
        bg_color: str = None,
        border_color: str = None,
    ) -> None:
        if icon_name == "dot":
            self.lbl_icon.setPixmap(dot_pixmap(color, self._icon_size))
        else:
            self.lbl_icon.setPixmap(get_icon(icon_name, color, self._icon_size).pixmap(self._icon_size, self._icon_size))
        if text is not None:
            self.lbl_text.setText(text)
        self.lbl_text.setStyleSheet(
            f"color: {color}; background: transparent; border: none; font-size: 11px; font-weight: 700;"
        )
        bg = bg_color or "transparent"
        border = f"1px solid {border_color}" if border_color else "none"
        # Scoped to the #statusBadge id, not a bare "QFrame" type selector -
        # QLabel is itself a QFrame subclass, so a generic type selector set
        # here would cascade down and draw a second border/background
        # tightly around lbl_icon/lbl_text too, not just this outer pill.
        self.setStyleSheet(f"QFrame#statusBadge {{ background-color: {bg}; border: {border}; border-radius: 12px; }}")

    def setText(self, text: str) -> None:
        self.lbl_text.setText(text)

    def text(self) -> str:
        return self.lbl_text.text()
