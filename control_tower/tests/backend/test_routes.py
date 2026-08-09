from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Thread
from typing import Final

import requests
from werkzeug.serving import make_server

from control_tower.backend.app import create_app
from control_tower.backend.cafe24_bridge import QueuedCafe24CommandBridge, build_cafe24_command
from control_tower.backend.cafe24_staging import SAFE_DEFAULTS, build_preview
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.routes import ExternalDependencyError
from control_tower.backend.runtime_cache import JsonObject


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
        result = {"status": "staged_verified", "payloadDigest": preview["payloadDigest"], "remoteReadbackDigest": "remote-html", "externalProductNo": "2994", "idempotencyKey": preview["idempotencyKey"]}
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

    decision = client.post(
        "/api/automation/decisions",
        json={
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
        },
        headers=headers,
    )
    assert decision.status_code == 200
    assert decision.get_json()["candidateId"] == "b"
    assert len(judge.calls) == 1
    assert api.decision_receipts[0]["candidateId"] == "b"
    assert api.decision_receipts[0]["idempotencyKey"].startswith("judgment:")
    assert api.decision_receipts[0]["judgmentReceipt"]["schema"] == "gpt-judgment-receipt:v1"
    assert api.decision_receipts[0]["judgmentReceipt"]["policySnapshotId"] == snapshot["snapshotId"]


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

    published = client.post("/api/cafe24/publish", json={"jobId": "job-1", "approvalToken": token, **binding}, headers=headers)
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
    reused = client.post("/api/cafe24/publish", json={"jobId": "job-1", "approvalToken": token, **binding}, headers=headers)
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

    bridge.input_fingerprint = "fp-2"
    rejected = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": approved["approvalToken"], **binding},
        headers=headers,
    )
    replay = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": approved["approvalToken"], **binding},
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
    published = client.post(
        "/api/cafe24/publish",
        json={"jobId": "job-1", "approvalToken": fresh_approved["approvalToken"], **fresh_binding},
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
