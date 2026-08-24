from __future__ import annotations

from base64 import b64encode
import json
from pathlib import Path

import pytest

from control_tower.backend.asset_store import AssetStoreError, ProductAssetStore
from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError

from test_factory_sync import _hello, _manual_product_job_payload


def _image_data_url(marker: bytes) -> str:
    content = b"\x89PNG\r\n\x1a\n" + marker * 4096
    return f"data:image/png;base64,{b64encode(content).decode('ascii')}"


def _payload_with(data_url: str, *, suffix: str) -> dict[str, object]:
    payload = _manual_product_job_payload(suffix=suffix)
    images = payload["inputImages"]
    assert isinstance(images, list)
    image = images[0]
    assert isinstance(image, dict)
    image["dataUrl"] = data_url
    return payload


def test_asset_store_round_trips_and_deduplicates(tmp_path: Path) -> None:
    store = ProductAssetStore(tmp_path / "assets")
    data_url = _image_data_url(b"A")

    first = store.put_data_url(data_url)
    second = store.put_data_url(data_url)

    assert first == second
    assert first["assetRef"].startswith("sha256-")
    assert first["mediaType"] == "image/png"
    assert store.has(first["assetRef"]) is True
    assert store.data_url(str(first["assetRef"])) == data_url
    stored = [path for path in (tmp_path / "assets").rglob("*.bin")]
    assert len(stored) == 1


def test_asset_store_rejects_broken_reference_and_payload(tmp_path: Path) -> None:
    store = ProductAssetStore(tmp_path / "assets")

    with pytest.raises(AssetStoreError) as invalid_ref:
        store.read("sha256-not-a-digest")
    assert invalid_ref.value.code == "factory_asset_ref_invalid"

    with pytest.raises(AssetStoreError) as invalid_data_url:
        store.put_data_url("data:image/png,not-base64")
    assert invalid_data_url.value.code == "factory_asset_data_url_invalid"

    with pytest.raises(AssetStoreError) as forbidden_type:
        store.put_data_url("data:application/pdf;base64,aGVsbG8=")
    assert forbidden_type.value.code == "factory_asset_media_type_invalid"

    missing = store.put_data_url(_image_data_url(b"B"))
    binary = next((tmp_path / "assets").rglob("*.bin"))
    binary.unlink()
    with pytest.raises(AssetStoreError) as gone:
        store.read(str(missing["assetRef"]))
    assert gone.value.code == "factory_asset_missing"


def test_durable_state_keeps_image_bytes_out_of_the_state_document(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    data_url = _image_data_url(b"C")

    queued = bridge.queue_product(_payload_with(data_url, suffix="externalized"))
    job_id = str(queued["jobId"])

    document = json.loads(state_path.read_text(encoding="utf-8"))
    stored_image = document["jobs"][0]["payload"]["inputImages"][0]
    assert "dataUrl" not in stored_image
    assert str(stored_image["assetRef"]).startswith("sha256-")
    assert stored_image["mediaType"] == "image/png"
    assert stored_image["byteLength"] == 8 + 4096
    assert stored_image["sha256"] == "fixture-sha"
    assert "base64," not in state_path.read_text(encoding="utf-8")
    assert state_path.stat().st_size < 4096

    restored = FactorySyncBridge(state_path=state_path)
    assert restored.product_job_context(job_id)["payload"] == bridge.product_job_context(job_id)["payload"]
    assert restored.product_job_context(job_id)["payload"]["inputImages"][0]["dataUrl"] == data_url


def test_durable_state_size_stays_flat_as_products_accumulate(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())

    bridge.queue_product(_payload_with(_image_data_url(b"D"), suffix="one"))
    single = state_path.stat().st_size
    for index in range(19):
        bridge.queue_product(_payload_with(_image_data_url(bytes([65 + index])), suffix=f"bulk-{index}"))
    twenty = state_path.stat().st_size

    assert len(bridge.product_jobs()) == 20
    # 이미지 본문이 상태 문서 밖에 있으므로 작업 20건이어도 문서는 작업 1건의 30배를 넘지 않는다.
    assert twenty < single * 30
    assert twenty < 64 * 1024


def test_same_image_across_products_is_stored_once(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    shared = _image_data_url(b"E")

    bridge.queue_product(_payload_with(shared, suffix="shared-one"))
    bridge.queue_product(_payload_with(shared, suffix="shared-two"))

    binaries = list((state_path.parent / "factory-input-assets").rglob("*.bin"))
    assert len(binaries) == 1


def test_a_missing_asset_blocks_only_that_product_not_the_whole_tower(tmp_path: Path) -> None:
    """이미지 원본이 사라져도 관제탑은 켜지고, 그 작업만 이유와 함께 막힌다."""
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.hello(_hello())
    broken = str(bridge.queue_product(_payload_with(_image_data_url(b"F"), suffix="missing-blob"))["jobId"])
    healthy = str(bridge.queue_product(_payload_with(_image_data_url(b"G"), suffix="intact"))["jobId"])
    for binary in (state_path.parent / "factory-input-assets").rglob("*.bin"):
        if b"F" * 64 in binary.read_bytes():
            binary.unlink()

    restored = FactorySyncBridge(state_path=state_path)

    jobs = {job["jobId"]: job for job in restored.product_jobs()}
    assert set(jobs) == {broken, healthy}
    assert jobs[broken]["status"] == "blocked"
    assert jobs[broken]["assetsMissing"] is True
    assert "이미지 원본" in jobs[broken]["message"]
    # 자리표시자로 다시 돌리면 엉뚱한 결과가 나오므로 재개는 막는다.
    with pytest.raises(FactorySyncError) as error:
        restored.resume_product(broken)
    assert error.value.code == "factory_product_asset_missing"
    # 멀쩡한 작업은 그대로 살아 있다.
    assert "assetsMissing" not in jobs[healthy]
    assert restored.product_job_context(healthy)["payload"]["inputImages"][0]["dataUrl"] == _image_data_url(b"G")


def test_a_legacy_state_document_is_migrated_on_startup(tmp_path: Path) -> None:
    """예전에 이미지 본문을 그대로 안고 있던 상태 문서는 기동 한 번으로 가벼워진다."""
    state_path = tmp_path / "factory-product-jobs.json"
    # 워커를 붙이지 않아 배정이 일어나지 않게 한다. 기동 시 재작성 원인을 이관 하나로 좁히려는 것이다.
    first = FactorySyncBridge(state_path=state_path)
    first.queue_product(_payload_with(_image_data_url(b"L"), suffix="legacy"))
    job_id = str(first.product_jobs()[0]["jobId"])

    # 자산 저장소가 없던 시절처럼 이미지 본문을 문서 안에 되돌려 놓는다.
    legacy = json.loads(state_path.read_text(encoding="utf-8"))
    image = legacy["jobs"][0]["payload"]["inputImages"][0]
    restored = {key: value for key, value in image.items() if key not in {"assetRef", "mediaType", "byteLength"}}
    restored["dataUrl"] = _image_data_url(b"L")
    legacy["jobs"][0]["payload"]["inputImages"][0] = restored
    state_path.write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
    assert "base64," in state_path.read_text(encoding="utf-8")
    heavy = state_path.stat().st_size

    migrated = FactorySyncBridge(state_path=state_path)

    assert "base64," not in state_path.read_text(encoding="utf-8")
    assert state_path.stat().st_size < heavy / 2
    assert migrated.product_job_context(job_id)["payload"]["inputImages"][0]["dataUrl"] == _image_data_url(b"L")


def test_an_already_migrated_document_is_not_rewritten_on_startup(tmp_path: Path) -> None:
    state_path = tmp_path / "factory-product-jobs.json"
    bridge = FactorySyncBridge(state_path=state_path)
    bridge.queue_product(_payload_with(_image_data_url(b"M"), suffix="already"))
    before = state_path.read_bytes()

    FactorySyncBridge(state_path=state_path)

    assert state_path.read_bytes() == before
