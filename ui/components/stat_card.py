"""
Metric Stat Card Component
A clean, elevated card displaying a key metric with a label, value, and accent border.
"""

from PySide6.QtWidgets import QFrame, QVBoxLayout, QLabel
from PySide6.QtCore import Qt


class StatCard(QFrame):
    """Reusable KPI / Stat display card."""

    def __init__(self, title: str, initial_value: str = "0", accent_color: str = "#60a5fa", parent=None):
        super().__init__(parent)
        self.setObjectName("statCard")
        self.accent_color = accent_color

        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(4)

        self.label_title = QLabel(title.upper(), self)
        self.label_title.setObjectName("statCardLabel")

        self.label_value = QLabel(initial_value, self)
        self.label_value.setObjectName("statCardValue")
        self.label_value.setStyleSheet(f"color: {accent_color}; font-size: 26px; font-weight: 800;")

        layout.addWidget(self.label_title)
        layout.addWidget(self.label_value)

    def set_value(self, val: str) -> None:
        """Update the displayed metric value."""
        self.label_value.setText(str(val))

    def get_value(self) -> str:
        return self.label_value.text()
