from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import pytest
from flask.testing import FlaskClient

from control_tower.backend.app import create_app
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.pdp_client import PdpHttpError
from control_tower.backend.routes import UnavailablePdpApi
from control_tower.backend.runtime_cache import JsonObject, JsonValue

BATCH_ID = "11111111-1111-1111-1111-111111111111"
REVIEW_ID = "22222222-2222-2222-2222-222222222222"
ASSET_ID = "33333333-3333-3333-3333-333333333333"


class FakeWorkbenchApi:  # noqa: MUTABLE_OK
    """호출 기록이 목적이라 가변 상태를 갖는 신화사 workbench fake."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, JsonValue]] = []
        self.fail: PdpHttpError | None = None

    def _result(self, name: str, value: JsonValue, result: JsonObject) -> JsonObject:
        self.calls.append((name, value))
        if self.fail is not None:
            raise self.fail
        return result

    def list_products(self, query: Mapping[str, JsonValue]) -> JsonObject:
        return self._result(
            "list_products",
            query,
            {
                "items": [
                    {
                        "jcode": 930001,
                        "name": "신화 접시",
                        "status": "active",
                        "workspaceVersion": 7,
                    },
                ],
                "nextCursor": 930001,
            },
        )

    def get_product(self, jcode: int) -> JsonObject:
        return self._result(
            "get_product",
            jcode,
            {
                "catalog": {"product": {"jcode": jcode, "name": "신화 접시"}},
                "workspace": {"readinessState": "WAITING_REVIEW", "aCutLinkId": "link-a"},
            },
        )

    def get_product_fields(self, jcode: int) -> JsonObject:
        return self._result(
            "get_product_fields",
            jcode,
            {
                "jcode": jcode,
                "version": 7,
                "fields": [
                    {
                        "fieldKey": "originCountry",
                        "required": True,
                        "state": "missing",
                        "value": None,
                    },
                ],
            },
        )

    def get_product_assets(self, jcode: int) -> JsonObject:
        return self._result(
            "get_product_assets",
            jcode,
            {
                "items": [
                    {
                        "linkId": "link-a",
                        "assetId": ASSET_ID,
                        "thumbnailReference": f"/api/pdp-assets/v1/assets/{ASSET_ID}/thumbnail",
                    },
                ],
                "workspaceVersion": 7,
                "currentACutLinkId": "link-a",
            },
        )

    def create_batch(self, payload: JsonObject, idempotency_key: str) -> JsonObject:
        return self._result(
            "create_batch",
            {"payload": payload, "idempotencyKey": idempotency_key},
            {
                "id": BATCH_ID,
                "state": "DRAFT",
                "concurrencyLimit": 2,
                "totalCount": len(payload["jcodes"]) if isinstance(payload.get("jcodes"), list) else 0,
                "version": 1,
            },
        )

    def list_batches(self, query: Mapping[str, JsonValue]) -> JsonObject:
        return self._result(
            "list_batches",
            query,
            {
                "items": [{"id": BATCH_ID, "state": "RUNNING", "version": 2}],
                "nextCursor": BATCH_ID,
            },
        )

    def get_batch(self, batch_id: str) -> JsonObject:
        return self._result(
            "get_batch",
            batch_id,
            {"id": batch_id, "state": "RUNNING", "version": 2},
        )

    def get_batch_items(self, batch_id: str) -> JsonObject:
        return self._result(
            "get_batch_items",
            batch_id,
            {
                "items": [
                    {
                        "jcode": 930001,
                        "state": "WAITING_REVIEW",
                        "thumbnail": {"id": 1, "mimeType": "image/jpeg"},
                        "aCut": {"linkId": "link-a", "thumbnailState": "READY"},
                    },
                ],
            },
        )

    def command_batch(
        self,
        batch_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject:
        states = {
            "start": "RUNNING",
            "pause": "PAUSED",
            "resume": "RUNNING",
            "cancel": "CANCEL_REQUESTED",
            "retry-failed": "RUNNING",
            "publish": "PUBLISHING",
        }
        command = payload.get("command")
        return self._result(
            "command_batch",
            {
                "batchId": batch_id,
                "payload": payload,
                "idempotencyKey": idempotency_key,
                "expectedVersion": expected_version,
            },
            {
                "id": batch_id,
                "state": states.get(command, "UNKNOWN") if isinstance(command, str) else "UNKNOWN",
                "version": expected_version + 1,
            },
        )

    def get_batch_events(self, batch_id: str, after: int) -> JsonObject:
        return self._result(
            "get_batch_events",
            {"batchId": batch_id, "after": after},
            {
                "events": [
                    {
                        "sequence": after + 1,
                        "type": "resume",
                        "beforeState": "PAUSED",
                        "afterState": "RUNNING",
                    },
                ],
                "nextCursor": after + 1,
            },
        )

    def decide_review(
        self,
        review_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject:
        return self._result(
            "decide_review",
            {
                "reviewId": review_id,
                "payload": payload,
                "idempotencyKey": idempotency_key,
                "expectedVersion": expected_version,
            },
            {"id": review_id, "state": "APPROVED", "version": expected_version + 1},
        )

    def create_publication(
        self,
        jcode: int,
        payload: JsonObject,
        idempotency_key: str,
    ) -> JsonObject:
        return self._result(
            "create_publication",
            {"jcode": jcode, "payload": payload, "idempotencyKey": idempotency_key},
            {"id": "publication-a", "jcode": jcode, "state": "DRY_RUN_READY", "version": 1},
        )


def _client(api: FakeWorkbenchApi, tmp_path: Path) -> FlaskClient:
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    return create_app(
        config,
        pdp_api=UnavailablePdpApi(),
        workbench_api=api,
    ).test_client()


def _headers(client: FlaskClient) -> dict[str, str]:
    session = client.get("/api/session").get_json()
    return {
        "X-Control-Tower-CSRF": session["csrfToken"],
        "X-Control-Tower-Session": session["sessionId"],
    }


def test_product_summary_a_cut_metadata_and_required_state_are_observable(
    tmp_path: Path,
) -> None:
    # Given: 신화사 제품·필드·A컷 응답을 제공하는 격리 workbench API를 준비한다.
    api = FakeWorkbenchApi()
    client = _client(api, tmp_path)

    # When: 제품 목록, 상세, 필수 필드, 자산, 원본 thumbnail 경로를 BFF로 조회한다.
    products = client.get("/api/pdp/products?limit=50")
    detail = client.get("/api/pdp/products/930001")
    fields = client.get("/api/pdp/products/930001/fields")
    assets = client.get("/api/pdp/products/930001/assets")
    thumbnail = client.get(f"/api/pdp/assets/{ASSET_ID}/thumbnail")

    # Then: 상태와 A컷 metadata는 JSON으로 보이고 원본 binary는 BFF가 내려주지 않아야 한다.
    assert products.status_code == detail.status_code == fields.status_code == assets.status_code == 200
    assert products.get_json()["items"][0]["workspaceVersion"] == 7
    assert detail.get_json()["workspace"]["readinessState"] == "WAITING_REVIEW"
    assert fields.get_json()["fields"][0]["state"] == "missing"
    assert assets.get_json()["currentACutLinkId"] == "link-a"
    assert thumbnail.status_code == 404


def test_batch_500_status_commands_review_publication_and_cursor_are_forwarded(
    tmp_path: Path,
) -> None:
    # Given: 최대 500개 제품과 mutation CSRF session을 준비한다.
    api = FakeWorkbenchApi()
    client = _client(api, tmp_path)
    headers = _headers(client)
    jcodes = list(range(930001, 930501))

    # When: 배치를 만들고 상태·items·모든 lifecycle 명령·검수·게시·event delta를 요청한다.
    created = client.post(
        "/api/pdp/production-batches",
        json={
            "jcodes": jcodes,
            "concurrencyLimit": 2,
            "policy": {"mode": "safe"},
            "idempotencyKey": "create-500",
        },
        headers=headers,
    )
    batches = client.get("/api/pdp/production-batches?state=RUNNING&limit=50")
    detail = client.get(f"/api/pdp/production-batches/{BATCH_ID}")
    items = client.get(f"/api/pdp/production-batches/{BATCH_ID}/items")
    commands = (
        ("start", "RUNNING"),
        ("pause", "PAUSED"),
        ("resume", "RUNNING"),
        ("cancel", "CANCEL_REQUESTED"),
        ("retry-failed", "RUNNING"),
        ("publish", "PUBLISHING"),
    )
    for version, (command, expected_state) in enumerate(
        commands,
        start=1,
    ):
        response = client.post(
            f"/api/pdp/production-batches/{BATCH_ID}/commands",
            json={
                "command": command,
                "expectedVersion": version,
                "idempotencyKey": f"command-{command}",
            },
            headers=headers,
        )
        assert response.status_code == 200
        assert response.get_json()["state"] == expected_state
    review = client.post(
        f"/api/pdp/reviews/{REVIEW_ID}/decision",
        json={
            "decision": "approve",
            "rationale": "검수 완료",
            "expectedVersion": 7,
            "idempotencyKey": "review-approve",
        },
        headers=headers,
    )
    publication = client.post(
        "/api/pdp/products/930001/publications",
        json={
            "target": "cafe24",
            "dryRun": True,
            "designatedTestProduct": True,
            "idempotencyKey": "publish-dry-run",
        },
        headers=headers,
    )
    events = client.get(f"/api/pdp/production-batches/{BATCH_ID}/events?after=4")

    # Then: 원격 계약의 상태·A컷·버전·cursor 의미가 손실 없이 관찰되어야 한다.
    assert (created.status_code, created.get_json()["totalCount"]) == (201, 500)
    assert batches.get_json()["items"][0]["state"] == "RUNNING"
    assert detail.get_json()["version"] == 2
    assert items.get_json()["items"][0]["aCut"]["thumbnailState"] == "READY"
    assert review.get_json()["state"] == "APPROVED"
    assert publication.status_code == 201
    assert publication.get_json()["state"] == "DRY_RUN_READY"
    assert events.get_json()["nextCursor"] == 5
    forwarded = [value["payload"]["command"] for name, value in api.calls if name == "command_batch"]
    assert forwarded == ["start", "pause", "resume", "cancel", "retry-failed", "publish"]
    created_call = next(value for name, value in api.calls if name == "create_batch")
    assert created_call["payload"]["concurrencyLimit"] == 2


@pytest.mark.parametrize("forbidden_field", ("serviceKey", "accessToken", "actor"))
def test_create_batch_rejects_client_control_fields_without_downstream_call(
    forbidden_field: str,
    tmp_path: Path,
) -> None:
    # Given: downstream 호출을 기록하는 격리 workbench API와 유효한 batch payload를 준비한다.
    api = FakeWorkbenchApi()
    client = _client(api, tmp_path)
    payload: JsonObject = {
        "jcodes": [930001],
        "concurrencyLimit": 2,
        "policy": {"mode": "safe"},
        "idempotencyKey": "reject-client-control-field",
        forbidden_field: "redacted",
    }

    # When: 브라우저가 control field를 본문에 넣어 batch 생성을 요청한다.
    response = client.post(
        "/api/pdp/production-batches",
        json=payload,
        headers=_headers(client),
    )

    # Then: BFF boundary가 4xx로 거부하고 downstream을 호출하지 않아야 한다.
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "validation_error"
    assert [name for name, _ in api.calls if name == "create_batch"] == []


def test_stale_batch_command_version_is_a_409_not_a_success(
    tmp_path: Path,
) -> None:
    # Given: stale_version을 반환하는 신화사 batch command seam을 준비한다.
    api = FakeWorkbenchApi()
    api.fail = PdpHttpError("stale_version", 409)
    client = _client(api, tmp_path)

    # When: 이전 version으로 pause 명령을 보낸다.
    response = client.post(
        f"/api/pdp/production-batches/{BATCH_ID}/commands",
        json={
            "command": "pause",
            "expectedVersion": 1,
            "idempotencyKey": "stale-pause",
        },
        headers=_headers(client),
    )

    # Then: command 실패가 2xx body로 바뀌지 않아야 한다.
    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "stale_version"


def test_malformed_review_id_is_rejected_without_approval(
    tmp_path: Path,
) -> None:
    # Given: review 결정을 승인으로 응답하는 격리 workbench API를 준비한다.
    api = FakeWorkbenchApi()
    client = _client(api, tmp_path)

    # When: UUID 형식이 아닌 review ID로 승인 요청을 보낸다.
    response = client.post(
        "/api/pdp/reviews/not-a-uuid/decision",
        json={
            "decision": "approve",
            "rationale": "검수 완료",
            "expectedVersion": 7,
            "idempotencyKey": "invalid-review-id",
        },
        headers=_headers(client),
    )

    # Then: 승인 상태를 위장하지 않고 경계에서 요청을 거부한다.
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "request_invalid"
    assert [name for name, _ in api.calls if name == "decide_review"] == []


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (PdpHttpError("validation_error", 422), 422, "validation_error"),
        (PdpHttpError("production_batch_not_found", 404), 404, "production_batch_not_found"),
        (PdpHttpError("stale_version", 409), 409, "stale_version"),
        (PdpHttpError("pdp_unavailable", 503), 503, "blocked_external"),
    ],
)
def test_workbench_typed_errors_never_become_misleading_2xx(
    error: PdpHttpError,
    expected_status: int,
    expected_code: str,
    tmp_path: Path,
) -> None:
    # Given: 신화사 API가 typed error를 반환한다.
    api = FakeWorkbenchApi()
    api.fail = error
    client = _client(api, tmp_path)

    # When: 제품 목록을 조회한다.
    response = client.get("/api/pdp/products")

    # Then: status와 error code가 성공 body로 위장되지 않아야 한다.
    assert response.status_code == expected_status
    assert response.get_json()["error"]["code"] == expected_code
