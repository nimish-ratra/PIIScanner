"""
Asset Generation Script for clAIssify
Generates official application icons (.ico, .png) and brand assets from the source clAIssify logo.
"""

from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np


def generate_app_icon(output_dir: Path) -> Path:
    """Generate high-resolution multi-size .ico and .png icons from source clAIssify logo."""
    output_dir.mkdir(parents=True, exist_ok=True)
    source_logo_path = output_dir / "claissify_source_logo.png"

    if not source_logo_path.exists():
        raise FileNotFoundError(f"Source logo not found at {source_logo_path}")

    img = Image.open(source_logo_path).convert("RGBA")
    arr = np.array(img)

    # 1. Extract Shield Emblem (y in [335, 665], x in [15, 280])
    shield_crop = arr[335:665, 15:280].copy()
    sh, sw = shield_crop.shape[:2]

    # Compute row-span mask to preserve internal details (white circuits, gaps) while removing outer background
    mask = np.zeros((sh, sw), dtype=float)
    for y in range(sh):
        row_pixels = shield_crop[y, :, :3]
        colored = ~((row_pixels[:, 0] > 240) & (row_pixels[:, 1] > 242) & (row_pixels[:, 2] > 245))
        idxs = np.where(colored)[0]
        if len(idxs) > 0:
            mask[y, idxs.min():idxs.max() + 1] = 1.0

    # Soften mask boundary with slight blur to eliminate any aliased jagged edges
    mask_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=0.7))
    shield_crop[:, :, 3] = np.array(mask_img)

    tight = Image.fromarray(shield_crop).crop(Image.fromarray(shield_crop).getbbox())

    # Create 512x512 canvas with emblem centered and padded
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    target_h = 440
    ratio = target_h / tight.size[1]
    target_w = int(tight.size[0] * ratio)
    resized = tight.resize((target_w, target_h), Image.Resampling.LANCZOS)

    offset_x = (512 - target_w) // 2
    offset_y = (512 - target_h) // 2
    canvas.paste(resized, (offset_x, offset_y), resized)

    # Save app_icon.png and claissify_icon.png
    png_path = output_dir / "app_icon.png"
    canvas.save(png_path, "PNG")

    claissify_icon_path = output_dir / "claissify_icon.png"
    canvas.save(claissify_icon_path, "PNG")

    # Save multi-size ICO
    ico_path = output_dir / "app_icon.ico"
    icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    canvas.save(ico_path, format="ICO", sizes=icon_sizes)

    # 2. Extract Full Horizontal Logo (Emblem + "ClAIssify" + Tagline)
    logo_crop = Image.fromarray(arr[335:665, 15:1015])
    logo_path = output_dir / "claissify_logo.png"
    logo_crop.save(logo_path, "PNG")

    print(f"Generated official clAIssify icon assets in: {output_dir}")
    print(f" - {png_path}")
    print(f" - {ico_path}")
    print(f" - {claissify_icon_path}")
    print(f" - {logo_path}")

    return ico_path


if __name__ == "__main__":
    assets_dir = Path(__file__).parent / "assets"
    generate_app_icon(assets_dir)
