"""보관 원본 대신 줄인 사본을 내주는 길.

실측 2026-09-03: 생산관제 생산·A컷 보드가 격자 칸을 100px 남짓으로 그리면서 보관 원본을
그대로 물었다. 숨겨진 화면에서도 1200~1840px 서른 장이 남아 화면 전체가 무거웠고,
스크린샷조차 30초 안에 못 찍었다. 원본은 확대할 때만 필요하다.
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import Flask
from PIL import Image

import routes.api_archive as api_archive


def _client(tmp_path: Path, monkeypatch):
    archive_root = tmp_path / "local-archive"
    archive_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(api_archive.Config, "LOCAL_ARCHIVE_FOLDER", str(archive_root))
    monkeypatch.setattr(api_archive, "_LOCAL_ARCHIVE_INDEX_PATH", str(archive_root / "index.json"))
    monkeypatch.setattr(api_archive, "LOCAL_ARCHIVE_THUMBNAIL_DIR", tmp_path / "thumbs")
    app = Flask(__name__)
    app.register_blueprint(api_archive.api, url_prefix="/api")
    return app.test_client(), archive_root


def _seed_asset(archive_root: Path, *, archive_id: str = "asset-1", size=(1600, 1200)) -> Path:
    image_path = archive_root / f"{archive_id}.png"
    Image.new("RGB", size, (120, 60, 200)).save(image_path)
    index = {
        "assets": [
            {
                "archiveId": archive_id,
                "files": {"imagePath": str(image_path), "imageMime": "image/png"},
            }
        ]
    }
    (archive_root / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return image_path


def test_thumbnail_is_smaller_than_the_original_and_keeps_the_shape(tmp_path: Path, monkeypatch) -> None:
    # Given: 1600x1200 원본 한 장이 보관되어 있다.
    client, archive_root = _client(tmp_path, monkeypatch)
    image_path = _seed_asset(archive_root)

    # When: 격자가 쓰는 크기로 썸네일을 요청한다.
    response = client.get("/api/local-archive/assets/asset-1/thumbnail?w=320")

    # Then: 이미지가 오고, 원본보다 작고, 가로세로 비율은 그대로다.
    assert response.status_code == 200
    assert response.mimetype == "image/jpeg"
    assert len(response.data) < image_path.stat().st_size
    from io import BytesIO

    with Image.open(BytesIO(response.data)) as thumb:
        assert thumb.width == 320
        assert thumb.height == 240


def test_requested_width_snaps_to_a_fixed_ladder(tmp_path: Path, monkeypatch) -> None:
    # 아무 숫자나 받으면 사본이 무한히 늘어난다. 정해진 단계로만 만든다.
    client, archive_root = _client(tmp_path, monkeypatch)
    _seed_asset(archive_root)
    from io import BytesIO

    for requested, expected in ((300, 320), (1_000_000, 640), (10, 160), (0, 320)):
        response = client.get(f"/api/local-archive/assets/asset-1/thumbnail?w={requested}")
        assert response.status_code == 200
        with Image.open(BytesIO(response.data)) as thumb:
            assert thumb.width == expected, f"{requested} -> {thumb.width}"


def test_second_request_reuses_the_saved_copy(tmp_path: Path, monkeypatch) -> None:
    client, archive_root = _client(tmp_path, monkeypatch)
    _seed_asset(archive_root)
    first = client.get("/api/local-archive/assets/asset-1/thumbnail?w=320")
    made = sorted((tmp_path / "thumbs").glob("*.jpg"))
    second = client.get("/api/local-archive/assets/asset-1/thumbnail?w=320")
    assert first.status_code == second.status_code == 200
    assert sorted((tmp_path / "thumbs").glob("*.jpg")) == made
    assert len(made) == 1


def test_when_the_copy_cannot_be_made_the_original_is_served(tmp_path: Path, monkeypatch) -> None:
    # 사본을 못 만든다고 그림이 비면 안 된다. 무거워도 원본을 보여 준다.
    client, archive_root = _client(tmp_path, monkeypatch)
    _seed_asset(archive_root)
    monkeypatch.setattr(api_archive, "_local_archive_thumbnail_file", lambda *_args, **_kwargs: None)
    response = client.get("/api/local-archive/assets/asset-1/thumbnail?w=320")
    assert response.status_code == 200
    assert response.mimetype == "image/png"


def test_unknown_asset_is_refused(tmp_path: Path, monkeypatch) -> None:
    client, archive_root = _client(tmp_path, monkeypatch)
    _seed_asset(archive_root)
    response = client.get("/api/local-archive/assets/없는것/thumbnail")
    assert response.status_code == 404


def test_original_image_route_still_serves_the_original(tmp_path: Path, monkeypatch) -> None:
    # 확대해서 볼 때는 원본이 필요하다. 이 길은 건드리지 않았다.
    client, archive_root = _client(tmp_path, monkeypatch)
    image_path = _seed_asset(archive_root)
    response = client.get("/api/local-archive/assets/asset-1/image")
    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert len(response.data) == image_path.stat().st_size
