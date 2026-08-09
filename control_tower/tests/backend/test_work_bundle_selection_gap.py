from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import pytest

from control_tower.backend.app import create_app
from control_tower.backend.config import ControlTowerConfig
from control_tower.backend.factory_sync import FactorySyncBridge
from control_tower.backend.pdp_workbench_client import WorkbenchAssetBytes
from control_tower.backend.policy import build_policy_snapshot
from control_tower.backend.routes import UnavailablePdpApi
from control_tower.backend.runtime_cache import JsonObject, JsonValue


BUNDLE_ID = "965fe15f-88de-4b61-9421-e1ee29eeb58f"
ASSET_ID = "4bb56dcc-e846-442b-8303-d35241b10c74"
SECOND_ASSET_ID = "55555555-5555-4555-8555-555555555555"
JOB_ID = "11111111-1111-1111-1111-111111111111"


class WorkBundleApiFake:  # noqa: MUTABLE_OK
    """Records BFF work-bundle calls without exposing credentials."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.last_list_query: dict[str, JsonValue] = {}

    def list_work_bundles(self, query: Mapping[str, JsonValue]) -> JsonObject:
        self.calls.append("list")
        self.last_list_query = dict(query)
        return {
            "items": [
                {
                    "id": BUNDLE_ID,
                    "bundleKey": "kuasangse:product-a",
                    "workfileName": "양단호박바늘쌈.kuasangse",
                    "sourcePath": "C:/private/workfiles/secret.kuasangse",
                    "inputAssetCount": 1,
                    "outputAssetCount": 1,
                    "version": 3,
                },
            ],
            "nextCursor": None,
        }

    def get_work_bundle(self, bundle_id: str) -> JsonObject:
        self.calls.append(f"detail:{bundle_id}")
        return {
            "id": bundle_id,
            "bundleKey": "kuasangse:product-a",
            "workfileName": "양단호박바늘쌈.kuasangse",
            "sourcePath": "C:/private/workfiles/secret.kuasangse",
            "version": 3,
            "assets": [
                {
                    "id": ASSET_ID,
                    "assetKey": "output:hero:1",
                    "phase": "output",
                    "stage": "hero",
                    "role": "hero",
                    "displayName": "대표 후보",
                    "sourceLocator": "C:/private/output/hero.jpg",
                    "sourceChecksum": "a" * 64,
                    "selectionState": "candidate",
                    "metadata": {"runId": "run-a", "serviceKey": "must-not-leak"},
                    "storedAssetId": "22222222-2222-2222-2222-222222222222",
                    "contentReference": "/api/pdp-assets/v1/assets/222/content",
                    "thumbnailReference": "/api/pdp-assets/v1/assets/222/thumbnail",
                    "version": 1,
                },
            ],
        }

    def get_work_bundle_asset(self, reference: str) -> WorkbenchAssetBytes:
        self.calls.append(f"asset:{reference}")
        return WorkbenchAssetBytes(
            content=b"\x89PNG\r\n\x1a\nfixture",
            content_type="image/png",
            cache_control="private, max-age=600",
        )


class OptionStageWorkBundleApiFake(WorkBundleApiFake):  # noqa: MUTABLE_OK
    def get_work_bundle(self, bundle_id: str) -> JsonObject:
        detail = super().get_work_bundle(bundle_id)
        assets = detail["assets"]
        assert isinstance(assets, list)
        assets.extend(
            [
                {
                    "id": "66666666-6666-4666-8666-666666666666",
                    "assetKey": "output:color-option:1",
                    "phase": "output",
                    "stage": "options",
                    "role": "color-option",
                },
                {
                    "id": "77777777-7777-4777-8777-777777777777",
                    "assetKey": "output:color-option-output:1",
                    "phase": "output",
                    "stage": "options",
                    "role": "color-option-output",
                },
            ],
        )
        return detail


def _client(tmp_path: Path, workbench_api: WorkBundleApiFake):
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    return create_app(
        config,
        pdp_api=UnavailablePdpApi(),
        workbench_api=workbench_api,
    ).test_client()


def test_work_bundle_bff_groups_roles_and_removes_paths_and_credentials(
    tmp_path: Path,
) -> None:
    # Given: a downstream bundle containing protected paths and a credential-like metadata field.
    api = WorkBundleApiFake()
    client = _client(tmp_path, api)

    # When: the browser requests the list and detail through the production BFF.
    listing = client.get("/api/pdp/work-bundles?limit=100")
    detail = client.get(f"/api/pdp/work-bundles/{BUNDLE_ID}")

    # Then: the contract is available while raw paths and credential fields never cross the boundary.
    assert listing.status_code == detail.status_code == 200
    payload = detail.get_json()
    assert payload["assets"][0]["factoryStageKey"] == "representative"
    assert payload["assets"][0]["thumbnailReference"].endswith(f"/assets/{ASSET_ID}/thumbnail")
    serialized = detail.get_data(as_text=True)
    assert "C:/private" not in serialized
    assert "must-not-leak" not in serialized
    assert "serviceKey" not in serialized


@pytest.mark.parametrize(
    ("role", "expected_stage"),
    (
        ("color-option", "option_color"),
        ("color-option-output", "option_color"),
    ),
)
def test_work_bundle_bff_projects_option_output_roles_to_option_color(
    role: str,
    expected_stage: str,
    tmp_path: Path,
) -> None:
    # Given: a live-shaped output asset role and the already-supported alias.
    client = _client(tmp_path, OptionStageWorkBundleApiFake())

    # When: the browser reads the work-bundle detail through the production BFF.
    response = client.get(f"/api/pdp/work-bundles/{BUNDLE_ID}")

    # Then: both role spellings bind to the production A-cut stage key.
    assert response.status_code == 200
    asset = next(item for item in response.get_json()["assets"] if item["role"] == role)
    assert asset["factoryStageKey"] == expected_stage


def test_missing_work_bundle_bff_is_not_a_false_empty_success(tmp_path: Path) -> None:
    # Given: a real work-bundle API fake with one bundle.
    client = _client(tmp_path, WorkBundleApiFake())

    # When: the UI asks for the first 100 bundles.
    response = client.get("/api/pdp/work-bundles?limit=100")

    # Then: candidate discovery is a populated 200, never a 404 or empty placeholder.
    assert response.status_code == 200
    assert len(response.get_json()["items"]) == 1


def test_work_bundle_bff_forwards_supported_search_and_binding_filters(
    tmp_path: Path,
) -> None:
    # Given: the Sinhwa work-bundle API supports server-side product and binding filters.
    api = WorkBundleApiFake()
    client = _client(tmp_path, api)

    # When: the dashboard narrows the large work-bundle ledger to one linked product.
    response = client.get(
        "/api/pdp/work-bundles"
        "?limit=25&q=%EB%B0%A9%EC%9A%B8%EC%88%98%EC%A0%80%EC%A7%91"
        "&bindingState=both&jcode=1583",
    )

    # Then: every upstream-supported filter must reach Sinhwa instead of being dropped.
    assert response.status_code == 200
    assert api.last_list_query == {
        "limit": "25",
        "q": "방울수저집",
        "bindingState": "both",
        "jcode": "1583",
    }


def test_work_bundle_proxy_allows_only_server_returned_member_and_preserves_mime(
    tmp_path: Path,
) -> None:
    api = WorkBundleApiFake()
    client = _client(tmp_path, api)

    allowed = client.get(
        f"/api/pdp/work-bundles/{BUNDLE_ID}/assets/{ASSET_ID}/thumbnail",
    )
    rejected = client.get(
        f"/api/pdp/work-bundles/{BUNDLE_ID}/assets/"
        "33333333-3333-3333-3333-333333333333/thumbnail",
    )

    assert allowed.status_code == 200
    assert allowed.data.startswith(b"\x89PNG\r\n\x1a\n")
    assert allowed.content_type == "image/png"
    assert allowed.headers["Cache-Control"] == "private, max-age=600"
    assert rejected.status_code == 404
    assert all("must-not-leak" not in call for call in api.calls)


class SelectionPdpFake:
    def __init__(self, events: list[str], *, fail_decision: bool = False) -> None:
        self.events = events
        self.fail_decision = fail_decision
        self.decisions: list[JsonObject] = []

    def get_job(self, job_id: str) -> JsonObject:
        return {
            "jobId": job_id,
            "productId": "factory:product-a",
            "productKey": "product-a",
            "status": "RUNNING",
            "version": 4,
        }

    def create_decision(self, job_id: str, payload: JsonObject) -> JsonObject:
        self.events.append("decision")
        if self.fail_decision:
            from control_tower.backend.routes import ExternalDependencyError

            raise ExternalDependencyError("pdp_unavailable")
        self.decisions.append(payload)
        return {
            "jobId": job_id,
            "decisionId": "decision-a",
            "replayed": len(self.decisions) > 1,
        }


class MultiWorkBundleApiFake(WorkBundleApiFake):
    def get_work_bundle(self, bundle_id: str) -> JsonObject:
        detail = super().get_work_bundle(bundle_id)
        assets = detail["assets"]
        assert isinstance(assets, list)
        assets.append(
            {
                **assets[0],
                "id": SECOND_ASSET_ID,
                "assetKey": "output:hero:2",
                "displayName": "대표 후보 2",
                "sourceChecksum": "b" * 64,
            },
        )
        return detail


class GptJudgeFake:
    def __init__(self) -> None:
        self.calls: list[JsonObject] = []

    def judge(self, **kwargs: JsonValue) -> JsonObject:
        self.calls.append(dict(kwargs))
        return {
            "receipt": {
                "model": "gpt-verified",
                "reasoningEffort": kwargs["reasoning_effort"],
                "serviceTier": kwargs["service_tier"],
                "preset": kwargs["preset"],
                "judgement": {
                    "decision": "selected",
                    "selectedCandidateId": SECOND_ASSET_ID,
                    "confidence": 0.92,
                    "scoreGap": 0.2,
                    "riskFlags": [],
                    "rationale": "두 후보의 근거를 비교해 두 번째 후보를 선택했습니다.",
                    "scores": {
                        "sameProductLikelihood": 0.9,
                        "taskSuitability": 0.9,
                        "quality": 0.85,
                    },
                },
            },
        }


class RecordingFactoryBridge(FactorySyncBridge):
    def __init__(self, events: list[str]) -> None:
        super().__init__()
        self.events = events

    def queue_selection(self, payload: Mapping[str, JsonValue]) -> JsonObject:
        self.events.append("queue")
        return super().queue_selection(payload)


def _projection() -> JsonObject:
    return {
        "schema": "factory-control-projection:v1",
        "capabilityVersion": "factory-control-command:v1",
        "sequence": 7,
        "cursor": "7",
        "connected": True,
        "session": {
            "productId": "factory:product-a",
            "productKey": "product-a",
            "runId": "run-a",
            "inputFingerprint": "sha256:input-a",
            "revision": 3,
        },
        "inputs": [],
        "stages": [
            {
                "key": "representative",
                "status": "manual",
                "selectedIds": [],
                "candidates": [{"id": ASSET_ID}],
            },
        ],
        "progress": {},
        "registration": {},
    }


def _selection_payload(**overrides: JsonValue) -> JsonObject:
    return {
        "bundleId": BUNDLE_ID,
        "jobId": JOB_ID,
        "productId": "factory:product-a",
        "productKey": "product-a",
        "stageKey": "representative",
        "candidateId": ASSET_ID,
        "expectedRevision": 3,
        "expectedRunId": "run-a",
        "expectedInputFingerprint": "sha256:input-a",
        "expectedProjectionCursor": "7",
        "idempotencyKey": "a-cut:product-a:representative:3",
        "decisionMode": "manual",
        **overrides,
    }


def test_projection_cursor_is_independent_from_bff_sse_event_domain(
    tmp_path: Path,
) -> None:
    client, _pdp, _factory, events = _selection_client(tmp_path)
    payload = _selection_payload()
    response = client.post("/api/factory/a-cuts/select", json=payload)

    assert response.status_code == 202
    assert response.get_json()["status"] == "factory_queued"
    assert events == ["decision", "queue"]


def test_factory_candidate_asset_id_maps_to_bundle_asset_and_receipt_keeps_relation(
    tmp_path: Path,
) -> None:
    client, pdp, factory, _events = _selection_client(tmp_path)
    projection = _projection()
    stages = projection["stages"]
    assert isinstance(stages, list)
    stages[0]["candidates"] = [{"id": "candidate-hero-1", "assetId": ASSET_ID}]
    factory.seed_projection(projection)
    payload = _selection_payload(candidateId="candidate-hero-1")
    response = client.post("/api/factory/a-cuts/select", json=payload)

    assert response.status_code == 202
    receipt = response.get_json()["decisionReceipt"]
    assert receipt["selectedCandidateId"] == "candidate-hero-1"
    assert receipt["selectedAssetId"] == ASSET_ID
    assert receipt["candidateAssetMap"] == {"candidate-hero-1": ASSET_ID}
    assert pdp.decisions[0]["selectedId"] == "candidate-hero-1"
    assert f"factory-candidate:candidate-hero-1:asset:{ASSET_ID}" in pdp.decisions[0]["evidenceRefs"]


def test_ambiguous_candidate_asset_mapping_is_rejected_before_decision_or_queue(
    tmp_path: Path,
) -> None:
    class AmbiguousWorkBundleApi(WorkBundleApiFake):
        def get_work_bundle(self, bundle_id: str) -> JsonObject:
            detail = super().get_work_bundle(bundle_id)
            assets = detail["assets"]
            assert isinstance(assets, list)
            assets.append(
                {
                    **assets[0],
                    "id": SECOND_ASSET_ID,
                    "assetKey": "output:hero:ambiguous",
                    "storedAssetId": ASSET_ID,
                    "sourceChecksum": "b" * 64,
                },
            )
            return detail

    events: list[str] = []
    pdp = SelectionPdpFake(events)
    factory = RecordingFactoryBridge(events)
    projection = _projection()
    stages = projection["stages"]
    assert isinstance(stages, list)
    stages[0]["candidates"] = [{"id": "candidate-hero-1", "assetId": ASSET_ID}]
    factory.seed_projection(projection)
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(
        config,
        pdp_api=pdp,
        workbench_api=AmbiguousWorkBundleApi(),
        factory_sync_bridge=factory,
    ).test_client()
    session = client.get("/api/session").get_json()
    client.environ_base["HTTP_X_CONTROL_TOWER_CSRF"] = session["csrfToken"]
    client.environ_base["HTTP_X_CONTROL_TOWER_SESSION"] = session["sessionId"]
    payload = _selection_payload(candidateId="candidate-hero-1")
    response = client.post("/api/factory/a-cuts/select", json=payload)

    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "candidate_identity_ambiguous"
    assert events == []


def test_auto_zero_stable_identity_match_records_hold_and_never_queues(
    tmp_path: Path,
) -> None:
    client, pdp, factory, events = _selection_client(tmp_path)
    projection = _projection()
    stages = projection["stages"]
    assert isinstance(stages, list)
    stages[0]["candidates"] = [
        {"id": "candidate-without-asset-match", "assetId": "asset:missing"},
    ]
    factory.seed_projection(projection)
    snapshot = build_policy_snapshot(
        "batch-a",
        "factory:product-a",
        "full_auto",
        {},
        {},
        {"representative_image": "auto"},
    )

    response = client.post(
        "/api/factory/a-cuts/select",
        json=_selection_payload(
            candidateId=None,
            decisionMode="auto",
            policySnapshot=snapshot,
            judgementOptions={
                "model": "latestModel",
                "reasoningEffort": "medium",
                "serviceTier": "standard",
                "preset": "fast_single",
            },
        ),
    )

    assert response.status_code == 200
    assert response.get_json()["selectionStatus"] == "manual_required"
    assert response.get_json()["decisionReceipt"]["holdReason"] == "candidate_empty"
    assert events == ["decision"]
    assert pdp.decisions[0]["candidateIds"] == []


def _selection_client(
    tmp_path: Path,
    *,
    fail_decision: bool = False,
    multiple: bool = False,
    gpt_judge: GptJudgeFake | None = None,
) -> tuple[object, SelectionPdpFake, RecordingFactoryBridge, list[str]]:
    events: list[str] = []
    pdp = SelectionPdpFake(events, fail_decision=fail_decision)
    factory = RecordingFactoryBridge(events)
    projection = _projection()
    if multiple:
        stages = projection["stages"]
        assert isinstance(stages, list)
        stages[0]["candidates"].append({"id": SECOND_ASSET_ID})
    factory.seed_projection(projection)
    config = ControlTowerConfig.from_env({"CONTROL_TOWER_CACHE_ROOT": str(tmp_path)})
    client = create_app(
        config,
        pdp_api=pdp,
        workbench_api=MultiWorkBundleApiFake() if multiple else WorkBundleApiFake(),
        factory_sync_bridge=factory,
        gpt_judge=gpt_judge,
    ).test_client()
    session = client.get("/api/session").get_json()
    client.environ_base["HTTP_X_CONTROL_TOWER_CSRF"] = session["csrfToken"]
    client.environ_base["HTTP_X_CONTROL_TOWER_SESSION"] = session["sessionId"]
    return client, pdp, factory, events


def test_selection_records_pdp_decision_before_queue_and_retry_is_idempotent(
    tmp_path: Path,
) -> None:
    client, pdp, _factory, events = _selection_client(tmp_path)

    first = client.post("/api/factory/a-cuts/select", json=_selection_payload())
    second = client.post("/api/factory/a-cuts/select", json=_selection_payload())

    assert first.status_code == second.status_code == 202
    assert events == ["decision", "queue", "decision", "queue"]
    assert first.get_json()["status"] == "factory_queued"
    assert first.get_json()["selectionStatus"] == "saving"
    assert first.get_json()["order"]["orderId"] == second.get_json()["order"]["orderId"]
    assert pdp.decisions[0]["selectedId"] == ASSET_ID
    assert pdp.decisions[0]["expectedVersion"] == 4


def test_pdp_failure_blocks_external_and_never_queues_factory(tmp_path: Path) -> None:
    client, _pdp, _factory, events = _selection_client(
        tmp_path,
        fail_decision=True,
    )

    response = client.post("/api/factory/a-cuts/select", json=_selection_payload())

    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "blocked_external"
    assert events == ["decision"]


def test_auto_exact_one_uses_same_endpoint_and_records_deterministic_receipt(
    tmp_path: Path,
) -> None:
    client, pdp, _factory, events = _selection_client(tmp_path)
    snapshot = build_policy_snapshot(
        "batch-a",
        "factory:product-a",
        "full_auto",
        {},
        {},
        {"representative_image": "auto"},
    )

    response = client.post(
        "/api/factory/a-cuts/select",
        json=_selection_payload(
            candidateId="",
            decisionMode="auto",
            policySnapshot=snapshot,
            judgementOptions={
                "model": "latestModel",
                "reasoningEffort": "high",
                "serviceTier": "standard",
                "preset": "fast_single",
            },
        ),
    )

    assert response.status_code == 202
    body = response.get_json()
    assert body["decisionReceipt"]["decisionMethod"] == "deterministic_single_candidate"
    assert body["decisionReceipt"]["model"] == "deterministic"
    assert body["order"]["command"]["payload"]["candidateId"] == ASSET_ID
    assert pdp.decisions[0]["mode"] == "auto"
    assert events == ["decision", "queue"]


def test_auto_multiple_candidates_uses_gpt_and_same_composite_receipt_path(
    tmp_path: Path,
) -> None:
    judge = GptJudgeFake()
    client, pdp, _factory, events = _selection_client(
        tmp_path,
        multiple=True,
        gpt_judge=judge,
    )
    snapshot = build_policy_snapshot(
        "batch-a",
        "factory:product-a",
        "full_auto",
        {},
        {},
        {"representative_image": "auto"},
    )

    response = client.post(
        "/api/factory/a-cuts/select",
        json=_selection_payload(
            candidateId="",
            decisionMode="auto",
            policySnapshot=snapshot,
            judgementOptions={
                "model": "gpt-verified",
                "reasoningEffort": "high",
                "serviceTier": "standard",
                "preset": "fast_single",
            },
        ),
    )

    assert response.status_code == 202
    body = response.get_json()
    assert len(judge.calls) == 1
    assert body["decisionReceipt"]["decisionMethod"] == "gpt_oauth_single_review"
    assert body["decisionReceipt"]["model"] == "gpt-verified"
    assert body["decisionReceipt"]["reasoningEffort"] == "high"
    assert body["order"]["command"]["payload"]["candidateId"] == SECOND_ASSET_ID
    assert pdp.decisions[0]["selectedId"] == SECOND_ASSET_ID
    assert events == ["decision", "queue"]


def test_selection_rejects_missing_target_membership_and_stale_identity(
    tmp_path: Path,
) -> None:
    client, pdp, _factory, events = _selection_client(tmp_path)

    missing = client.post(
        "/api/factory/a-cuts/select",
        json={key: value for key, value in _selection_payload().items() if key != "jobId"},
    )
    foreign = client.post(
        "/api/factory/a-cuts/select",
        json=_selection_payload(candidateId="foreign-candidate"),
    )
    stale = client.post(
        "/api/factory/a-cuts/select",
        json=_selection_payload(expectedProjectionCursor="6"),
    )

    assert missing.status_code == 422
    assert missing.get_json()["error"]["code"] == "decision_target_required"
    assert foreign.status_code == 422
    assert foreign.get_json()["error"]["code"] == "candidate_membership_invalid"
    assert stale.status_code == 409
    assert stale.get_json()["error"]["code"] == "stale_event_sequence"
    assert pdp.decisions == []
    assert events == []
