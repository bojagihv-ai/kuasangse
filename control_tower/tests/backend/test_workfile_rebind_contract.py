from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError
from control_tower.backend.runtime_cache import JsonObject


def _text(value: JsonObject, key: str) -> str:
    result = value.get(key)
    assert isinstance(result, str)
    return result


def _integer(value: JsonObject, key: str) -> int:
    result = value.get(key)
    assert type(result) is int
    return result


def _mapping(value: JsonObject, key: str) -> JsonObject:
    result = value.get(key)
    assert isinstance(result, dict)
    return result


def _worker() -> JsonObject:
    return {
        "workerId": "factory-worker-live",
        "sessionId": "factory-session-live",
        "contractVersion": "control-work-order:v1",
        "capabilityVersion": "batch-control-worker:v1",
    }


def _projection(job_id: str, *, revision: int, run_id: str) -> JsonObject:
    session: JsonObject = {
        "workspaceId": f"batch:{job_id}",
        "productId": f"factory:{job_id}",
        "productKey": job_id,
        "runId": run_id,
        "inputFingerprint": f"sha256:{job_id}",
        "revision": revision,
    }
    candidate_a: JsonObject = {"id": "representative-a"}
    candidate_b: JsonObject = {"id": "representative-b"}
    stage: JsonObject = {
        "key": "representative",
        "status": "connected",
        "selectedIds": ["representative-a"],
        "candidates": [candidate_a, candidate_b],
    }
    return {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": revision,
        "cursor": str(revision),
        "connected": True,
        "session": session,
        "inputs": [],
        "stages": [stage],
        "progress": {"stageKey": "representative", "percent": 50, "status": "manual"},
        "registration": {"status": "blocked", "blockers": ["final_detail_a_cut"], "jobId": job_id},
    }


def _hello() -> JsonObject:
    projection = _projection("placeholder", revision=1, run_id="placeholder-run")
    return {
        "schema": "factory-worker-session:v1",
        "sessionId": "factory-session-live",
        "workerId": "factory-worker-live",
        "buildId": "build-live",
        "capabilityVersion": "batch-control-worker:v1",
        "factoryCapabilityVersion": "factory-control-command:v1",
        "startedAt": 1000,
        "cursor": 1,
        "projection": projection,
    }


def _job_payload(suffix: str) -> JsonObject:
    required_values: JsonObject = {
        "material": "스테인리스",
        "originCountry": "대한민국",
        "size": "20cm",
        "salePrice": "12000",
        "usage": "주방용",
        "optionMode": "provided",
    }
    image: JsonObject = {
        "role": "base",
        "ordinal": 1,
        "name": "정면",
        "fileName": "front.png",
        "sha256": "fixture-sha",
        "dataUrl": "data:image/png;base64,aGVsbG8=",
    }
    return {
        "contractType": "manual-product-intake",
        "contractVersion": "1.0.0",
        "batchId": "batch-direct-input",
        "idempotencyKey": f"typed-rebind-{suffix}",
        "mode": "manual",
        "imageModel": "gemini-3.1-flash-image",
        "source": {"kind": "manual"},
        "productName": f"직접 입력 제품 {suffix}",
        "category": "주방",
        "requiredValues": required_values,
        "inputImages": [image],
    }


def _checkpoint(job_id: str, projection: JsonObject) -> JsonObject:
    session = _mapping(projection, "session")
    return {
        "schema": "factory-product-checkpoint:v1",
        "jobId": job_id,
        "projectId": f"batch:{job_id}",
        "productId": _text(session, "productId"),
        "productKey": _text(session, "productKey"),
        "runId": _text(session, "runId"),
        "inputFingerprint": _text(session, "inputFingerprint"),
        "revision": _integer(session, "revision"),
        "status": "blocked",
        "stageKey": "representative",
        "savedAt": 1,
    }


@dataclass(frozen=True, slots=True)
class _BlockedRebind:
    bridge: FactorySyncBridge
    job_id: str
    worker: JsonObject
    checkpoint: JsonObject
    payload: JsonObject


def _blocked_rebind(tmp_path: Path, suffix: str) -> _BlockedRebind:
    bridge = FactorySyncBridge(state_path=tmp_path / "factory-product-jobs.json")
    bridge.hello(_hello())
    worker = _worker()
    queued = bridge.queue_product(_job_payload(suffix))
    job_id = _text(queued, "jobId")
    order_value = bridge.claim(worker).get("order")
    assert isinstance(order_value, dict)
    order_id = _text(order_value, "orderId")
    worker_id = _text(worker, "workerId")
    bridge.lifecycle(
        order_id,
        "ack",
        {**order_value, "workerId": worker_id, "accepted": True, "eventSequence": 1},
    )
    old_projection = _projection(job_id, revision=20, run_id="old-run")
    bridge.lifecycle(
        order_id,
        "complete",
        {
            **order_value,
            "workerId": worker_id,
            "eventSequence": 2,
            "result": {
                "schema": "factory-product-run-receipt:v1",
                "jobId": job_id,
                "status": "blocked",
                "stageKey": "representative",
                "message": "old checkpoint blocked",
                "projection": old_projection,
                "checkpoint": _checkpoint(job_id, old_projection),
            },
        },
    )
    checkpoint = _mapping(bridge.product_job_context(job_id), "checkpoint")
    workfile_text = '{"format":"kuasangse.factory.project","version":1}'
    payload: JsonObject = {
        "fileName": "authorized-b.kuasangse",
        "workfileText": workfile_text,
        "expectedSha256": sha256(workfile_text.encode("utf-8")).hexdigest(),
        "expectedWorkspaceId": f"batch:{job_id}",
        "expectedProductId": _text(checkpoint, "productId"),
        "expectedProductKey": _text(checkpoint, "productKey"),
        "expectedRunId": "new-run",
        "expectedInputFingerprint": _text(checkpoint, "inputFingerprint"),
        "expectedWorkfileRevision": 20,
        "expectedHydratedWorkfileRevision": 87,
        "expectedCheckpointRevision": 20,
        "expectedCheckpointRunId": "old-run",
        "idempotencyKey": f"typed-rebind-{suffix}",
    }
    return _BlockedRebind(bridge, job_id, worker, checkpoint, payload)


def _acknowledged_hydration(fixture: _BlockedRebind) -> JsonObject:
    order = fixture.bridge.queue_product_workfile_rebind(fixture.job_id, fixture.payload)
    claimed_value = fixture.bridge.claim(fixture.worker).get("order")
    assert isinstance(claimed_value, dict)
    assert _text(claimed_value, "orderId") == _text(order, "orderId")
    fixture.bridge.lifecycle(
        _text(claimed_value, "orderId"),
        "ack",
        {
            **claimed_value,
            "workerId": _text(fixture.worker, "workerId"),
            "accepted": True,
            "eventSequence": 1,
        },
    )
    return claimed_value


def _hydration_complete(fixture: _BlockedRebind, order: JsonObject, projection: JsonObject) -> JsonObject:
    return {
        **order,
        "workerId": _text(fixture.worker, "workerId"),
        "eventSequence": 2,
        "result": {
            "schema": "factory-workfile-hydration-receipt:v1",
            "capabilityVersion": "factory-workfile-hydration-command:v1",
            "workfileSha256": _text(fixture.payload, "expectedSha256"),
            "projectId": _text(fixture.payload, "expectedWorkspaceId"),
            "name": _text(fixture.payload, "expectedProductKey"),
            "projection": projection,
        },
    }


def test_rebind_commits_verified_checkpoint_preserves_job_and_binds_resume(tmp_path: Path) -> None:
    # Given: a blocked B job and its authorized workfile hydration order.
    fixture = _blocked_rebind(tmp_path, "happy")
    claimed = _acknowledged_hydration(fixture)
    projection = _projection(fixture.job_id, revision=87, run_id="new-run")

    # When: the worker completes with the authorized hydrated projection.
    fixture.bridge.lifecycle(_text(claimed, "orderId"), "complete", _hydration_complete(fixture, claimed, projection))

    # Then: the new checkpoint persists, rebind replay is idempotent, and stale resume is rejected before mutation.
    context = fixture.bridge.product_job_context(fixture.job_id)
    rebound = _mapping(context, "checkpoint")
    assert _integer(rebound, "revision") == 87
    assert _text(rebound, "runId") == "new-run"
    required_values = _mapping(_mapping(context, "payload"), "requiredValues")
    assert required_values == {
        **_mapping(_job_payload("happy"), "requiredValues"),
        "category": "주방",
    }
    replay = fixture.bridge.queue_product_workfile_rebind(fixture.job_id, fixture.payload)
    assert replay.get("idempotent") is True
    before_resume = (tmp_path / "factory-product-jobs.json").read_bytes()
    try:
        fixture.bridge.resume_product(
            fixture.job_id,
            expected_checkpoint_revision=86,
            expected_checkpoint_run_id="new-run",
        )
    except FactorySyncError as error:
        assert error.code == "stale_product_checkpoint"
    else:
        raise AssertionError("stale rebound resume must fail")
    assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_resume
    fixture.bridge.resume_product(
        fixture.job_id,
        expected_checkpoint_revision=87,
        expected_checkpoint_run_id="new-run",
    )
    resumed = fixture.bridge.claim(fixture.worker).get("order")
    assert isinstance(resumed, dict)
    command = _mapping(resumed, "command")
    command_payload = _mapping(command, "payload")
    assert _mapping(command_payload, "checkpoint") == rebound


def test_rebind_rejects_admission_and_reduced_hydration_without_durable_mutation(tmp_path: Path) -> None:
    # Given: a blocked B job, its authoritative request, and an unchanged durable baseline.
    fixture = _blocked_rebind(tmp_path, "negative")
    before_bytes = (tmp_path / "factory-product-jobs.json").read_bytes()
    probes: tuple[tuple[JsonObject, str], ...] = (
        ({**fixture.payload, "expectedWorkspaceId": "batch:foreign"}, "factory_workfile_rebind_identity_mismatch"),
        ({**fixture.payload, "expectedProductId": "factory:foreign"}, "factory_workfile_rebind_identity_mismatch"),
        ({**fixture.payload, "expectedProductKey": "foreign"}, "factory_workfile_rebind_identity_mismatch"),
        ({**fixture.payload, "expectedInputFingerprint": "sha256:foreign"}, "factory_workfile_rebind_identity_mismatch"),
        ({**fixture.payload, "expectedSha256": "0" * 64}, "factory_workfile_digest_mismatch"),
        ({**fixture.payload, "expectedCheckpointRevision": 19}, "stale_product_checkpoint"),
    )

    # When: admission identity probes and a selected-cut-reducing hydration completion are attempted.
    for probe, code in probes:
        try:
            fixture.bridge.queue_product_workfile_rebind(fixture.job_id, probe)
        except FactorySyncError as error:
            assert error.code == code
        else:
            raise AssertionError(f"invalid rebind must fail: {code}")
        assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_bytes
    claimed = _acknowledged_hydration(fixture)
    reduced = _projection(fixture.job_id, revision=87, run_id="new-run")
    stages = reduced.get("stages")
    assert isinstance(stages, list) and stages
    stage = stages[0]
    assert isinstance(stage, dict)
    stage["selectedIds"] = []
    before_projection = deepcopy(fixture.bridge._projection)
    before_executions = deepcopy(fixture.bridge._executions)
    before_events = deepcopy(fixture.bridge._events)
    try:
        fixture.bridge.lifecycle(_text(claimed, "orderId"), "complete", _hydration_complete(fixture, claimed, reduced))
    except FactorySyncError as error:
        assert error.code == "factory_workfile_rebind_protected_state_reduced"
    else:
        raise AssertionError("reduced selected state must fail")

    # Then: no partial checkpoint rebind or durable target mutation is committed.
    assert fixture.bridge._projection == before_projection
    assert fixture.bridge._executions == before_executions
    assert fixture.bridge._events == before_events
    assert _mapping(fixture.bridge.product_job_context(fixture.job_id), "checkpoint") == fixture.checkpoint
    assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_bytes

    # Then: a durable-write failure also rolls back the complete rebind transaction.
    preserved = _projection(fixture.job_id, revision=87, run_id="new-run")
    with patch.object(
        fixture.bridge,
        "_persist_product_jobs_locked",
        side_effect=FactorySyncError("factory_product_state_write_failed"),
    ):
        try:
            fixture.bridge.lifecycle(
                _text(claimed, "orderId"),
                "complete",
                _hydration_complete(fixture, claimed, preserved),
            )
        except FactorySyncError as error:
            assert error.code == "factory_product_state_write_failed"
        else:
            raise AssertionError("durable write failure must roll back rebind")
    assert fixture.bridge._projection == before_projection
    assert fixture.bridge._executions == before_executions
    assert fixture.bridge._events == before_events
    assert _mapping(fixture.bridge.product_job_context(fixture.job_id), "checkpoint") == fixture.checkpoint
    assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_bytes


def test_rebind_binds_full_old_checkpoint_identity_at_commit(tmp_path: Path) -> None:
    # Given: a blocked B job with a queued workfile hydration bound to its old checkpoint.
    fixture = _blocked_rebind(tmp_path, "identity")
    claimed = _acknowledged_hydration(fixture)
    projection = _projection(fixture.job_id, revision=87, run_id="new-run")

    # When: any old checkpoint identity member changes after admission and before completion.
    for field, value in (
        ("jobId", "factory-job-drifted"),
        ("projectId", "batch:factory-job-drifted"),
        ("productId", "factory:drifted"),
        ("productKey", "drifted"),
        ("inputFingerprint", "sha256:drifted"),
        ("revision", 19),
        ("runId", "old-run-drifted"),
    ):
        drifted = {**fixture.checkpoint, field: value}
        fixture.bridge._product_jobs[fixture.job_id].checkpoint = drifted
        fixture.bridge._persist_product_jobs_locked()
        before_context = fixture.bridge.product_job_context(fixture.job_id)
        before_receipt = deepcopy(fixture.bridge._product_jobs[fixture.job_id].checkpoint_rebind_receipt)
        before_projection = deepcopy(fixture.bridge._projection)
        before_executions = deepcopy(fixture.bridge._executions)
        before_events = deepcopy(fixture.bridge._events)
        before_bytes = (tmp_path / "factory-product-jobs.json").read_bytes()
        try:
            fixture.bridge.lifecycle(_text(claimed, "orderId"), "complete", _hydration_complete(fixture, claimed, projection))
        except FactorySyncError as error:
            assert error.code == "stale_product_checkpoint"
        else:
            raise AssertionError(f"identity drift must fail: {field}")
        assert fixture.bridge._projection == before_projection
        assert fixture.bridge._executions == before_executions
        assert fixture.bridge._events == before_events
        assert fixture.bridge.product_job_context(fixture.job_id) == before_context
        assert fixture.bridge._product_jobs[fixture.job_id].checkpoint_rebind_receipt == before_receipt
        assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_bytes


def test_rebind_worker_failures_leave_target_uncommitted_and_retryable(tmp_path: Path) -> None:
    # Given: a blocked B job with an acknowledged hydration worker order.
    fixture = _blocked_rebind(tmp_path, "cancel")
    claimed = _acknowledged_hydration(fixture)
    before_context = fixture.bridge.product_job_context(fixture.job_id)
    before_projection = deepcopy(fixture.bridge._projection)
    before_bytes = (tmp_path / "factory-product-jobs.json").read_bytes()

    # When: the real worker fail boundary reports malformed, timeout, or browser-abort cancellation.
    for failure_code in ("workfile_json_invalid", "factory_workfile_hydration_timeout", "AbortError"):
        event_count = len(fixture.bridge._events)
        fixture.bridge.lifecycle(
            _text(claimed, "orderId"),
            "fail",
            {**claimed, "workerId": _text(fixture.worker, "workerId"), "eventSequence": 2, "error": failure_code},
        )
        assert fixture.bridge._projection == before_projection
        assert fixture.bridge.product_job_context(fixture.job_id) == before_context
        assert (tmp_path / "factory-product-jobs.json").read_bytes() == before_bytes
        assert len(fixture.bridge._events) == event_count + 1
        assert fixture.bridge._events[-1]["type"] == "factory.worker.failed"
        retried = _acknowledged_hydration(fixture)
        assert _text(retried, "orderId") == _text(claimed, "orderId")
        claimed = retried
