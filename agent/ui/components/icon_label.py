"""
IconTextLabel - a small icon + text row.

The standard replacement for the emoji-prefixed QLabels used throughout the
app before the Lucide icon sweep (e.g. "Service Healthy", "Degraded
Status", "Service Offline"). Exposes set_state() so a dynamic status label
can swap its icon, color, and text together in one call, the same way the
old code swapped one emoji-prefixed string.
"""

from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel

from ui.icons import icon as get_icon, ICON_SIZE


class IconTextLabel(QWidget):
    def __init__(
        self,
        icon_name: str = "circle",
        color: str = "#64748B",
        text: str = "",
        size: int = ICON_SIZE,
        parent=None,
    ):
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        self._icon_size = size
        self.lbl_icon = QLabel(self)
        self.lbl_icon.setFixedSize(size, size)
        self.lbl_text = QLabel(self)

        layout.addWidget(self.lbl_icon)
        layout.addWidget(self.lbl_text)
        layout.addStretch()

        self.set_state(icon_name, color, text)

    def set_state(self, icon_name: str, color: str, text: str = None) -> None:
        self.lbl_icon.setPixmap(get_icon(icon_name, color, self._icon_size).pixmap(self._icon_size, self._icon_size))
        if text is not None:
            self.lbl_text.setText(text)
        self.lbl_text.setStyleSheet(f"color: {color}; background: transparent;")

    def text(self) -> str:
        return self.lbl_text.text()

    def setText(self, text: str) -> None:
        self.lbl_text.setText(text)
