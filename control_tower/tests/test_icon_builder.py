from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from PIL import Image, ImageDraw


REPOSITORY_ROOT = Path(__file__).parents[2]
BUILDER_PATH = REPOSITORY_ROOT / "control_tower" / "tools" / "build_icon.py"


def _load_builder() -> ModuleType:
    assert BUILDER_PATH.is_file(), "생산관제 아이콘 빌더가 아직 구현되지 않았습니다."
    spec = importlib.util.spec_from_file_location("control_tower_icon_builder", BUILDER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_icon_removes_only_corner_connected_background(tmp_path: Path) -> None:
    # Given: 바깥 흰 배경과 어두운 제품 타일 안쪽의 흰 패키지를 가진 원본을 만든다.
    source = tmp_path / "source.png"
    png_target = tmp_path / "production-control.png"
    ico_target = tmp_path / "production-control.ico"
    image = Image.new("RGBA", (256, 256), "white")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, 232, 232), radius=36, fill="#111827")
    draw.rectangle((92, 88, 164, 184), fill="white")
    image.save(source)

    # When: 생산관제 아이콘 빌더로 PNG와 ICO를 생성한다.
    builder = _load_builder()
    result = builder.build_icon(source, png_target, ico_target)

    # Then: 외곽은 투명하고 내부 흰 패키지는 불투명하며 두 산출물이 존재해야 한다.
    assert result.png_path == png_target
    assert result.ico_path == ico_target
    with Image.open(png_target) as built_png:
        rgba = built_png.convert("RGBA")
        assert rgba.getpixel((0, 0))[3] == 0
        assert rgba.getpixel((255, 255))[3] == 0
        assert rgba.getpixel((128, 128)) == (255, 255, 255, 255)
    assert ico_target.is_file()
    assert ico_target.stat().st_size > 0


def test_build_icon_contains_windows_shortcut_sizes(tmp_path: Path) -> None:
    # Given: 충분한 해상도의 단색 아이콘 원본과 출력 경로를 준비한다.
    source = tmp_path / "source.png"
    png_target = tmp_path / "production-control.png"
    ico_target = tmp_path / "production-control.ico"
    Image.new("RGBA", (512, 512), "#111827").save(source)

    # When: Windows 바로가기용 아이콘을 만든다.
    builder = _load_builder()
    builder.build_icon(source, png_target, ico_target)

    # Then: 작은 바로가기부터 고해상도 보기까지 필요한 크기가 모두 포함되어야 한다.
    with Image.open(ico_target) as built_ico:
        assert built_ico.ico.sizes() == {
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        }
