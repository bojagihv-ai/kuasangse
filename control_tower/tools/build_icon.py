#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow>=11,<13",
# ]
# ///

# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run directly (no venv, no pip install needed):
#      uv run control_tower/tools/build_icon.py
# 3. Or make executable and run:
#      chmod +x control_tower/tools/build_icon.py && ./control_tower/tools/build_icon.py
# ──────────────────

from __future__ import annotations

from pathlib import Path
from typing import Final, NamedTuple

from PIL import Image, ImageDraw


REPOSITORY_ROOT: Final = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE: Final = REPOSITORY_ROOT / "control_tower" / "assets" / "production-control-source.png"
DEFAULT_PNG_TARGET: Final = REPOSITORY_ROOT / "control_tower" / "assets" / "production-control.png"
DEFAULT_ICO_TARGET: Final = REPOSITORY_ROOT / "control_tower" / "assets" / "production-control.ico"
ICON_SIZES: Final = ((16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256))
BACKGROUND_MIN_CHANNEL: Final = 225
BACKGROUND_CHANNEL_SPREAD: Final = 24
BACKGROUND_THRESHOLD: Final = 52


class IconBuildResult(NamedTuple):
    png_path: Path
    ico_path: Path


def _is_near_white(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    channels = (red, green, blue)
    return alpha > 0 and min(channels) >= BACKGROUND_MIN_CHANNEL and max(channels) - min(channels) <= BACKGROUND_CHANNEL_SPREAD


def _remove_corner_connected_background(source: Image.Image) -> Image.Image:
    transparent = source.convert("RGBA")
    width, height = transparent.size
    corners = ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))
    for corner in corners:
        pixel = transparent.getpixel(corner)
        if isinstance(pixel, tuple) and len(pixel) == 4 and _is_near_white(pixel):
            ImageDraw.floodfill(transparent, corner, (255, 255, 255, 0), thresh=BACKGROUND_THRESHOLD)
    return transparent


def build_icon(source: Path, png_target: Path, ico_target: Path) -> IconBuildResult:
    if not source.is_file():
        raise FileNotFoundError(source)
    png_target.parent.mkdir(parents=True, exist_ok=True)
    ico_target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        transparent = _remove_corner_connected_background(opened)
        transparent.save(png_target, format="PNG", optimize=True)
        transparent.save(ico_target, format="ICO", sizes=ICON_SIZES)
    return IconBuildResult(png_path=png_target, ico_path=ico_target)


def main() -> None:
    result = build_icon(DEFAULT_SOURCE, DEFAULT_PNG_TARGET, DEFAULT_ICO_TARGET)
    print(f"PNG={result.png_path}")
    print(f"ICO={result.ico_path}")


if __name__ == "__main__":
    main()
