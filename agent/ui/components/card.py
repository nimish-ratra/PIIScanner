"""
Card Component
A proper card container matching the TrustFabric licensing portal's Card/
CardHeader/CardTitle/CardDescription pattern: title and description sit
inside the card body with normal padding, unlike QGroupBox's native title
(which is drawn overlapping the top border like an old-fashioned fieldset
legend, and is what made earlier cards look cramped against their own edge).
"""

from typing import Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QVBoxLayout, QHBoxLayout, QLabel, QWidget

from ui.icons import icon as get_icon


class Card(QFrame):
    """A titled content card. Add content to `.body_layout`, not to the card itself."""

    def __init__(
        self,
        title: str,
        description: str = "",
        parent=None,
        header_widget: Optional[QWidget] = None,
        step_number: Optional[int] = None,
        icon_name: Optional[str] = None,
    ):
        super().__init__(parent)
        self.setObjectName("card")

        outer = QVBoxLayout(self)
        outer.setContentsMargins(20, 18, 20, 20)
        outer.setSpacing(14)

        self.title_label = QLabel(title, self)
        self.title_label.setObjectName("cardTitle")

        if step_number is not None or icon_name is not None or header_widget is not None:
            title_row = QHBoxLayout()
            title_row.setSpacing(10)
            if step_number is not None:
                badge = QLabel(str(step_number), self)
                badge.setFixedSize(24, 24)
                badge.setAlignment(Qt.AlignCenter)
                badge.setStyleSheet(
                    "background-color: #1677FF; color: #ffffff; border-radius: 12px; "
                    "font-weight: 700; font-size: 12px;"
                )
                title_row.addWidget(badge)
            elif icon_name is not None:
                badge = QLabel(self)
                badge.setFixedSize(28, 28)
                badge.setAlignment(Qt.AlignCenter)
                badge.setStyleSheet("background-color: #1677FF; border-radius: 14px;")
                badge.setPixmap(get_icon(icon_name, "#ffffff", 16).pixmap(16, 16))
                title_row.addWidget(badge)
            title_row.addWidget(self.title_label)
            title_row.addStretch()
            if header_widget is not None:
                title_row.addWidget(header_widget)
            outer.addLayout(title_row)
        else:
            outer.addWidget(self.title_label)

        self.description_label: Optional[QLabel] = None
        if description:
            self.description_label = QLabel(description, self)
            self.description_label.setObjectName("cardDescription")
            self.description_label.setWordWrap(True)
            outer.addWidget(self.description_label)

        body = QVBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(10)
        outer.addLayout(body)

        # Without this, Qt distributes any leftover vertical space (e.g. when
        # a sibling card in the same row is taller) evenly between the title,
        # description, and body instead of collapsing it below the content -
        # that's what produced the large gaps seen between them.
        outer.addStretch()

        self.body_layout = body
