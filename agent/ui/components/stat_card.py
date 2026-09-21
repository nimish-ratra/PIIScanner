"""
Metric Stat Card Component
A clean, elevated enterprise KPI card displaying a key metric with a label, value,
and accent styling that never collapses or squishes.
"""

from PySide6.QtWidgets import QFrame, QVBoxLayout, QHBoxLayout, QLabel
from PySide6.QtCore import Qt

from ui.icons import icon as get_icon


class StatCard(QFrame):
    """Reusable enterprise KPI / Stat display card."""

    def __init__(
        self,
        title: str,
        initial_value: str = "0",
        accent_color: str = "#38bdf8",
        icon: str = "bar-chart-3",
        parent=None
    ):
        super().__init__(parent)
        self.setObjectName("statCard")
        self.accent_color = accent_color
        self.icon = icon

        # Prevent layout compression from ever flattening this card. Width
        # is intentionally modest - five of these sit in one row inside a
        # column that's now only ~60-70% of the page width (see scan_view.py's
        # two-column dashboard layout), so a large per-card minimum forces
        # the whole page wider than its viewport and triggers unwanted
        # horizontal scrolling.
        self.setMinimumHeight(82)
        self.setMinimumWidth(96)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(6)
        layout.setAlignment(Qt.AlignVCenter)

        # Header Row: Icon + Title
        header_row = QHBoxLayout()
        header_row.setSpacing(6)
        header_row.setContentsMargins(0, 0, 0, 0)

        self.label_icon = QLabel(self)
        self.label_icon.setPixmap(get_icon(icon, accent_color, 15).pixmap(15, 15))

        self.label_title = QLabel(title.upper(), self)
        self.label_title.setObjectName("statCardLabel")
        # Without word-wrap, an unbroken label like "FILES WITH PII" sets a
        # hard minimum width equal to its own full text - Qt then refuses to
        # compress the card below that no matter how little room five of
        # them have side by side, which is what forced the whole page wider
        # than its viewport and triggered horizontal scrolling.
        self.label_title.setWordWrap(True)

        header_row.addWidget(self.label_icon)
        header_row.addWidget(self.label_title)
        header_row.addStretch()

        # Value Row: Bold KPI Number
        self.label_value = QLabel(str(initial_value), self)
        self.label_value.setObjectName("statCardValue")
        self.label_value.setStyleSheet(
            f"color: {accent_color}; font-size: 26px; font-weight: 800; line-height: 1;"
        )

        layout.addLayout(header_row)
        layout.addWidget(self.label_value)

    def set_value(self, val: str) -> None:
        """Update the displayed metric value."""
        self.label_value.setText(str(val))

    def set_accent_color(self, color: str) -> None:
        """Update the accent color."""
        self.accent_color = color
        self.label_value.setStyleSheet(
            f"color: {color}; font-size: 26px; font-weight: 800; line-height: 1;"
        )
        self.label_icon.setPixmap(get_icon(self.icon, color, 15).pixmap(15, 15))

    def get_value(self) -> str:
        return self.label_value.text()
