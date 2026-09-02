from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from control_tower.backend.app import create_app
from control_tower.backend.config import ControlTowerConfig


@pytest.mark.parametrize(
    ("image_format", "extension", "mime_type"),
    (
        ("JPEG", "jpg", "image/jpeg"),
        ("PNG", "png", "image/png"),
        ("WEBP", "webp", "image/webp"),
        ("GIF", "gif", "image/gif"),
        ("SVG", "svg", "image/svg+xml"),
    ),
)
def test_control_tower_serves_existing_local_archive_image(
    tmp_path: Path,
    image_format: str,
    extension: str,
    mime_type: str,
) -> None:
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    image_path = archive_root / "assets" / f"task16.{extension}"
    image_path.parent.mkdir(parents=True)
    if image_format == "SVG":
        image_bytes = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
    else:
        output = BytesIO()
        Image.new("RGB", (1, 1), "white").save(output, format=image_format)
        image_bytes = output.getvalue()
    image_path.write_bytes(image_bytes)
    (archive_root / "index.json").write_text(
        json.dumps({"assets": [{
            "archiveId": "e91390053bcb37ce",
            "files": {"imagePath": str(image_path), "imageMime": mime_type},
        }]}),
        encoding="utf-8",
    )
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})

    response = create_app(config).test_client().get(
        "/api/local-archive/assets/e91390053bcb37ce/image",
    )

    assert response.status_code == 200
    assert response.mimetype == mime_type
    assert response.data == image_bytes
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_control_tower_archive_image_failures_are_indistinguishable_404s(tmp_path: Path) -> None:
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    archive_root.mkdir()
    outside_path = tmp_path / "outside-secret.png"
    outside_path.write_bytes(b"secret")
    (archive_root / "index.json").write_text(
        json.dumps({"assets": [{
            "archiveId": "outside",
            "files": {"imagePath": str(outside_path), "imageMime": "image/png"},
        }]}),
        encoding="utf-8",
    )
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})
    client = create_app(config).test_client()

    responses = [
        client.get("/api/local-archive/assets/bad$id/image"),
        client.get("/api/local-archive/assets/..%5Csecret/image"),
        client.get("/api/local-archive/assets/missing/image"),
        client.get("/api/local-archive/assets/outside/image"),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404, 404]
    assert [response.get_json()["error"]["code"] for response in responses] == [
        "factory_archive_image_missing",
        "factory_archive_image_missing",
        "factory_archive_image_missing",
        "factory_archive_image_missing",
    ]
    assert all(response.get_json()["error"]["correlationId"] for response in responses)
    bodies = [response.get_data(as_text=True) for response in responses]
    assert all(str(tmp_path) not in body for body in bodies)
    assert all(outside_path.name not in body for body in bodies)


def test_control_tower_does_not_serve_non_image_archive_mime_as_html(tmp_path: Path) -> None:
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    html_path = archive_root / "assets" / "not-an-image.html"
    html_path.parent.mkdir(parents=True)
    html_path.write_text("<script>window.__archiveProbe = true</script>", encoding="utf-8")
    (archive_root / "index.json").write_text(
        json.dumps({"assets": [{
            "archiveId": "html-content-type",
            "files": {"imagePath": str(html_path), "imageMime": "text/html"},
        }]}),
        encoding="utf-8",
    )
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})

    response = create_app(config).test_client().get(
        "/api/local-archive/assets/html-content-type/image",
    )

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "factory_archive_image_missing"
    assert response.mimetype != "text/html"


def test_control_tower_rejects_html_bytes_labeled_as_png(tmp_path: Path) -> None:
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    image_path = archive_root / "assets" / "disguised.png"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"<!doctype html><script>window.__archiveProbe = true</script>")
    (archive_root / "index.json").write_text(
        json.dumps({"assets": [{
            "archiveId": "disguised",
            "files": {"imagePath": str(image_path), "imageMime": "image/png"},
        }]}),
        encoding="utf-8",
    )
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})

    response = create_app(config).test_client().get(
        "/api/local-archive/assets/disguised/image",
    )

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "factory_archive_image_missing"
    assert b"archiveProbe" not in response.data


def test_control_tower_rejects_oversized_archive_image_before_read_bytes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    image_path = archive_root / "assets" / "oversized.png"
    image_path.parent.mkdir(parents=True)
    with image_path.open("wb") as oversized_file:
        oversized_file.truncate(64 * 1024 * 1024 + 1)
    (archive_root / "index.json").write_text(
        json.dumps({"assets": [{
            "archiveId": "oversized",
            "files": {"imagePath": str(image_path), "imageMime": "image/png"},
        }]}),
        encoding="utf-8",
    )
    reads: list[Path] = []

    def tracked_read_bytes(path: Path) -> bytes:
        reads.append(path)
        return b"\x89PNG\r\n\x1a\noversized"

    monkeypatch.setattr(Path, "read_bytes", tracked_read_bytes)
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})

    response = create_app(config).test_client().get(
        "/api/local-archive/assets/oversized/image",
    )

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "factory_archive_image_missing"
    assert image_path not in reads
