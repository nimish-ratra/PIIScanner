"""
Asset Generation Script for PII Sentinel
Draws a modern high-resolution shield & privacy lock emblem and exports .ico and .png formats.
"""

from pathlib import Path
from PIL import Image, ImageDraw


def generate_app_icon(output_dir: Path) -> Path:
    """Draw a vector-like shield icon and export multi-resolution .ico and .png files."""
    output_dir.mkdir(parents=True, exist_ok=True)
    size = (512, 512)

    # 1. Base image RGBA
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Coordinates for Shield
    # Top-left, top-right, right drop, bottom point, left drop
    shield_pts = [
        (80, 80),
        (432, 80),
        (432, 280),
        (256, 448),
        (80, 280)
    ]

    # Draw Outer Glow / Border
    draw.polygon(shield_pts, fill=(30, 58, 138, 255), outline=(59, 130, 246, 255), width=12)

    # Inner Shield
    inner_pts = [
        (104, 104),
        (408, 104),
        (408, 266),
        (256, 418),
        (104, 266)
    ]
    draw.polygon(inner_pts, fill=(15, 23, 42, 255), outline=(96, 165, 250, 255), width=6)

    # Draw Keyhole / Lock in center
    # Shackle (top arch)
    draw.arc([200, 160, 312, 272], start=180, end=0, fill=(56, 189, 248, 255), width=18)

    # Lock body (rounded rectangle)
    draw.rounded_rectangle([184, 232, 328, 348], radius=16, fill=(37, 99, 235, 255), outline=(147, 197, 253, 255), width=6)

    # Keyhole circle & drop
    draw.ellipse([240, 264, 272, 296], fill=(248, 250, 252, 255))
    draw.polygon([(246, 288), (266, 288), (262, 324), (250, 324)], fill=(248, 250, 252, 255))

    # Save PNG
    png_path = output_dir / "app_icon.png"
    img.save(png_path, "PNG")

    # Save multi-size ICO
    ico_path = output_dir / "app_icon.ico"
    icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    img.save(ico_path, format="ICO", sizes=icon_sizes)

    print(f"Generated icon assets in: {output_dir}")
    return ico_path


if __name__ == "__main__":
    assets_dir = Path(__file__).parent / "assets"
    generate_app_icon(assets_dir)
