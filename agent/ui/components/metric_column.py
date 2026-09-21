"""
Metric Column Component
A plain label-over-value pair with no box, icon, or accent color - for a
compact horizontal row of live scan telemetry, as distinct from StatCard's
boxed KPI tiles used on the dashboard itself.
"""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel


class MetricColumn(QWidget):
    """A small `.set_value()`/`.get_value()` metric display - the same
    public API as StatCard, so it drops into the same call sites."""

    def __init__(self, title: str, initial_value: str = "0", parent=None):
        super().__init__(parent)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(3)

        self.label_title = QLabel(title.upper(), self)
        self.label_title.setStyleSheet(
            "color: #64748B; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; background: transparent;"
        )
        layout.addWidget(self.label_title)

        self.label_value = QLabel(str(initial_value), self)
        self.label_value.setStyleSheet(
            "color: #152238; font-size: 13px; font-weight: 700; background: transparent;"
        )
        self.label_value.setToolTip(str(initial_value))
        layout.addWidget(self.label_value)

    def set_value(self, val: str) -> None:
        self.label_value.setText(str(val))
        self.label_value.setToolTip(str(val))

    def get_value(self) -> str:
        return self.label_value.text()
