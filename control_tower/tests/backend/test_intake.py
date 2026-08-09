from __future__ import annotations

import json
from pathlib import Path

import pytest

from control_tower.backend.intake import IntakeError, parse_product_folder


def _write_product(root: Path, *, primary: int | None = None) -> Path:
    product = root / "001-빨강제품"
    (product / "base").mkdir(parents=True)
    (product / "colors").mkdir()
    (product / "base" / "01.jpg").write_bytes(b"base-1")
    (product / "base" / "02.png").write_bytes(b"base-2")
    (product / "colors" / "01.빨강.webp").write_bytes(b"red-1")
    payload = {"externalId": "EXT-001"}
    if primary is not None:
        payload["primaryBaseSequence"] = primary
    (product / "product.json").write_text(json.dumps(payload), encoding="utf-8")
    return product


def test_parse_product_folder_returns_deterministic_remote_input_snapshot(tmp_path: Path) -> None:
    # Given: 번호가 있는 기본이미지·색상이미지와 제품 사실값을 준비한다.
    product = _write_product(tmp_path, primary=2)

    # When: 같은 제품 폴더를 두 번 정규화한다.
    first = parse_product_folder(product, "batch-001", "workspace-001", "run-001")
    second = parse_product_folder(product, "batch-001", "workspace-001", "run-001")

    # Then: 원격 snapshot에 필요한 메타데이터가 결정적으로 같고 원본 경로가 노출되지 않아야 한다.
    assert first == second
    assert first["productId"] == "EXT-001"
    assert first["inputImageFingerprint"].startswith("sha256:")
    assert [image["fileName"] for image in first["inputImages"]] == ["02.png", "01.jpg", "01.빨강.webp"]
    assert first["inputImages"][0]["role"] == "base"
    assert all("sourcePath" not in image for image in first["inputImages"])


def test_parse_product_folder_without_explicit_id_uses_content_stable_id(tmp_path: Path) -> None:
    # Given: 내부 식별자가 없는 제품 폴더를 준비한다.
    product = _write_product(tmp_path)
    (product / "product.json").write_text("{}", encoding="utf-8")

    # When: 입력 snapshot을 계산한다.
    manifest = parse_product_folder(product, "batch-001", "workspace-001", "run-001")

    # Then: 내용에서 재현 가능한 내부 productId가 발급되어야 한다.
    assert manifest["productId"].startswith("product-")
    assert len(manifest["productId"]) == len("product-") + 16


def test_parse_product_folder_rejects_ambiguous_color_sequence(tmp_path: Path) -> None:
    # Given: 대소문자만 다른 동일 색상 번호를 준비한다.
    product = _write_product(tmp_path)
    (product / "colors" / "01.빨강.png").write_bytes(b"duplicate")

    # When/Then: 임의의 후보 선택 없이 제품을 격리해야 한다.
    with pytest.raises(IntakeError, match="duplicate_color_sequence"):
        parse_product_folder(product, "batch-001", "workspace-001", "run-001")


def test_parse_product_folder_rejects_missing_primary_and_changes_fingerprint(tmp_path: Path) -> None:
    # Given: 존재하지 않는 대표 기본이미지를 가리키는 제품과 동일 제품의 변경본을 준비한다.
    product = _write_product(tmp_path, primary=9)

    # When/Then: 존재하지 않는 대표 기본이미지는 명확한 입력 오류여야 한다.
    with pytest.raises(IntakeError, match="primary_base_missing"):
        parse_product_folder(product, "batch-001", "workspace-001", "run-001")

    product = _write_product(tmp_path / "changed")
    before = parse_product_folder(product, "batch-001", "workspace-001", "run-001")
    (product / "base" / "01.jpg").write_bytes(b"changed")
    after = parse_product_folder(product, "batch-001", "workspace-001", "run-001")
    assert before["inputImageFingerprint"] != after["inputImageFingerprint"]

