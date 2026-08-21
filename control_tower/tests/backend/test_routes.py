from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from collections.abc import Mapping
import hashlib
from io import BytesIO
import json
from pathlib import Path
from threading import Thread
from typing import Final

from flask import Flask
from PIL import Image
import requests
from werkzeug.serving import make_server

from control_tower.backend.app import create_app
from control_tower.backend.cafe24_bridge import QueuedCafe24CommandBridge, build_cafe24_command
from control_tower.backend.cafe24_staging import SAFE_DEFAULTS, build_preview
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError
from control_tower.backend.gpt_oauth import build_evidence_bundle
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.routes import ExternalDependencyError, _factory_history_snapshot, _factory_stage_candidates, _history_asset_key, _history_entry_path, _history_load_manifest, _history_selection_state, _history_thumbnail, register_routes
from control_tower.backend.runtime_cache import JsonObject, JsonValue


def test_factory_history_thumbnail_bounds_large_originals() -> None:
    # Given: 상세페이지처럼 세로로 매우 긴 원본 이미지를 준비한다.
    original = Image.new("RGB", (1905, 16219), (240, 180, 80))
    source = BytesIO()
    original.save(source, format="JPEG", quality=90)

    # When: 생산관제 목록용 썸네일을 만든다.
    mime_type, thumbnail = _history_thumbnail(source.getvalue(), "image/jpeg")

    # Then: 원본을 유지하면서 카드 표시용 크기로 제한되어야 한다.
    assert mime_type == "image/jpeg"
    with Image.open(BytesIO(thumbnail)) as rendered:
        assert rendered.width <= 480
        assert rendered.height <= 360
        assert rendered.width * rendered.height < original.width * original.height / 100


def test_factory_history_thumbnail_uses_placeholder_when_source_is_not_decodable() -> None:
    original = b"not-an-image" * 1000

    mime_type, thumbnail = _history_thumbnail(original, "application/octet-stream")

    assert mime_type == "image/svg+xml"
    assert thumbnail != original
    assert len(thumbnail) < len(original)


def test_factory_history_manifest_binds_job_workspace_product_and_run(tmp_path: Path) -> None:
    workfile_dir = tmp_path / "작업파일별" / "상품_batch_job-1"
    workfile_dir.mkdir(parents=True)
    (workfile_dir / "manifest.json").write_text(
        '{"workspaceId":"batch:job-1","productKey":"상품","runId":"run-1","assets":[]}',
        encoding="utf-8",
    )

    loaded_dir, records = _history_load_manifest(
        tmp_path,
        "상품",
        "batch:job-1",
        "상품",
        "run-1",
        "job-1",
    )

    assert loaded_dir == workfile_dir
    assert records == []
    try:
        _history_load_manifest(tmp_path, "상품", "batch:job-1", "상품", "run-2", "job-1")
    except FactorySyncError as error:
        assert str(error) == "factory_history_identity_mismatch"
    else:
        raise AssertionError("run identity mismatch must be rejected")


def test_factory_history_reads_current_local_archive_workfile_for_blocked_job(tmp_path: Path) -> None:
    workspace_id = "batch:job-1"
    workfile_dir = tmp_path / "workfiles" / f"batch_job-1__{hashlib.sha256(workspace_id.encode()).hexdigest()[:12]}"
    image_path = workfile_dir / "assets" / "상품" / "old-run" / "hero-images" / "hero.png"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"png")
    (workfile_dir / "manifest.json").write_text(
        json.dumps({
            "version": 1,
            "workspaceId": workspace_id,
            "workfileFolder": str(workfile_dir),
            "assets": [{
                "productKey": "상품",
                "currentRunId": "old-run",
                "category": "hero-images",
                "stageId": "hero",
                "assetKind": "hero",
                "title": "대표 후보",
                "contentHash": "hero-hash",
                "files": {"imagePath": str(image_path)},
            }],
        }),
        encoding="utf-8",
    )

    class HistoryFactory:
        def product_job_context(self, job_id: str) -> dict[str, object]:
            assert job_id == "job-1"
            return {
                "job": {},
                "payload": {"productName": "상품", "inputImages": []},
                "checkpoint": {
                    "projectId": workspace_id,
                    "productKey": "상품",
                    "runId": "current-run",
                    "revision": 7,
                },
            }

    loaded_dir, records = _history_load_manifest(
        tmp_path,
        "상품",
        workspace_id,
        "상품",
        "current-run",
        "job-1",
    )
    work_bundle, history, _payload, resolved_dir = _factory_history_snapshot(HistoryFactory(), tmp_path, "job-1")

    assert loaded_dir == workfile_dir
    assert _history_entry_path(loaded_dir, records[0]) == image_path
    assert resolved_dir == workfile_dir
    assert work_bundle["assets"][0]["role"] == "hero"
    assert work_bundle["assets"][0]["factoryStageKey"] == "representative"
    assert history["workfileFolderName"] == workfile_dir.name


def test_factory_history_asset_route_resolves_current_v2_manifest_image_path(tmp_path: Path) -> None:
    workspace_id = "batch:job-1"
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    workfile_dir = archive_root / "workfiles" / f"batch_job-1__{hashlib.sha256(workspace_id.encode()).hexdigest()[:12]}"
    image_path = workfile_dir / "assets" / "상품" / "run-1" / "09_OUTPUT_대표이미지" / "hero.png"
    image_path.parent.mkdir(parents=True)
    image = Image.new("RGB", (8, 6), (240, 180, 80))
    image.save(image_path, format="PNG")
    (workfile_dir / "manifest.json").write_text(
        json.dumps({
            "version": 2,
            "workspaceId": workspace_id,
            "assets": [{
                "productKey": "상품",
                "currentRunId": "run-1",
                "category": "09_OUTPUT_대표이미지",
                "stageId": "hero",
                "title": "대표 후보",
                "contentHash": "hero-hash",
                "sourceKey": "hero-source",
                "files": {"imagePath": str(image_path)},
            }],
        }),
        encoding="utf-8",
    )

    class HistoryFactory:
        def product_job_context(self, job_id: str) -> JsonObject:
            assert job_id == "job-1"
            return {
                "job": {},
                "payload": {"productName": "상품", "inputImages": []},
                "checkpoint": {
                    "projectId": workspace_id,
                    "productKey": "상품",
                    "runId": "run-1",
                    "revision": 7,
                },
            }

    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)})
    client = create_app(
        config,
        pdp_api=FakePdpApi(),
        cafe24_bridge=FakeCafe24Bridge(),
        factory_sync_bridge=HistoryFactory(),
    ).test_client()

    history_response = client.get("/api/factory/jobs/job-1/history")

    assert history_response.status_code == 200
    history_json = history_response.get_json()
    output_asset = history_json["workBundle"]["assets"][0]
    asset_key = _history_asset_key("09_OUTPUT_대표이미지", "", "hero-hash", "hero-source")
    assert output_asset["id"] == asset_key
    response_text = history_response.get_data(as_text=True)
    assert "imagePath" not in response_text
    assert str(image_path) not in response_text

    image_response = client.get(f"/api/factory/jobs/job-1/history/assets/{asset_key}/image")
    thumbnail_response = client.get(f"/api/factory/jobs/job-1/history/assets/{asset_key}/thumbnail")

    assert image_response.status_code == 200
    assert image_response.content_type.startswith("image/")
    assert image_response.data == image_path.read_bytes()
    assert thumbnail_response.status_code == 200
    assert thumbnail_response.content_type.startswith("image/")
    assert thumbnail_response.data


def test_factory_history_route_canonicalizes_work_bundle_key_while_preserving_raw_workspace_id(tmp_path: Path) -> None:
    # Given: factory checkpoint의 raw workspace identity와 일치하는 보관소 manifest가 있다.
    workspace_id = "batch:job-1"
    cache_root = tmp_path / "cache"
    archive_root = tmp_path / "local-archive"
    workfile_dir = archive_root / "workfiles" / f"batch_job-1__{hashlib.sha256(workspace_id.encode()).hexdigest()[:12]}"
    workfile_dir.mkdir(parents=True)
    (workfile_dir / "manifest.json").write_text(
        json.dumps({"version": 2, "workspaceId": workspace_id, "assets": []}),
        encoding="utf-8",
    )

    class HistoryFactory:
        def product_job_context(self, job_id: str) -> JsonObject:
            assert job_id == "job-1"
            return {
                "job": {},
                "payload": {"productName": "상품", "inputImages": []},
                "checkpoint": {
                    "projectId": workspace_id,
                    "productKey": "상품",
                    "runId": "run-1",
                    "revision": 7,
                },
            }

    client = create_app(
        ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(cache_root)}),
        pdp_api=FakePdpApi(),
        cafe24_bridge=FakeCafe24Bridge(),
        factory_sync_bridge=HistoryFactory(),
    ).test_client()

    # When: completed factory-job history HTTP projection을 읽는다.
    response = client.get("/api/factory/jobs/job-1/history")

    # Then: PDP 선택 키만 canonical 형식이고 history identity는 raw 형식을 보존한다.
    assert response.status_code == 200
    response_json = response.get_json()
    assert response_json["workBundle"]["bundleKey"] == "kuasangse:batch:job-1"
    assert response_json["history"]["workspaceId"] == "batch:job-1"


def test_factory_history_marks_source_cut_when_final_archive_contains_same_file_or_hash() -> None:
    assert _history_selection_state(
        "09_OUTPUT_대표이미지",
        content_hash="hero-hash",
        final_hashes={"hero-hash"},
    ) == "selected"
    assert _history_selection_state(
        "11_OUTPUT_사이즈컷",
        file_name="size.png",
        final_files={"size.png"},
    ) == "selected"
    assert _history_selection_state(
        "10_OUTPUT_이미지컷",
        content_hash="cut-hash",
        final_hashes={"other-hash"},
    ) == "candidate"
def test_factory_candidates_keep_thumbnail_reference_for_gpt_evidence() -> None:
    candidates = _factory_stage_candidates(
        {
            "stages": [{
                "key": "representative",
                "candidates": [{
                    "id": "representative-a",
                    "assetId": "asset-a",
                    "digest": "sha256:a",
                    "thumbnailUrl": "http://127.0.0.1/candidate-a.png",
                    "source": "factory",
                    "model": "factory-model",
                    "confidence": 0.88,
                    "rationale": "대표 구도와 상품명 가독성이 가장 좋음",
                }],
            }],
        },
        "representative",
    )

    evidence = build_evidence_bundle([], candidates)

    assert evidence["candidateRefs"][0]["thumbnailRef"] == "http://127.0.0.1/candidate-a.png"
    assert evidence["candidateRefs"][0]["rationale"] == "대표 구도와 상품명 가독성이 가장 좋음"
    assert evidence["candidateRefs"][0]["confidence"] == 0.88


class FakePdpApi:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.fail_external = False
        self.worker_payloads: list[tuple[str, str | None]] = []
        self.publication_receipts: list[JsonObject] = []
        self.publication_events: list[JsonObject] = []
        self.decision_receipts: list[JsonObject] = []
        self.review_queries: list[dict[str, str]] = []

    def create_job(self, payload: JsonObject) -> JsonObject:
        self.calls.append("create_job")
        if self.fail_external:
            raise ExternalDependencyError("pdp_unavailable")
        return {"jobId": "job-001", "status": "ready", "version": 1}

    def create_input_snapshot(self, payload: JsonObject) -> JsonObject:
        self.calls.append("create_input_snapshot")
        return {"id": "snapshot-001", "readiness": "ready", "replayed": False}

    def get_capabilities(self) -> JsonObject:
        self.calls.append("capabilities")
        return {"capabilityVersion": "1.1.0", "workerEchoFields": ["productId"]}

    def list_sources(self, query: dict[str, str]) -> JsonObject:
        self.calls.append("list_sources")
        return {
            "sources": [
                {
                    "jcode": 900001,
                    "productName": "테스트 접시",
                    "category": "도자기",
                    "imageCount": 3,
                    "detailPageCount": 1,
                },
            ],
            "inputKinds": ["manual", "db-selection"],
            "query": query,
        }

    def get_readiness(self, jcode: int) -> JsonObject:
        self.calls.append("get_readiness")
        return {
            "jcode": jcode,
            "ready": False,
            "missingFields": ["originCountry"],
            "warnings": ["spec-missing"],
        }

    def worker_claim(self, payload: JsonObject) -> JsonObject:
        self.worker_payloads.append(("claim", None))
        return {"claimed": False, "order": None}

    def worker_lifecycle(self, order_id: str, action: str, payload: JsonObject) -> JsonObject:
        self.worker_payloads.append((action, order_id))
        return {"status": action, "orderId": order_id}

    def list_jobs(self, query: dict[str, str]) -> JsonObject:
        self.calls.append("list_jobs")
        return {"items": [], "query": query}

    def get_job(self, job_id: str) -> JsonObject:
        return {"jobId": job_id, "status": "RUNNING", "eventSequence": 2}

    def list_reviews(self, query: dict[str, str]) -> JsonObject:
        self.calls.append("list_reviews")
        self.review_queries.append(query)
        return {"items": [], "query": query}

    def get_requirements(self, job_id: str) -> JsonObject:
        return {"jobId": job_id, "items": []}

    def create_decision(self, job_id: str, payload: JsonObject) -> JsonObject:
        self.decision_receipts.append(payload)
        return {"jobId": job_id, "decisionId": "decision-001", "replayed": False}

    def create_publication_receipt(self, job_id: str, payload: JsonObject) -> JsonObject:
        self.publication_receipts.append(payload)
        self.publication_events.append(
            {
                "id": "event-001",
                "jobId": job_id,
                "eventType": "publication.receipt.recorded",
                "payload": payload,
            },
        )
        return {
            "jobId": job_id,
            "receiptId": "receipt-001",
            "payloadDigest": payload.get("payloadDigest"),
            "observedPayloadDigest": payload.get("observedPayloadDigest"),
            "replayed": False,
        }

    def get_publication_events(self, job_id: str) -> JsonObject:
        return {"jobId": job_id, "events": list(self.publication_events)}


class FakeCafe24Bridge:
    def __init__(self) -> None:
        self.commands: list[JsonObject] = []
        self.preflight_calls = 0

    def inspect(self) -> JsonObject:
        self.preflight_calls += 1
        return {
            "schema": "factory-cafe24-preflight:v1",
            "status": "ready",
            "reason": "",
            "productId": "cafe24:2994",
            "productKey": "방울수저집",
            "htmlDigest": "canonical-html",
            "imageDigests": ["image-1"],
            "expectedWorkfileRevision": 108,
            "expectedRunId": "run-1",
            "expectedInputFingerprint": "fp-1",
        }

    def execute(self, command: JsonObject) -> JsonObject:
        self.commands.append(command)
        product_id = str(command["command"]["payload"].get("productId", ""))
        return {
            "status": "staged_verified",
            "payloadDigest": command["payloadDigest"],
            "remoteReadbackDigest": "remote-html-digest",
            "externalProductNo": product_id.removeprefix("cafe24:") or "fake-42",
            "remoteReadback": {
                "productNo": product_id.removeprefix("cafe24:") or "fake-42",
                "productCode": "P0000TEST",
                "productName": str(command["command"]["payload"].get("productKey", "")),
                "display": "F",
                "selling": "F",
                "marketSync": "F",
                "categoryIds": ["71"],
                "representativeImageCount": 4,
                "detailImageCount": 14,
                "optionValues": ["초록"],
                "variantCount": 1,
                "inventoryByOption": {"초록": {"quantity": "99", "useInventory": "T"}},
                "detailHtmlDigest": "detail-html-digest",
                "imageDigests": ["image-digest"],
                "updatedAt": "2026-08-15T15:39:40+09:00",
            },
            "idempotencyKey": command["idempotencyKey"],
        }


class FakeGptJudge:
    def __init__(self) -> None:
        self.calls: list[JsonObject] = []

    def judge(self, **kwargs) -> JsonObject:
        self.calls.append(kwargs)
        selected = kwargs["candidates"][1]["candidateId"]
        return {
            "receipt": {
                "model": "gpt-test",
                "reasoningEffort": kwargs["reasoning_effort"],
                "serviceTier": kwargs["service_tier"],
                "preset": kwargs["preset"],
                "judgement": {
                    "decision": "selected",
                    "selectedCandidateId": selected,
                    "confidence": 0.91,
                    "scoreGap": 0.2,
                    "riskFlags": [],
                    "rationale": "candidate evidence",
                    "scores": {
                        "sameProductLikelihood": 0.9,
                        "taskSuitability": 0.9,
                        "quality": 0.85,
                    },
                },
                "evidence": {},
            },
        }


def test_workfile_rebind_route_exposes_only_public_queue_or_receipt_fields() -> None:
    # Given: the route receives a service result containing worker-only and secret-shaped fields.
    class RebindFactory(FactorySyncBridge):
        def __init__(self) -> None:
            super().__init__()
            self.error_code = ""
            self.idempotent = False
            self.calls: list[JsonObject] = []

        def queue_product_workfile_rebind(
            self,
            job_id: str,
            payload: Mapping[str, JsonValue],
        ) -> JsonObject:
            self.calls.append({"jobId": job_id, "payload": dict(payload)})
            if self.error_code:
                raise FactorySyncError(self.error_code)
            if self.idempotent:
                return {
                    "accepted": True,
                    "idempotent": True,
                    "receipt": {
                        "schema": "factory-product-checkpoint-rebind-receipt:v1",
                        "jobId": job_id,
                        "workfileSha256": payload["expectedSha256"],
                        "oldRevision": 20,
                        "oldRunId": "run-old",
                        "newRevision": 87,
                        "newRunId": "run-new",
                        "checkpointDigest": "digest-1",
                        "operationToken": "receipt-worker-only",
                    },
                }
            return {
                "orderId": "factory-workfile-1",
                "productId": "factory:job-1",
                "productKey": "job-1",
                "currentRunId": "run-new",
                "expectedWorkfileRevision": 20,
                "command": {"payload": {"workfileText": payload["workfileText"]}},
                "operationToken": "worker-only-operation",
                "workerHttpSessionId": "worker-session-only",
                "workfileText": payload["workfileText"],
                "filePath": "C:/private/authorized-b.kuasangse",
                "csrfToken": "csrf-private",
                "approvalToken": "approval-private",
            }

    factory = RebindFactory()
    app = Flask(__name__)
    register_routes(app, factory_sync_bridge=factory)
    client = app.test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    workfile_text = '{"format":"kuasangse.factory.project","version":1}'
    payload = {
        "fileName": "authorized-b.kuasangse",
        "workfileText": workfile_text,
        "expectedSha256": hashlib.sha256(workfile_text.encode("utf-8")).hexdigest(),
        "expectedWorkspaceId": "batch:job-1",
        "expectedProductId": "factory:job-1",
        "expectedProductKey": "job-1",
        "expectedRunId": "run-new",
        "expectedInputFingerprint": "sha256:job-1",
        "expectedWorkfileRevision": 20,
        "expectedHydratedWorkfileRevision": 87,
        "expectedCheckpointRevision": 20,
        "expectedCheckpointRunId": "run-old",
        "idempotencyKey": "rebind-job-1-20-87",
    }

    # When: a valid rebind is admitted through the public HTTP route.
    accepted = client.post(
        "/api/factory/jobs/job-1/workfile-rebind",
        json=payload,
        headers=headers,
    )

    # Then: only the stable admission identity is public; workfile and worker internals stay server-side.
    assert accepted.status_code == 202
    assert accepted.get_json() == {
        "accepted": True,
        "status": "queued",
        "order": {
            "jobId": "job-1",
            "orderId": "factory-workfile-1",
            "workspaceId": "batch:job-1",
            "productId": "factory:job-1",
            "productKey": "job-1",
            "workfileSha256": payload["expectedSha256"],
            "runId": "run-new",
            "workfileRevision": 20,
            "hydratedWorkfileRevision": 87,
            "checkpointRevision": 20,
            "checkpointRunId": "run-old",
        },
    }
    response_text = accepted.get_data(as_text=True)
    for private_value in (
        workfile_text,
        "C:/private/authorized-b.kuasangse",
        "worker-only-operation",
        "worker-session-only",
        "csrf-private",
        "approval-private",
    ):
        assert private_value not in response_text

    factory.idempotent = True
    replay = client.post(
        "/api/factory/jobs/job-1/workfile-rebind",
        json=payload,
        headers=headers,
    )
    assert replay.status_code == 200
    assert replay.get_json() == {
        "accepted": True,
        "idempotent": True,
        "status": "rebound",
        "receipt": {
            "schema": "factory-product-checkpoint-rebind-receipt:v1",
            "jobId": "job-1",
            "workfileSha256": payload["expectedSha256"],
            "oldRevision": 20,
            "oldRunId": "run-old",
            "newRevision": 87,
            "newRunId": "run-new",
            "checkpointDigest": "digest-1",
        },
    }
    assert "receipt-worker-only" not in replay.get_data(as_text=True)
    factory.idempotent = False

    # When: CSRF, malformed request, missing job, stale checkpoint, and idempotency conflicts are requested.
    rejected_csrf = client.post("/api/factory/jobs/job-1/workfile-rebind", json=payload)
    rejected_shape = client.post(
        "/api/factory/jobs/job-1/workfile-rebind",
        json={**payload, "unexpected": "field"},
        headers=headers,
    )
    typed_responses = []
    for error_code in (
        "factory_product_job_not_found",
        "stale_product_checkpoint",
        "idempotency_conflict",
    ):
        factory.error_code = error_code
        typed_responses.append(
            client.post(
                "/api/factory/jobs/job-1/workfile-rebind",
                json=payload,
                headers=headers,
            )
        )

    # Then: synchronous failures are typed and sanitized without invoking a worker.
    assert rejected_csrf.status_code == 428
    assert rejected_shape.status_code == 422
    assert [response.status_code for response in typed_responses] == [404, 409, 409]
    for response in [rejected_shape, *typed_responses]:
        body = response.get_json()
        assert set(body) == {"error"}
        assert set(body["error"]) == {"code", "message", "retryable", "correlationId"}
        assert "workfileText" not in response.get_data(as_text=True)

    # When: resume identity fields cross the HTTP boundary with the wrong JSON types.
    invalid_resume_responses = [
        client.post(
            "/api/factory/jobs/job-1/resume",
            json=invalid_payload,
            headers=headers,
        )
        for invalid_payload in (
            {"imageModel": 1},
            {"expectedCheckpointRevision": "20"},
            {"expectedCheckpointRevision": True},
            {"expectedCheckpointRunId": 20},
        )
    ]

    # Then: the route rejects them before FactorySyncBridge can mutate a job.
    assert [response.status_code for response in invalid_resume_responses] == [422, 422, 422, 422]
    assert all(response.get_json()["error"]["code"] == "request_invalid" for response in invalid_resume_responses)


def _client(api: FakePdpApi, tmp_path: Path):
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    return create_app(config, pdp_api=api).test_client()


@contextmanager
def _review_http_server(api: FakePdpApi, tmp_path: Path):
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    server = make_server("127.0.0.1", 0, create_app(config, pdp_api=api))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()


def test_session_csrf_is_required_for_mutating_bff_requests(tmp_path: Path) -> None:
    # Given: 신화사 PDP API를 주입한 생산관제 client를 준비한다.
    api = FakePdpApi()
    client = _client(api, tmp_path)
    session = client.get("/api/session")
    csrf = session.get_json()["csrfToken"]
    session_id = session.get_json()["sessionId"]

    # When: CSRF 없이 job 생성을 시도한 뒤 같은 session의 CSRF로 재시도한다.
    rejected = client.post("/api/jobs", json={"inputSnapshotId": "snapshot-001"})
    accepted = client.post(
        "/api/jobs",
        json={"inputSnapshotId": "snapshot-001"},
        headers={"X-Control-Tower-CSRF": csrf, "X-Control-Tower-Session": session_id},
    )

    # Then: 변경 요청은 session 경계를 통과해야만 신화사 API에 도달해야 한다.
    assert session.status_code == 200
    assert rejected.status_code == 428
    assert accepted.status_code == 201
    assert api.calls == ["create_job"]


def test_same_origin_session_pair_rehydrates_after_backend_restart(tmp_path: Path) -> None:
    before_restart = _client(FakePdpApi(), tmp_path)
    session = before_restart.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }
    without_cookie = _client(FakePdpApi(), tmp_path)
    rejected = without_cookie.post(
        "/api/jobs",
        json={"inputSnapshotId": "snapshot-001"},
        headers=headers,
    )
    after_restart = _client(FakePdpApi(), tmp_path)
    after_restart.get("/api/session")

    response = after_restart.post(
        "/api/jobs",
        json={"inputSnapshotId": "snapshot-001"},
        headers=headers,
    )

    assert rejected.status_code == 428
    assert response.status_code == 201


def test_input_snapshot_rejects_raw_file_paths(tmp_path: Path) -> None:
    # Given: 파일 경로가 포함된 브라우저 요청을 준비한다.
    client = _client(FakePdpApi(), tmp_path)
    csrf = client.get("/api/session").get_json()["csrfToken"]
    session_id = client.get("/api/session").get_json()["sessionId"]

    # When: 원본 경로를 PDP input snapshot으로 보내려 한다.
    response = client.post(
        "/api/input-snapshots",
        json={"jcode": 900001, "filePath": "C:\\secret\\product.xlsx"},
        headers={"X-Control-Tower-CSRF": csrf, "X-Control-Tower-Session": session_id},
    )

    # Then: 경로는 422로 거부되고 remote 호출은 없어야 한다.
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "raw_path_forbidden"


def test_external_pdp_failure_is_explicitly_blocked(tmp_path: Path) -> None:
    # Given: 신화사 API가 꺼진 상태의 BFF를 준비한다.
    api = FakePdpApi()
    api.fail_external = True
    client = _client(api, tmp_path)
    csrf = client.get("/api/session").get_json()["csrfToken"]
    session_id = client.get("/api/session").get_json()["sessionId"]

    # When: job 생성 요청을 보낸다.
    response = client.post(
        "/api/jobs",
        json={"inputSnapshotId": "snapshot-001"},
        headers={"X-Control-Tower-CSRF": csrf, "X-Control-Tower-Session": session_id},
    )

    # Then: 실패를 내부 오류나 성공으로 숨기지 않고 blocked_external로 표시해야 한다.
    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "blocked_external"


def test_capabilities_are_read_only_and_do_not_expose_service_key(tmp_path: Path) -> None:
    # Given: PDP capability 응답을 제공하는 BFF를 준비한다.
    api = FakePdpApi()
    client = _client(api, tmp_path)

    # When: 브라우저가 capability를 조회한다.
    response = client.get("/api/pdp/capabilities")

    # Then: 원격 capability만 전달하고 인증정보는 응답에 없어야 한다.
    assert response.status_code == 200
    assert response.get_json() == {"capabilityVersion": "1.1.0", "workerEchoFields": ["productId"]}
    assert "serviceKey" not in response.get_data(as_text=True)


def test_product_source_search_and_readiness_are_server_authenticated_bff_reads(
    tmp_path: Path,
) -> None:
    api = FakePdpApi()
    client = _client(api, tmp_path)

    sources = client.get("/api/pdp/sources?q=%ED%85%8C%EC%8A%A4%ED%8A%B8")
    readiness = client.get("/api/pdp/readiness?jcode=900001")

    assert sources.status_code == 200
    assert sources.get_json()["sources"][0]["productName"] == "테스트 접시"
    assert sources.get_json()["query"] == {"q": "테스트"}
    assert readiness.status_code == 200
    assert readiness.get_json()["missingFields"] == ["originCountry"]
    assert api.calls == ["list_sources", "get_readiness"]


def test_worker_lifecycle_and_sse_proxy_remote_state(tmp_path: Path) -> None:
    api = FakePdpApi()
    client = _client(api, tmp_path)
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}

    claimed = client.post("/api/worker/claim", json={"workerId": "worker-001"}, headers=headers)
    acknowledged = client.post("/api/worker/order-001/ack", json={"eventSequence": 1}, headers=headers)
    stream = client.get("/api/events/job-001")

    assert claimed.status_code == 200
    assert acknowledged.status_code == 200
    assert stream.status_code == 200
    assert stream.mimetype == "text/event-stream"
    assert "job-state" in stream.get_data(as_text=True)
    assert api.worker_payloads == [("claim", None), ("ack", "order-001")]


def test_worker_routes_prioritize_local_cafe24_bridge_order_without_remote_claim(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = QueuedCafe24CommandBridge(execution_timeout_seconds=1.0)
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}
    preview = build_preview({"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", **SAFE_DEFAULTS})
    command = build_cafe24_command(preview, "grant-digest", job_id="job-1")

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(bridge.execute, command)
        claimed = client.post("/api/worker/claim", json={"workerId": "worker-1", "contractVersion": "control-work-order:v1", "capabilityVersion": "batch-control-worker:v1"}, headers=headers)
        order = claimed.get_json()["order"]
        result = {
            "status": "staged_verified",
            "payloadDigest": preview["payloadDigest"],
            "remoteReadbackDigest": "remote-html",
            "externalProductNo": "2994",
            "remoteReadback": {
                "productNo": "2994",
                "productCode": "P0000TEST",
                "productName": "방울수저집",
                "display": "F",
                "selling": "F",
                "marketSync": "F",
                "categoryIds": ["71"],
                "representativeImageCount": 4,
                "detailImageCount": 14,
                "optionValues": ["초록"],
                "variantCount": 1,
                "inventoryByOption": {"초록": {"quantity": "99", "useInventory": "T"}},
                "detailHtmlDigest": "detail-html-digest",
                "imageDigests": ["image-digest"],
                "updatedAt": "2026-08-15T15:39:40+09:00",
            },
            "idempotencyKey": preview["idempotencyKey"],
        }
        acknowledged = client.post(f"/api/worker/{order['orderId']}/ack", json={**order, "workerId": "worker-1", "accepted": True, "eventSequence": 1}, headers=headers)
        completed = client.post(f"/api/worker/{order['orderId']}/complete", json={**order, "workerId": "worker-1", "eventSequence": 2, "result": result}, headers=headers)

        assert claimed.status_code == 200
        assert acknowledged.status_code == 200
        assert completed.status_code == 200
        assert pending.result(timeout=1) == result
    assert api.worker_payloads == []


def test_review_reads_and_decision_write_use_remote_bff_boundary(tmp_path: Path) -> None:
    api = FakePdpApi()
    client = _client(api, tmp_path)
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}

    reviews = client.get("/api/reviews?state=OPEN&limit=20")
    requirements = client.get("/api/jobs/job-001/requirements")
    decision = client.post("/api/jobs/job-001/decisions", json={"candidateId": "candidate-a", "idempotencyKey": "decision-001"}, headers=headers)

    assert reviews.status_code == 200
    assert requirements.status_code == 200
    assert decision.status_code == 201


def test_review_list_preserves_default_and_valid_limit_over_http_bff(tmp_path: Path) -> None:
    # Given: 실제 loopback HTTP로 제공되는 reviews BFF를 준비한다.
    api = FakePdpApi()

    # When: query 없는 기본 요청과 정상 limit 요청을 보낸다.
    with _review_http_server(api, tmp_path) as base_url:
        default_response = requests.get(f"{base_url}/api/reviews", timeout=2)
        limit_response = requests.get(f"{base_url}/api/reviews?limit=20", timeout=2)

    # Then: 기존 200 계약과 upstream 호출이 보존된다.
    assert [default_response.status_code, limit_response.status_code] == [200, 200]
    assert [default_response.json()["items"], limit_response.json()["items"]] == [[], []]
    assert len(api.review_queries) == 2


def test_review_list_rejects_invalid_limit_before_calling_upstream_over_http(tmp_path: Path) -> None:
    # Given: raw limit을 받으면 upstream 422를 내는 reviews adapter를 준비한다.
    class RejectingReviewPdpApi(FakePdpApi):
        def list_reviews(self, query: dict[str, str]) -> JsonObject:
            self.calls.append("list_reviews")
            self.review_queries.append(query)
            raise PdpHttpError("upstream_error", 422)

    api = RejectingReviewPdpApi()

    # When: malformed, empty, zero, upper-bound 초과 limit을 실제 HTTP로 보낸다.
    with _review_http_server(api, tmp_path) as base_url:
        responses = [
            requests.get(f"{base_url}/api/reviews?limit=not-an-int", timeout=2),
            requests.get(f"{base_url}/api/reviews?limit=", timeout=2),
            requests.get(f"{base_url}/api/reviews?limit=0", timeout=2),
            requests.get(f"{base_url}/api/reviews?limit=201", timeout=2),
        ]

    # Then: BFF가 422로 거부하고 upstream 호출은 없다.
    assert [response.status_code for response in responses] == [422, 422, 422, 422]
    assert [response.json()["error"]["code"] for response in responses] == [
        "request_invalid",
        "request_invalid",
        "request_invalid",
        "request_invalid",
    ]
    assert api.review_queries == []


def test_review_list_preserves_upstream_validation_over_http(tmp_path: Path) -> None:
    # Given: 상태별 typed upstream error를 내는 reviews adapter를 준비한다.
    class FailingReviewPdpApi(FakePdpApi):
        def __init__(self, status: int) -> None:
            super().__init__()
            self.status = status

        def list_reviews(self, query: dict[str, str]) -> JsonObject:
            self.calls.append("list_reviews")
            self.review_queries.append(query)
            raise PdpHttpError("upstream_error", self.status)

    # When: 인증, validation, 서버 오류를 각각 실제 HTTP로 보낸다.
    responses = []
    apis = [FailingReviewPdpApi(401), FailingReviewPdpApi(422), FailingReviewPdpApi(500)]
    for api in apis:
        with _review_http_server(api, tmp_path) as base_url:
            responses.append(requests.get(f"{base_url}/api/reviews", timeout=2))

    # Then: upstream 422만 request_invalid로 보존하고 나머지는 외부 장애로 분류한다.
    assert [response.status_code for response in responses] == [503, 422, 503]
    assert [response.json()["error"]["code"] for response in responses] == [
        "blocked_external",
        "request_invalid",
        "blocked_external",
    ]
    assert [api.review_queries for api in apis] == [[{}], [{}], [{}]]


def test_job_list_rejects_invalid_limit_before_calling_upstream(tmp_path: Path) -> None:
    # Given: 정상 PDP adapter가 연결된 BFF를 준비한다.
    api = FakePdpApi()
    client = _client(api, tmp_path)

    # When: 정수가 아니거나 범위를 벗어나거나 비어 있는 limit을 보낸다.
    responses = [
        client.get("/api/jobs?limit=not-an-int"),
        client.get("/api/jobs?limit=0"),
        client.get("/api/jobs?limit=1001"),
        client.get("/api/jobs?limit="),
    ]

    # Then: 모두 validation 4xx이며 upstream은 호출하지 않는다.
    assert [response.status_code for response in responses] == [422, 422, 422, 422]
    assert all(response.get_json()["error"]["code"] == "request_invalid" for response in responses)
    assert "list_jobs" not in api.calls


def test_job_list_distinguishes_upstream_validation_from_external_failures(
    tmp_path: Path,
) -> None:
    # Given: upstream status를 그대로 typed error로 노출하는 adapter를 준비한다.
    class FailingPdpApi(FakePdpApi):
        def __init__(self, status: int) -> None:
            super().__init__()
            self.status = status

        def list_jobs(self, query: dict[str, str]) -> JsonObject:
            raise PdpHttpError("upstream_error", self.status)

    # When: upstream이 인증, validation, 서버 오류를 각각 반환한다.
    responses = [
        _client(FailingPdpApi(401), tmp_path).get("/api/jobs"),
        _client(FailingPdpApi(422), tmp_path).get("/api/jobs"),
        _client(FailingPdpApi(500), tmp_path).get("/api/jobs"),
    ]

    # Then: validation만 4xx로 보존하고 인증/서버 장애는 external failure로 분류한다.
    assert [response.status_code for response in responses] == [503, 422, 503]
    assert [response.get_json()["error"]["code"] for response in responses] == [
        "blocked_external",
        "request_invalid",
        "blocked_external",
    ]


def test_automation_policy_snapshot_and_oauth_decision_persist_to_pdp_api(tmp_path: Path) -> None:
    api = FakePdpApi()
    judge = FakeGptJudge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, gpt_judge=judge).test_client()
    session = client.get("/api/session").get_json()
    headers = {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }

    registry = client.get("/api/automation/policy")
    assert registry.status_code == 200
    assert registry.get_json()["defaultPreset"] == "full_auto"
    assert registry.get_json()["competitorMarkets"] == [
        "coupang", "smartstore", "gmarket", "auction", "elevenst",
    ]

    snapshot_response = client.post(
        "/api/automation/policy/snapshot",
        json={
            "batchId": "batch-a",
            "productId": "product-a",
            "preset": "full_auto",
            "batchOverride": {"representative_image": "manual"},
            "productOverride": {"representative_image": "auto"},
            "stageOverride": {"representative_image": "auto"},
        },
        headers=headers,
    )
    assert snapshot_response.status_code == 201
    snapshot = snapshot_response.get_json()
    assert snapshot["effectiveSources"]["representative_image"] == "stage"
    assert snapshot["locked"] is True

    decision_payload = {
        "jobId": "job-a",
        "decisionType": "representative_image",
        "identity": {
            "jobId": "job-a",
            "productId": "product-a",
            "productKey": "key-a",
            "runId": "run-a",
            "inputFingerprint": "sha256:a",
            "revision": 7,
            "eventId": "event-7",
        },
        "policySnapshot": {
            **snapshot,
        },
        "candidates": [
            {"candidateId": "a", "identityKey": "a", "contentDigest": "sha256:a", "source": "factory", "thumbnailRef": "asset:a"},
            {"candidateId": "b", "identityKey": "b", "contentDigest": "sha256:b", "source": "factory", "thumbnailRef": "asset:b"},
        ],
        "judgementOptions": {
            "model": "latestModel",
            "reasoningEffort": "medium",
            "serviceTier": "standard",
            "preset": "fast_single",
        },
    }
    decision = client.post(
        "/api/automation/decisions",
        json=decision_payload,
        headers=headers,
    )
    assert decision.status_code == 200
    assert decision.get_json()["candidateId"] == "b"
    assert len(judge.calls) == 1
    assert api.decision_receipts[0]["candidateId"] == "b"
    assert api.decision_receipts[0]["idempotencyKey"].startswith("judgment:")
    assert api.decision_receipts[0]["judgmentReceipt"]["schema"] == "gpt-judgment-receipt:v1"
    assert api.decision_receipts[0]["judgmentReceipt"]["policySnapshotId"] == snapshot["snapshotId"]

    untrusted_reference = client.post(
        "/api/automation/decisions",
        json={
            **decision_payload,
            "inputRefs": [{"inputId": "fixture-token-hidden-in-allowed-field"}],
        },
        headers=headers,
    )
    assert untrusted_reference.status_code == 422
    assert untrusted_reference.get_json()["error"]["code"] == "request_invalid"
    assert len(judge.calls) == 1
    assert len(api.decision_receipts) == 1


def test_cafe24_approval_gate_requires_target_then_records_fake_staged_publication(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = FakeCafe24Bridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}

    missing = client.post("/api/cafe24/staging-preview", json={"batchId": "b1"}, headers=headers)
    assert missing.status_code == 422
    assert missing.get_json()["error"]["code"] == "approval_target_required"
    assert bridge.commands == []

    payload = {"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "cat", "htmlDigest": "canonical-html", "imageDigests": ["image-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", "selling": "F", "display": "F", "market_sync": "F"}
    preview = client.post("/api/cafe24/staging-preview", json=payload, headers=headers).get_json()
    binding = {key: preview[key] if key in preview else preview["payload"].get(key) for key in ("payloadDigest", "productId", "productKey", "expectedWorkfileRevision", "expectedRunId", "expectedInputFingerprint", "idempotencyKey")}
    approved = client.post("/api/cafe24/approve", json={"approvalRequestId": preview["approvalRequestId"], "approved": True, **binding}, headers=headers)
    assert approved.status_code == 200
    token = approved.get_json()["approvalToken"]

    unconfirmed = client.post("/api/cafe24/publish", json={"jobId": "job-1", "approvalToken": token, **binding}, headers=headers)
    assert unconfirmed.status_code == 409
    assert unconfirmed.get_json()["error"]["code"] == "confirmation_required"
    assert bridge.commands == []

    confirmed = client.post(
        "/api/cafe24/confirm",
        json={"approvalToken": token, "confirmed": True, **binding},
        headers=headers,
    )
    assert confirmed.status_code == 200
    nonce = confirmed.get_json()["confirmationNonce"]
    published = client.post("/api/cafe24/publish", json={"jobId": "job-1", "approvalToken": token, "confirmationNonce": nonce, **binding}, headers=headers)
    assert published.status_code == 200
    assert published.get_json()["status"] == "staged_verified"
    assert len(bridge.commands) == 1
    assert bridge.commands[0]["command"]["kind"] == "factory-cafe24"
    assert "approvalToken" not in str(bridge.commands[0])
    assert api.publication_receipts[0] == {
        "target": "cafe24",
        "targetKey": "cafe24:2994",
        "payloadDigest": preview["payloadDigest"],
        "remoteId": "2994",
        "observedPayloadDigest": "remote-html-digest",
        "idempotencyKey": preview["idempotencyKey"],
        "actor": "production-control-tower",
    }
    reused = client.post("/api/cafe24/publish", json={"jobId": "job-1", "approvalToken": token, "confirmationNonce": nonce, **binding}, headers=headers)
    assert reused.status_code == 409
    assert reused.get_json()["error"]["code"] == "approval_token_reused"


def test_cafe24_preview_rejects_a_fingerprint_not_from_the_live_authority_checkpoint(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = FakeCafe24Bridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}
    payload = {
        "batchId": "b1",
        "productId": "cafe24:2994",
        "productKey": "방울수저집",
        "categoryId": "71",
        "htmlDigest": "canonical-html",
        "imageDigests": ["image-1"],
        "expectedWorkfileRevision": 108,
        "expectedRunId": "run-1",
        "expectedInputFingerprint": "stale-fingerprint",
        **SAFE_DEFAULTS,
    }

    stale = client.post("/api/cafe24/staging-preview", json=payload, headers=headers)
    fresh = client.post(
        "/api/cafe24/staging-preview",
        json={**payload, "expectedInputFingerprint": "fp-1"},
        headers=headers,
    )

    assert stale.status_code == 409
    assert stale.get_json()["error"]["code"] == "stale_run_fingerprint"
    assert fresh.status_code == 200
    assert fresh.get_json()["payload"]["expectedInputFingerprint"] == "fp-1"
    assert bridge.commands == []


def test_cafe24_preexecution_validation_failure_spends_only_that_token_and_requires_fresh_preflight(tmp_path: Path) -> None:
    class MutablePreflightBridge(FakeCafe24Bridge):
        def __init__(self) -> None:
            super().__init__()
            self.input_fingerprint = "fp-1"

        def inspect(self) -> JsonObject:
            return {**super().inspect(), "expectedInputFingerprint": self.input_fingerprint}

    api = FakePdpApi()
    bridge = MutablePreflightBridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}
    payload = {
        "batchId": "b1",
        "productId": "cafe24:2994",
        "productKey": "방울수저집",
        "categoryId": "71",
        "htmlDigest": "canonical-html",
        "imageDigests": ["image-1"],
        "expectedWorkfileRevision": 108,
        "expectedRunId": "run-1",
        "expectedInputFingerprint": "fp-1",
        **SAFE_DEFAULTS,
    }
    preview = client.post("/api/cafe24/staging-preview", json=payload, headers=headers).get_json()
    binding = {
        key: preview[key] if key in preview else preview["payload"][key]
        for key in (
            "payloadDigest",
            "productId",
            "productKey",
            "expectedWorkfileRevision",
            "expectedRunId",
            "expectedInputFingerprint",
            "idempotencyKey",
        )
    }
    approved = client.post(
        "/api/cafe24/approve",
        json={"approvalRequestId": preview["approvalRequestId"], "approved": True, **binding},
        headers=headers,
    ).get_json()
    confirmed = client.post(
        "/api/cafe24/confirm",
        json={"approvalToken": approved["approvalToken"], "confirmed": True, **binding},
        headers=headers,
    ).get_json()

    bridge.input_fingerprint = "fp-2"
    rejected = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": approved["approvalToken"], "confirmationNonce": confirmed["confirmationNonce"], **binding},
        headers=headers,
    )
    replay = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": approved["approvalToken"], "confirmationNonce": confirmed["confirmationNonce"], **binding},
        headers=headers,
    )

    assert rejected.status_code == 409
    assert rejected.get_json()["error"]["code"] == "stale_run_fingerprint"
    assert replay.status_code == 409
    assert replay.get_json()["error"]["code"] == "approval_token_reused"
    assert bridge.commands == []

    fresh_payload = {**payload, "expectedInputFingerprint": "fp-2"}
    fresh_preview = client.post("/api/cafe24/staging-preview", json=fresh_payload, headers=headers).get_json()
    fresh_binding = {
        key: fresh_preview[key] if key in fresh_preview else fresh_preview["payload"][key]
        for key in binding
    }
    fresh_approved = client.post(
        "/api/cafe24/approve",
        json={"approvalRequestId": fresh_preview["approvalRequestId"], "approved": True, **fresh_binding},
        headers=headers,
    ).get_json()
    fresh_confirmed = client.post(
        "/api/cafe24/confirm",
        json={"approvalToken": fresh_approved["approvalToken"], "confirmed": True, **fresh_binding},
        headers=headers,
    ).get_json()
    published = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": fresh_approved["approvalToken"], "confirmationNonce": fresh_confirmed["confirmationNonce"], **fresh_binding},
        headers=headers,
    )

    assert published.status_code == 200
    assert len(bridge.commands) == 1


def test_cafe24_preflight_uses_registered_worker_bridge_and_requires_csrf(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = FakeCafe24Bridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}

    rejected = client.post("/api/cafe24/preflight")
    accepted = client.post("/api/cafe24/preflight", headers=headers)

    assert rejected.status_code == 428
    assert accepted.status_code == 200
    assert accepted.get_json()["schema"] == "factory-cafe24-preflight:v1"
    assert accepted.get_json()["productId"] == "cafe24:2994"
    assert bridge.preflight_calls == 1


def test_cafe24_reconcile_is_read_only_and_records_verified_publication_receipt(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = FakeCafe24Bridge()
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}
    payload = {"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", "selling": "F", "display": "F", "market_sync": "F"}
    preview = build_preview(payload)

    rejected = client.post("/api/cafe24/reconcile", json={"jobId": "job-1", **payload}, headers=headers)
    accepted = client.post(
        "/api/cafe24/reconcile",
        json={"jobId": "job-1", "payloadDigest": preview["payloadDigest"], **payload},
        headers=headers,
    )

    assert rejected.status_code == 409
    assert rejected.get_json()["error"]["code"] == "approval_binding_mismatch"
    assert accepted.status_code == 200
    assert accepted.get_json()["status"] == "staged_verified"
    assert bridge.commands[-1]["command"]["name"] == "verifyDetailToCafe24"
    assert "approvalToken" not in str(bridge.commands[-1])
    assert "approvalGrantDigest" not in str(bridge.commands[-1])
    assert api.publication_receipts[-1] == {
        "target": "cafe24",
        "targetKey": "cafe24:2994",
        "payloadDigest": preview["payloadDigest"],
        "remoteId": "2994",
        "observedPayloadDigest": "remote-html-digest",
        "idempotencyKey": preview["idempotencyKey"],
        "actor": "production-control-tower",
    }
    events = client.get("/api/jobs/job-1/publication-events")
    assert events.status_code == 200
    assert events.get_json()["events"][0]["payload"]["idempotencyKey"] == preview["idempotencyKey"]


def test_direct_factory_job_reconcile_records_local_terminal_receipt_without_pdp_write(tmp_path: Path) -> None:
    api = FakePdpApi()
    bridge = FakeCafe24Bridge()
    factory = FactorySyncBridge()
    job_id = "factory-job-local-receipt"
    payload = {"batchId": "b1", "productId": "cafe24:2994", "productKey": "방울수저집", "categoryId": "71", "htmlDigest": "html-1", "imageDigests": ["img-1"], "expectedWorkfileRevision": 108, "expectedRunId": "run-1", "expectedInputFingerprint": "fp-1", "selling": "F", "display": "F", "market_sync": "F"}
    preview = build_preview(payload)
    projection = {
        "schema": "factory-control-projection:v1",
        "connected": True,
        "status": "connected",
        "sequence": 1,
        "cursor": "1",
        "session": {"productId": "cafe24:2994", "productKey": "방울수저집", "runId": "run-1", "inputFingerprint": "fp-1", "revision": 109},
        "inputs": [],
        "stages": [],
        "registration": {
            "status": "staged_verified",
            "blockers": [],
            "mode": "update",
            "jobId": job_id,
            "expectedWorkfileRevision": 108,
            "idempotencyKey": preview["idempotencyKey"],
            "publicationReceipt": {"schema": "kuasangse.cafe24-publication-receipt", "productNo": "2994", "productName": "방울수저집"},
        },
    }
    factory.seed_projection(projection)
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(config, pdp_api=api, cafe24_bridge=bridge, factory_sync_bridge=factory).test_client()
    session = client.get("/api/session").get_json()
    headers = {"X-Control-Tower-CSRF": session["csrfToken"], "X-Control-Tower-Session": session["sessionId"]}

    response = client.post(
        "/api/cafe24/reconcile",
        json={"jobId": job_id, "payloadDigest": preview["payloadDigest"], **payload},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.get_json()["externalWrite"] is False
    assert api.publication_receipts == []
    terminal = factory.current_state()["registration"]["publicationReceipt"]
    assert terminal["schema"] == "factory-cafe24-terminal-publication-receipt:v1"
    assert terminal["remoteProductNo"] == "2994"
    assert terminal["remoteReadback"]["variantCount"] == 1
    incoming = {**projection, "sequence": 2, "cursor": "2"}
    factory.accept_projection(incoming)
    assert factory.current_state()["registration"]["publicationReceipt"] == terminal
