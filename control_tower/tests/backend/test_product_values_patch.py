"""투입값을 보드에서 그 자리에서 채울 수 있어야 한다."""

from __future__ import annotations

from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_cafe24_registration_order import _completed


def _bridge(tmp_path: Path, suffix: str) -> tuple[FactorySyncBridge, str]:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    return bridge, _completed(bridge, suffix)[0]


def test_missing_values_are_reported_so_the_screen_can_ask(tmp_path: Path) -> None:
    # 어떤 값이 비었는지 모르면 화면은 무엇을 물어야 할지 알 수 없고, 사람은 입력·소스
    # 화면으로 되돌아가야 한다.
    bridge, job_id = _bridge(tmp_path, "missing")
    job = bridge._product_jobs[job_id]
    job.payload["requiredValues"] = {"material": "면 100%"}

    public = bridge._public_product_job(job)

    assert public["requiredValues"]["material"] == "면 100%"
    assert "usage" in public["missingRequiredValues"]
    assert "material" not in public["missingRequiredValues"]


def test_values_can_be_filled_in_place(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "fill")
    bridge._product_jobs[job_id].payload["requiredValues"] = {}

    job = bridge.update_product_values(job_id, {"usage": "선물포장", "size": "55x55cm"})

    assert job["requiredValues"]["usage"] == "선물포장"
    assert job["requiredValues"]["size"] == "55x55cm"
    assert "usage" not in job["missingRequiredValues"]


def test_filling_keeps_the_values_that_were_already_there(tmp_path: Path) -> None:
    # 한 칸만 채우려고 눌렀는데 나머지가 지워지면 투입값을 통째로 다시 써야 한다.
    bridge, job_id = _bridge(tmp_path, "merge")
    bridge._product_jobs[job_id].payload["requiredValues"] = {"material": "면 100%"}

    job = bridge.update_product_values(job_id, {"usage": "선물포장"})

    assert job["requiredValues"]["material"] == "면 100%"
    assert job["requiredValues"]["usage"] == "선물포장"


def test_unknown_keys_are_refused(tmp_path: Path) -> None:
    # 계약에 없는 키를 받아 두면 조립공장이 payload 전체를 거절한다.
    bridge, job_id = _bridge(tmp_path, "unknown")

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_values(job_id, {"nope": "x"})
    assert error.value.code == "factory_product_values_invalid"


def test_a_running_job_is_not_edited_underneath(tmp_path: Path) -> None:
    # 조립공장이 이미 그 값으로 돌고 있는데 바꾸면, 화면과 결과가 어긋난다.
    bridge, job_id = _bridge(tmp_path, "busy")
    bridge._product_jobs[job_id].status = "running"

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_values(job_id, {"usage": "선물포장"})
    assert error.value.code == "factory_product_job_busy"


def test_empty_request_is_refused(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "empty")

    with pytest.raises(FactorySyncError):
        bridge.update_product_values(job_id, {})


def _png_data_url() -> str:
    return (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
        "AAAADUlEQVR42mP8z8AAAwAB/AFbxpTLAAAAAElFTkSuQmCC"
    )


def _image(role: str, name: str, color: str | None = None) -> dict:
    return {
        "role": role,
        "ordinal": 1,
        "name": name,
        "fileName": f"{name}.png",
        "colorName": color,
        "sha256": "a" * 64,
        "dataUrl": _png_data_url(),
    }


def test_images_can_be_replaced_in_place(tmp_path: Path) -> None:
    # input 은 사람이 올리는 것이다. 올린 것을 고치려고 입력·소스 화면으로 되돌아가야
    # 하면, 보드에서 하는 일이 반쪽이 된다.
    bridge, job_id = _bridge(tmp_path, "images")

    job = bridge.update_product_images(
        job_id,
        [_image("base", "기본컷"), _image("color-option", "빨강", "빨강")],
    )

    roles = [image["role"] for image in job["inputImageSummary"]]
    assert roles == ["base", "color-option"]
    assert job["inputImageSummary"][1]["colorName"] == "빨강"


def test_color_image_without_a_color_name_is_refused(tmp_path: Path) -> None:
    # 색상명이 없으면 조립공장이 옵션표를 만들 수 없다.
    bridge, job_id = _bridge(tmp_path, "nocolor")

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_images(job_id, [_image("base", "기본컷"), _image("color-option", "빨강")])
    assert error.value.code == "factory_product_color_name_required"


def test_images_without_a_base_are_refused(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "nobase")

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_images(job_id, [_image("color-option", "빨강", "빨강")])
    assert error.value.code == "factory_product_base_image_required"


def test_color_images_decide_the_option_mode(tmp_path: Path) -> None:
    # 색상 이미지가 있는데 옵션 없음으로 남으면 조립공장이 옵션 단계를 건너뛴다.
    bridge, job_id = _bridge(tmp_path, "optionmode")

    with_color = bridge.update_product_images(
        job_id,
        [_image("base", "기본컷"), _image("color-option", "빨강", "빨강")],
    )
    assert with_color["requiredValues"]["optionMode"] == "provided"

    without_color = bridge.update_product_images(job_id, [_image("base", "기본컷")])
    assert without_color["requiredValues"]["optionMode"] == "none"


def test_a_running_job_keeps_its_images(tmp_path: Path) -> None:
    bridge, job_id = _bridge(tmp_path, "imgbusy")
    bridge._product_jobs[job_id].status = "running"

    with pytest.raises(FactorySyncError) as error:
        bridge.update_product_images(job_id, [_image("base", "기본컷")])
    assert error.value.code == "factory_product_job_busy"
