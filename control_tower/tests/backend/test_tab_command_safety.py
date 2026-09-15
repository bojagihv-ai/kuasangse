from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncError
from test_factory_sync import _hello, _manual_product_job_payload
from test_tab_command_backend import (
    TabEnvironment, complete_tab, queue_tab, read_execution, tab_env,
    tab_payload, tab_receipt,
)


@pytest.mark.parametrize("field,value", [
    ("schema", "wrong"), ("jobId", "foreign"), ("tabId", "registration"),
    ("action", "registerFactoryCafe24"), ("expectedWorkspaceId", "batch:foreign"),
    ("productId", "foreign"), ("productKey", "foreign"), ("expectedRunId", "foreign"),
    ("expectedInputFingerprint", "foreign"), ("expectedRevision", 9),
    ("expectedStoreRevision", 19), ("expectedRevision", True),
    ("expectedStoreRevision", False), ("unexpected", "field"),
    ("value", {"__proto__": {}}), ("value", {"apiKey": "secret"}),
    ("value", "x" * 65536), ("value", {str(i): i for i in range(129)}),
], ids=[f"invalid-{index}" for index in range(18)])
def test_invalid_command_never_reserves_or_changes_job(tab_env, field, value):
    # Given: 유효한 작업과 한 항목만 변조한 요청.
    payload = {**tab_payload(tab_env), field: value}
    before = tab_env.bridge._mutable_state_snapshot_locked()
    # When/Then: 신원/허용키/크기 검사에서 실패하고 상태 A를 그대로 남긴다.
    with pytest.raises(FactorySyncError):
        tab_env.bridge.queue_tab_command(tab_env.job_id, payload)
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


def test_csrf_and_body_limit_are_enforced(tab_env: TabEnvironment) -> None:
    url = f"/api/factory/jobs/{tab_env.job_id}/tab-command"
    assert tab_env.client.post(url, json=tab_payload(tab_env)).status_code == 428
    assert tab_env.client.post(url, json={**tab_payload(tab_env), "value": "x" * 65536}, headers=tab_env.headers).status_code == 413
    assert tab_env.client.post(url, json=[], headers=tab_env.headers).status_code == 422
    assert not tab_env.bridge.has_pending()


def test_same_payload_is_atomic_and_different_payload_conflicts(tab_env: TabEnvironment) -> None:
    payload = tab_payload(tab_env)
    with ThreadPoolExecutor(max_workers=2) as pool:
        orders = list(pool.map(lambda _: tab_env.bridge.queue_tab_command(tab_env.job_id, payload), range(2)))
    assert orders[0] == orders[1]
    assert sum(item.order.get("idempotencyKey") == payload["idempotencyKey"] for item in tab_env.bridge._executions.values()) == 1
    with pytest.raises(FactorySyncError, match="idempotency_conflict"):
        tab_env.bridge.queue_tab_command(tab_env.job_id, {**payload, "value": {"query": "다른 값"}})


def test_idempotent_retry_after_completion_returns_original_order(tab_env: TabEnvironment) -> None:
    order = queue_tab(tab_env)
    assert complete_tab(tab_env, order, tab_receipt(tab_env, order)).status_code == 200
    assert tab_env.bridge.queue_tab_command(tab_env.job_id, tab_payload(tab_env)) == order
    assert read_execution(tab_env, order)["status"] == "completed"
    assert not tab_env.bridge.has_pending()


def test_other_running_job_blocks_tab_command(tab_env: TabEnvironment) -> None:
    tab_env.bridge.queue_product(_manual_product_job_payload(suffix="foreign-running"))
    before = tab_env.bridge._mutable_state_snapshot_locked()
    with pytest.raises(FactorySyncError, match="factory_worker_busy"):
        tab_env.bridge.queue_tab_command(tab_env.job_id, tab_payload(tab_env))
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


@pytest.mark.parametrize("path,value", [
    (("schema",), "foreign"), (("jobId",), "foreign"), (("tabId",), "fields"),
    (("action",), "commitField"), (("status",), "failed"),
    (("checkpoint",), None), (("checkpoint", "jobId"), "foreign"),
    (("checkpoint", "stageKey"), "sections"), (("checkpoint", "status"), "completed"),
    (("checkpoint", "revision"), 999), (("checkpoint", "savedAt"), 0),
    (("projection", "registration", "jobId"), "foreign"),
    (("projection", "session", "workspaceId"), "batch:foreign"),
    (("projection", "session", "runId"), "foreign"),
    (("projection", "session", "inputFingerprint"), "foreign"),
    (("projection", "session", "productId"), "cafe24:3001"),
    (("projection", "session", "productKey"), "foreign"),
    (("projection", "session", "revision"), 9),
    (("projection", "session", "storeRevision"), 19),
    (("projection", "storage", "ok"), False),
    (("projection", "storage", "warning"), "write failed"),
    (("projection", "outputs"), []), (("projection", "stages"), []),
])
def test_foreign_stale_unsaved_or_reduced_receipt_is_rejected(tab_env, path, value):
    order = queue_tab(tab_env)
    receipt = tab_receipt(tab_env, order)
    target = receipt
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    before = tab_env.bridge._mutable_state_snapshot_locked()
    disk_before = tab_env.state_path.read_bytes()
    response = complete_tab(tab_env, order, receipt)
    assert response.status_code in {409, 422}, response.get_json()
    assert tab_env.bridge._mutable_state_snapshot_locked() == before
    assert tab_env.state_path.read_bytes() == disk_before
    assert read_execution(tab_env, order)["receipt"] is None


@pytest.mark.parametrize("field", ["orderId", "operationToken", "idempotencyKey", "workerSessionId", "workerId", "productId"])
def test_lifecycle_fences_the_exact_order_and_worker(tab_env, field):
    order = queue_tab(tab_env)
    before = tab_env.bridge._mutable_state_snapshot_locked()
    response = tab_env.client.post(f"/api/worker/{order['orderId']}/complete", json={
        **order, "workerId": "factory-worker-live", "eventSequence": 2,
        "result": tab_receipt(tab_env, order), field: "foreign",
    }, headers=tab_env.headers)
    assert response.status_code in {409, 422}
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


def test_failed_worker_restores_previous_status_and_hides_error_payload(tab_env: TabEnvironment) -> None:
    before = tab_env.bridge.product_job_context(tab_env.job_id)
    order = queue_tab(tab_env)
    response = tab_env.client.post(f"/api/worker/{order['orderId']}/fail", json={
        **order, "workerId": "factory-worker-live", "eventSequence": 2,
        "error": "Bearer deliberately-secret-error",
    }, headers=tab_env.headers)
    assert response.status_code == 200
    assert tab_env.bridge.product_job_context(tab_env.job_id) == before
    status = read_execution(tab_env, order)
    assert status["status"] == "failed" and status["receipt"] is None
    assert "deliberately-secret" not in str(status)
    assert not tab_env.bridge.has_pending()


def test_status_rejects_foreign_job_and_duplicate_completion(tab_env: TabEnvironment) -> None:
    order = queue_tab(tab_env)
    assert tab_env.client.get(f"/api/factory/jobs/foreign/tab-command/{order['orderId']}").status_code == 404
    receipt = tab_receipt(tab_env, order)
    assert complete_tab(tab_env, order, receipt).status_code == 200
    before = tab_env.bridge._mutable_state_snapshot_locked()
    assert complete_tab(tab_env, order, receipt).status_code == 409
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


@pytest.mark.parametrize("phase", ["queue", "complete"])
def test_failed_atomic_save_rolls_back_reservation_receipt_and_job(tab_env, monkeypatch, phase):
    order = queue_tab(tab_env) if phase == "complete" else None
    before = tab_env.bridge._mutable_state_snapshot_locked()
    disk_before = tab_env.state_path.read_bytes()

    def reject_replace(source: Path, target: Path) -> None:
        raise OSError("simulated persistence failure")

    monkeypatch.setattr(Path, "replace", reject_replace)
    if order is None:
        with pytest.raises(FactorySyncError, match="factory_product_state_write_failed"):
            tab_env.bridge.queue_tab_command(tab_env.job_id, tab_payload(tab_env))
    else:
        assert complete_tab(tab_env, order, tab_receipt(tab_env, order)).status_code == 422
    assert tab_env.bridge._mutable_state_snapshot_locked() == before
    assert tab_env.state_path.read_bytes() == disk_before


def test_projection_sync_cannot_commit_progress_before_receipt(tab_env: TabEnvironment) -> None:
    order = queue_tab(tab_env)
    incoming = tab_receipt(tab_env, order)["projection"]
    incoming["stages"][0]["selectedIds"] = ["representative-b"]
    before = tab_env.bridge._mutable_state_snapshot_locked()
    with pytest.raises(FactorySyncError, match="factory_tab_command_pending"):
        tab_env.bridge.accept_projection(incoming)
    assert tab_env.bridge._mutable_state_snapshot_locked() == before


def test_expired_worker_restores_job_without_requeuing(tab_env: TabEnvironment, monkeypatch) -> None:
    before = tab_env.bridge.product_job_context(tab_env.job_id)
    order = queue_tab(tab_env)
    expired = tab_env.bridge._clock() + 901
    monkeypatch.setattr(tab_env.bridge, "_clock", lambda: expired)
    status = read_execution(tab_env, order)
    assert status["status"] == "failed"
    assert tab_env.bridge.product_job_context(tab_env.job_id) == before
    assert not tab_env.bridge.has_pending()


def test_replacement_worker_cannot_replay_tab_command(tab_env: TabEnvironment) -> None:
    before = tab_env.bridge.product_job_context(tab_env.job_id)
    order = queue_tab(tab_env)
    hello = _hello(session_id="new-worker")
    hello.update(startedAt=2000, projection=deepcopy(tab_env.projection))
    tab_env.bridge.hello(hello)
    assert read_execution(tab_env, order)["status"] == "failed"
    assert tab_env.bridge.product_job_context(tab_env.job_id) == before
    assert complete_tab(tab_env, order, tab_receipt(tab_env, order)).status_code in {409, 422}
    assert not tab_env.bridge.has_pending()
