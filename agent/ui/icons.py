"""
Icon Loader for CLAISSIFY
Renders Lucide icons (packaging/assets/icons/*.svg, MIT/ISC licensed, the same
icon set the TrustFabric licensing portals use via lucide-react) at any color
and size, replacing the emoji used throughout the UI before Phase 6.

Lucide's raw SVGs use stroke="currentColor", which only resolves inside a
browser's CSS cascade - there is no equivalent in Qt, so it's replaced with
an explicit hex color string before rendering.
"""

import sys
from functools import lru_cache
from pathlib import Path

from PySide6.QtCore import QByteArray, QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap
from PySide6.QtSvg import QSvgRenderer

_ICONS_DIR = Path(__file__).parent.parent / "packaging" / "assets" / "icons"
if not _ICONS_DIR.exists() and getattr(sys, "frozen", False):
    _base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent / "_internal"))
    if (_base / "packaging" / "assets" / "icons").exists():
        _ICONS_DIR = _base / "packaging" / "assets" / "icons"
    elif (Path(sys.executable).parent / "packaging" / "assets" / "icons").exists():
        _ICONS_DIR = Path(sys.executable).parent / "packaging" / "assets" / "icons"

# Standard icon size/stroke/color convention for the whole app - every call
# site should pick from these rather than inventing its own hex string, so
# the same semantic state always reads the same color everywhere.
ICON_SIZE = 18
COLOR_DEFAULT = "#64748B"   # navy/gray - default, inactive, secondary icons
COLOR_ACTIVE = "#1677FF"    # blue - active/primary/selected state
COLOR_SUCCESS = "#15966B"   # green - success/security/healthy state
COLOR_DANGER = "#D92D20"    # red - errors/danger only
COLOR_WARNING = "#D98A00"   # amber - warnings/degraded (distinct from danger)


@lru_cache(maxsize=512)
def _colored_pixmap(name: str, color: str, size: int) -> QPixmap:
    svg_path = _ICONS_DIR / f"{name}.svg"
    raw = svg_path.read_text(encoding="utf-8")
    colored = raw.replace("currentColor", color)

    renderer = QSvgRenderer(QByteArray(colored.encode("utf-8")))
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    # Lucide's SVGs use a 24x24 viewBox. render(painter) with no target rect
    # draws in the SVG's own 24x24 coordinate space instead of scaling to the
    # pixmap, so at any size below 24px it silently clips to the top-left
    # corner - producing a partial fragment of the icon instead of the whole
    # icon shrunk down. Passing an explicit target rect makes it scale.
    renderer.render(painter, QRectF(0, 0, size, size))
    painter.end()
    return pixmap


def icon(name: str, color: str = "#18181b", size: int = 20) -> QIcon:
    """Return a QIcon for a Lucide icon name (without .svg), tinted to `color`."""
    return QIcon(_colored_pixmap(name, color, size))


def pixmap(name: str, color: str = "#18181b", size: int = 20) -> QPixmap:
    """Return a QPixmap directly, for contexts that want to paint it themselves."""
    return _colored_pixmap(name, color, size)


@lru_cache(maxsize=64)
def radio_pixmap(checked: bool, color: str, size: int = 16) -> QPixmap:
    """A radio-button indicator (ring, filled center when checked), drawn to
    match a given accent color exactly - used for the large clickable
    "radio card" tiles (e.g. scan scope selection) where a native
    QRadioButton's small OS-themed indicator would look out of place."""
    dpr = 3
    px = QPixmap(size * dpr, size * dpr)
    px.fill(Qt.transparent)
    painter = QPainter(px)
    painter.setRenderHint(QPainter.Antialiasing)
    pen_width = max(1, round(1.6 * dpr))
    painter.setPen(QPen(QColor(color), pen_width))
    painter.setBrush(Qt.NoBrush)
    margin = pen_width
    painter.drawEllipse(margin, margin, size * dpr - 2 * margin, size * dpr - 2 * margin)
    if checked:
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(color))
        center = (size * dpr) / 2
        radius = size * dpr * 0.24
        painter.drawEllipse(QPointF(center, center), radius, radius)
    painter.end()
    px.setDevicePixelRatio(dpr)
    return px


@lru_cache(maxsize=64)
def faded_pixmap(name: str, color: str, size: int, opacity: float = 0.1) -> QPixmap:
    """A Lucide icon rendered at reduced opacity - for a purely decorative
    background watermark (e.g. a large shield in a trust card's corner)
    that must stay far behind the card's real text in visual weight."""
    base = _colored_pixmap(name, color, size)
    faded = QPixmap(size, size)
    faded.fill(Qt.transparent)
    painter = QPainter(faded)
    painter.setOpacity(opacity)
    painter.drawPixmap(0, 0, base)
    painter.end()
    return faded


@lru_cache(maxsize=64)
def dot_pixmap(color: str, size: int = 8) -> QPixmap:
    """A small filled circle, tinted to `color`.

    The standard replacement for the colored circle emoji (green/red/amber/
    purple 'dots') used throughout the app for classification tiers and
    status badges - a solid QPainter-drawn shape instead of a pictographic
    emoji, so it stays legible and correctly colored on every platform/font.
    """
    dpr = 3  # supersample for crisp anti-aliased edges at these tiny sizes
    px = QPixmap(size * dpr, size * dpr)
    px.fill(Qt.transparent)
    painter = QPainter(px)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setPen(Qt.NoPen)
    painter.setBrush(QColor(color))
    painter.drawEllipse(0, 0, size * dpr, size * dpr)
    painter.end()
    px.setDevicePixelRatio(dpr)
    return px
