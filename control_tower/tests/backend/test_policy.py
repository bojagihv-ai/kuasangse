from __future__ import annotations

from control_tower.backend.policy import (
    COMPETITOR_MARKETS,
    DECISION_POINT_IDS,
    POLICY_PRESETS,
    PolicyError,
    build_policy_snapshot,
    validate_policy_snapshot,
)
import pytest


def test_all_required_qualitative_decisions_are_registered() -> None:
    # Given: 생산관제에서 사람이 선택하던 모든 판단 지점 목록을 준비한다.
    required = {
        "sinhwa_db_product",
        "cafe24_product",
        "competitor_product",
        "competitor_coupang",
        "competitor_smartstore",
        "competitor_gmarket",
        "competitor_auction",
        "competitor_elevenst",
        "required_field_candidate",
        "representative_image",
        "size_image",
        "option_image",
        "general_image",
        "section_variant",
        "final_detail",
    }

    # When/Then: registry가 모든 지점을 포함해야 한다.
    assert required <= set(DECISION_POINT_IDS)
    assert COMPETITOR_MARKETS == ("coupang", "smartstore", "gmarket", "auction", "elevenst")


def test_manual_presets_only_change_their_declared_decisions() -> None:
    # Given: 전체 자동과 이미지 전체 수동 preset을 준비한다.
    full_auto = POLICY_PRESETS["full_auto"]
    all_manual = POLICY_PRESETS["all_images_manual"]

    # When: 두 preset을 읽는다.
    # Then: 이미지 선택만 수동이고 제품·필드 선택은 자동이어야 한다.
    assert all(value == "auto" for value in full_auto.values())
    assert all_manual["representative_image"] == "manual"
    assert all_manual["size_image"] == "manual"
    assert all_manual["option_image"] == "manual"
    assert all_manual["general_image"] == "manual"
    assert all_manual["required_field_candidate"] == "auto"


def test_policy_snapshot_freezes_precedence_and_version() -> None:
    # Given: batch preset과 제품·stage override를 서로 다르게 준비한다.
    snapshot = build_policy_snapshot(
        "batch-001",
        "product-001",
        "full_auto",
        {"representative_image": "manual"},
        {"representative_image": "auto", "size_image": "manual"},
        {"representative_image": "manual"},
    )

    # When/Then: snapshot은 당시 유효한 정책과 precedence를 보존해야 한다.
    assert snapshot["snapshotVersion"] == 2
    assert snapshot["resolved"]["representative_image"] == "manual"
    assert snapshot["resolved"]["size_image"] == "manual"
    assert snapshot["resolved"]["final_detail"] == "auto"
    assert snapshot["effectiveSources"]["representative_image"] == "stage"
    assert snapshot["effectiveSources"]["size_image"] == "product"
    assert snapshot["effectiveSources"]["final_detail"] == "batch_preset"
    assert snapshot["precedence"] == ["stage", "product", "batch", "batch_preset", "auto_default"]
    assert snapshot["locked"] is True
    assert snapshot["snapshotId"].startswith("policy:")


def test_policy_snapshot_rejects_invalid_overrides_and_is_deterministic() -> None:
    arguments = (
        "batch-001",
        "product-001",
        "full_auto",
        {"competitor_coupang": "manual"},
        {},
        {"final_detail": "auto"},
    )
    assert build_policy_snapshot(*arguments)["snapshotId"] == build_policy_snapshot(*arguments)["snapshotId"]
    with pytest.raises(PolicyError, match="policy_mode_invalid"):
        build_policy_snapshot("batch", "product", "full_auto", {"final_detail": "sometimes"}, {}, {})
    tampered = dict(build_policy_snapshot(*arguments))
    tampered["resolved"] = {**tampered["resolved"], "final_detail": "manual"}
    with pytest.raises(PolicyError, match="policy_snapshot_tampered"):
        validate_policy_snapshot(tampered)
