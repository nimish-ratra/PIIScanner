"""
Metric Stat Card Component
A clean, elevated enterprise KPI card displaying a key metric with a label, value,
and accent styling that never collapses or squishes.
"""

from PySide6.QtWidgets import QFrame, QVBoxLayout, QHBoxLayout, QLabel
from PySide6.QtCore import Qt


class StatCard(QFrame):
    """Reusable enterprise KPI / Stat display card."""

    def __init__(
        self,
        title: str,
        initial_value: str = "0",
        accent_color: str = "#38bdf8",
        icon: str = "📊",
        parent=None
    ):
        super().__init__(parent)
        self.setObjectName("statCard")
        self.accent_color = accent_color
        self.icon = icon

        # Prevent layout compression from ever flattening this card
        self.setMinimumHeight(82)
        self.setMinimumWidth(130)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(6)
        layout.setAlignment(Qt.AlignVCenter)

        # Header Row: Icon + Title
        header_row = QHBoxLayout()
        header_row.setSpacing(6)
        header_row.setContentsMargins(0, 0, 0, 0)

        self.label_icon = QLabel(icon, self)
        self.label_icon.setStyleSheet("font-size: 13px;")

        self.label_title = QLabel(title.upper(), self)
        self.label_title.setObjectName("statCardLabel")

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

    def get_value(self) -> str:
        return self.label_value.text()
