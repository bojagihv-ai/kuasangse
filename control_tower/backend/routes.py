from __future__ import annotations

import json
import re
import secrets
from collections.abc import Mapping
from typing import Final, Protocol, TypeAlias, assert_never
from uuid import uuid4

from flask import Flask, Response, jsonify, request, stream_with_context

from .runtime_cache import JsonObject, JsonValue
from .pdp_client import PdpHttpError
from .cafe24_bridge import Cafe24BridgeError, Cafe24CommandBridge, UnavailableCafe24CommandBridge, build_cafe24_command, build_cafe24_reconcile_command
from .cafe24_staging import APPROVAL_BINDING_FIELDS, Cafe24ApprovalGate, Cafe24StagingError, build_preview, verify_readback
from .handoff import HandoffError, HandoffStore
from .factory_sync import FactorySyncBridge, FactorySyncError
from .candidate_selector import CandidateSelectionError, decide_candidates
from .gpt_oauth import GptOAuthError, GptOAuthJudge
from .policy import (
    COMPETITOR_MARKETS,
    DECISION_POINT_IDS,
    POLICY_PRESETS,
    PolicyError,
    build_policy_snapshot,
)
from .pdp_workbench_client import PdpWorkbenchApi
from .publication_recovery import RecoveryDependencies, register_publication_recovery_route
from .workbench_routes import OUTPUT_FACTORY_STAGES, register_workbench_routes


class ExternalDependencyError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class StaleVersionError(Exception):
    def __init__(self, code: str = "stale_version") -> None:
        self.code = code
        super().__init__(code)


FACTORY_DECISION_TYPES: Final = {
    "representative": "representative_image",
    "size": "size_image",
    "option_color": "option_image",
    "general": "general_image",
    "sections": "section_variant",
    "final_detail": "final_detail",
}
SENSITIVE_EVENT_FIELD: Final = re.compile(
    r"authorization|bearer|secret|password|credential|access.?token|refresh.?token|api.?key|service.?key|csrf|cookie|operation.?token",
    re.IGNORECASE,
)


class PdpApi(Protocol):
    def create_input_snapshot(self, payload: JsonObject) -> JsonObject: ...

    def create_job(self, payload: JsonObject) -> JsonObject: ...

    def get_capabilities(self) -> JsonObject: ...

    def list_sources(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_readiness(self, jcode: int) -> JsonObject: ...

    def worker_claim(self, payload: JsonObject) -> JsonObject: ...

    def worker_lifecycle(self, order_id: str, action: str, payload: JsonObject) -> JsonObject: ...

    def list_jobs(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_job(self, job_id: str) -> JsonObject: ...

    def list_reviews(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_requirements(self, job_id: str) -> JsonObject: ...

    def create_decision(self, job_id: str, payload: JsonObject) -> JsonObject: ...

    def create_publication_receipt(self, job_id: str, payload: JsonObject) -> JsonObject: ...

    def get_publication_events(self, job_id: str) -> JsonObject: ...


class UnavailablePdpApi:
    def create_input_snapshot(self, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def create_job(self, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def get_capabilities(self) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def list_sources(self, query: Mapping[str, JsonValue]) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def get_readiness(self, jcode: int) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def worker_claim(self, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def worker_lifecycle(self, order_id: str, action: str, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def list_jobs(self, query: Mapping[str, JsonValue]) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def get_job(self, job_id: str) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def list_reviews(self, query: Mapping[str, JsonValue]) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def get_requirements(self, job_id: str) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def create_decision(self, job_id: str, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def create_publication_receipt(self, job_id: str, payload: JsonObject) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")

    def get_publication_events(self, job_id: str) -> JsonObject:
        raise ExternalDependencyError("pdp_unavailable")


class LocalSessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, str] = {}

    def issue(self) -> tuple[str, str]:
        session_id = secrets.token_urlsafe(24)
        csrf_token = secrets.token_urlsafe(24)
        self._sessions[session_id] = csrf_token
        return session_id, csrf_token

    def csrf_for(self, session_id: str | None) -> str | None:
        return None if session_id is None else self._sessions.get(session_id)


SESSION_COOKIE: Final = "control_tower_session"
JsonMapping: TypeAlias = Mapping[str, JsonValue]


def _correlation_id() -> str:
    return f"ct-{uuid4().hex}"


def _error(code: str, status: int, *, retryable: bool, correlation_id: str) -> tuple[Response, int]:
    return (
        jsonify(
            {
                "error": {
                    "code": code,
                    "message": "외부 원장 상태를 확인한 뒤 다시 시도해 주세요." if code == "blocked_external" else "요청을 처리할 수 없습니다.",
                    "retryable": retryable,
                    "correlationId": correlation_id,
                },
            },
        ),
        status,
    )


def _json_object() -> JsonObject | None:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else None


def _factory_stage_candidates(
    projection: Mapping[str, JsonValue],
    stage_key: str,
) -> list[JsonObject]:
    stages = projection.get("stages")
    if not isinstance(stages, list):
        return []
    stage = next(
        (
            item
            for item in stages
            if isinstance(item, dict) and item.get("key") == stage_key
        ),
        None,
    )
    candidates = stage.get("candidates") if isinstance(stage, dict) else None
    return [
        {
            "candidateId": str(item["id"]),
            "assetId": str(item.get("assetId") or ""),
        }
        for item in candidates
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ] if isinstance(candidates, list) else []


def _bundle_stage_candidates(
    bundle: Mapping[str, JsonValue],
    stage_key: str,
) -> list[JsonObject]:
    assets = bundle.get("assets")
    result: list[JsonObject] = []
    if not isinstance(assets, list):
        return result
    for item in assets:
        if not isinstance(item, dict) or item.get("phase") != "output":
            continue
        role = item.get("role")
        if not isinstance(role, str) or OUTPUT_FACTORY_STAGES.get(role, "general") != stage_key:
            continue
        asset_id = item.get("id")
        asset_key = item.get("assetKey")
        checksum = item.get("sourceChecksum")
        if all(isinstance(value, str) and value for value in (asset_id, asset_key, checksum)):
            result.append(
                {
                    "candidateId": asset_id,
                    "assetId": asset_id,
                    "storedAssetId": str(item.get("storedAssetId") or ""),
                    "identityKey": asset_key,
                    "contentDigest": checksum,
                },
            )
    return result


def _map_factory_bundle_candidates(
    factory_candidates: list[JsonObject],
    bundle_candidates: list[JsonObject],
) -> list[JsonObject]:
    result: list[JsonObject] = []
    used_assets: set[str] = set()
    for factory_candidate in factory_candidates:
        candidate_id = str(factory_candidate["candidateId"])
        candidate_asset_id = str(factory_candidate.get("assetId") or "")
        matches = [
            asset
            for asset in bundle_candidates
            if (
                candidate_asset_id
                and candidate_asset_id
                in {
                    str(asset["assetId"]),
                    str(asset.get("storedAssetId") or ""),
                }
            )
            or candidate_id == str(asset["assetId"])
        ]
        if len(matches) > 1:
            raise CandidateSelectionError("candidate_identity_ambiguous")
        if not matches:
            continue
        asset = matches[0]
        asset_id = str(asset["assetId"])
        if asset_id in used_assets:
            raise CandidateSelectionError("candidate_identity_ambiguous")
        used_assets.add(asset_id)
        result.append(
            {
                **asset,
                "candidateId": candidate_id,
                "factoryCandidateId": candidate_id,
            },
        )
    return result


def _manual_selection_receipt(
    payload: Mapping[str, JsonValue],
    candidate_id: str,
) -> JsonObject:
    options = payload.get("judgementOptions")
    option_values = options if isinstance(options, dict) else {}
    return {
        "schema": "gpt-judgment-receipt:v1",
        "decisionType": "factory_a_cut",
        "decisionMethod": "manual_explicit_selection",
        "selectedCandidateId": candidate_id,
        "rationale": str(payload.get("rationale") or "사용자가 후보를 명시적으로 선택했습니다."),
        "model": "manual",
        "reasoningEffort": "none",
        "serviceTier": str(option_values.get("serviceTier") or "none"),
        "preset": str(option_values.get("preset") or "manual"),
        "confidence": 1.0,
        "holdReason": "",
    }


def _validated_limit_query() -> tuple[dict[str, JsonValue], bool]:
    query: dict[str, JsonValue] = {key: value for key, value in request.args.items()}
    raw_limit = request.args.get("limit")
    if raw_limit is None:
        return query, True
    try:
        limit = int(raw_limit)
    except ValueError:
        return query, False
    if limit < 1 or limit > 200:
        return query, False
    query["limit"] = limit
    return query, True


def _has_raw_path(value: JsonValue) -> bool:
    match value:
        case dict() as mapping:
            return any(key.casefold() in {"filepath", "sourcepath", "absolutepath"} or _has_raw_path(child) for key, child in mapping.items())
        case list() as values:
            return any(_has_raw_path(child) for child in values)
        case str() | int() | float() | bool() | None:
            return False
        case unreachable:
            assert_never(unreachable)


def _public_event_value(value: JsonValue) -> JsonValue:
    match value:
        case dict() as mapping:
            return {
                key: _public_event_value(child)
                for key, child in mapping.items()
                if not SENSITIVE_EVENT_FIELD.search(key)
            }
        case list() as values:
            return [_public_event_value(child) for child in values]
        case str() | int() | float() | bool() | None:
            return value
        case unreachable:
            assert_never(unreachable)


def register_routes(
    app: Flask,
    pdp_api: PdpApi | None = None,
    cafe24_bridge: Cafe24CommandBridge | None = None,
    workbench_api: PdpWorkbenchApi | None = None,
    factory_sync_bridge: FactorySyncBridge | None = None,
    gpt_judge: GptOAuthJudge | None = None,
) -> None:
    api = pdp_api if pdp_api is not None else UnavailablePdpApi()
    bridge = cafe24_bridge if cafe24_bridge is not None else UnavailableCafe24CommandBridge()
    sessions = LocalSessionStore()
    handoffs = HandoffStore()
    cafe24_approvals = Cafe24ApprovalGate()
    factory_sync = factory_sync_bridge if factory_sync_bridge is not None else FactorySyncBridge()
    judge = gpt_judge if gpt_judge is not None else GptOAuthJudge()

    @app.get("/api/session")
    def session() -> Response:
        session_id = request.cookies.get(SESSION_COOKIE)
        csrf_token = sessions.csrf_for(session_id)
        if csrf_token is None:
            session_id, csrf_token = sessions.issue()
        response = jsonify({"session": "ready", "sessionId": session_id, "csrfToken": csrf_token})
        response.set_cookie(SESSION_COOKIE, session_id, httponly=True, samesite="Strict")
        return response

    def require_csrf() -> tuple[Response, int] | None:
        session_id = request.cookies.get(SESSION_COOKIE) or request.headers.get("X-Control-Tower-Session")
        expected = sessions.csrf_for(session_id)
        provided = request.headers.get("X-Control-Tower-CSRF")
        return None if expected is not None and provided == expected else _error("csrf_required", 428, retryable=False, correlation_id=_correlation_id())

    def require_session_cookie() -> tuple[Response, int] | None:
        session_id = request.cookies.get(SESSION_COOKIE)
        return None if sessions.csrf_for(session_id) is not None else _error("session_required", 401, retryable=False, correlation_id=_correlation_id())

    register_publication_recovery_route(
        app,
        RecoveryDependencies(api=api, factory=factory_sync, csrf_guard=require_csrf),
    )

    @app.get("/api/automation/policy")
    def automation_policy() -> Response:
        return jsonify(
            {
                "schema": "automation-policy-registry:v1",
                "defaultPreset": "full_auto",
                "decisionPointIds": list(DECISION_POINT_IDS),
                "competitorMarkets": list(COMPETITOR_MARKETS),
                "presets": POLICY_PRESETS,
                "precedence": [
                    "stage",
                    "product",
                    "batch",
                    "batch_preset",
                    "auto_default",
                ],
            },
        )

    @app.post("/api/automation/policy/snapshot")
    def automation_policy_snapshot() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            batch_id = str(payload.get("batchId") or "").strip()
            product_id = str(payload.get("productId") or "").strip()
            preset = str(payload.get("preset") or "full_auto").strip()
            if not batch_id or not product_id:
                raise PolicyError("policy_identity_missing")
            overrides: list[dict[str, str]] = []
            for key in ("batchOverride", "productOverride", "stageOverride"):
                raw = payload.get(key, {})
                if not isinstance(raw, dict) or not all(
                    isinstance(decision, str) and isinstance(mode, str)
                    for decision, mode in raw.items()
                ):
                    raise PolicyError("policy_override_invalid")
                overrides.append(dict(raw))
            snapshot = build_policy_snapshot(
                batch_id,
                product_id,
                preset,
                overrides[0],
                overrides[1],
                overrides[2],
            )
        except PolicyError as error:
            return _error(error.code, 422, retryable=False, correlation_id=_correlation_id())
        return jsonify(snapshot), 201

    @app.post("/api/automation/decisions")
    def automation_decision() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        job_id = str(payload.get("jobId") or "").strip()
        decision_type = str(payload.get("decisionType") or "").strip()
        raw_identity = payload.get("identity")
        raw_policy = payload.get("policySnapshot")
        raw_candidates = payload.get("candidates")
        raw_inputs = payload.get("inputRefs", [])
        raw_options = payload.get("judgementOptions", {})
        if (
            not job_id
            or not decision_type
            or not isinstance(raw_identity, dict)
            or str(raw_identity.get("jobId") or "") != job_id
            or not isinstance(raw_policy, dict)
            or not isinstance(raw_candidates, list)
            or not all(isinstance(item, dict) for item in raw_candidates)
            or not isinstance(raw_inputs, list)
            or not all(isinstance(item, dict) for item in raw_inputs)
            or not isinstance(raw_options, dict)
        ):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = decide_candidates(
                decision_type,
                raw_candidates,
                identity=raw_identity,
                policy_snapshot=raw_policy,
                judge=judge,
                input_refs=raw_inputs,
                model=str(raw_options.get("model") or "latestModel"),
                reasoning_effort=str(raw_options.get("reasoningEffort") or "medium"),
                service_tier=str(raw_options.get("serviceTier") or "standard"),
                preset=str(raw_options.get("preset") or "fast_single"),
                persist=lambda target_job_id, receipt: api.create_decision(
                    target_job_id,
                    {
                        "candidateId": receipt.get("selectedCandidateId") or "",
                        "idempotencyKey": receipt["receiptId"],
                        "decisionType": receipt["decisionType"],
                        "status": "manual_required"
                        if receipt.get("holdReason")
                        else "selected",
                        "judgmentReceipt": receipt,
                    },
                ),
            )
        except CandidateSelectionError as error:
            status = 409 if error.code.startswith(("policy_snapshot_", "stale_")) else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        except GptOAuthError as error:
            return _error(error.code, 503 if error.retryable else 422, retryable=error.retryable, correlation_id=_correlation_id())
        except (ExternalDependencyError, PdpHttpError):
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(
            {
                "status": result.status,
                "candidateId": result.candidate_id,
                "reason": result.reason,
                "receipt": result.receipt,
            },
        )

    def invoke(method: str, payload: JsonObject) -> JsonObject | tuple[Response, int]:
        try:
            handler = getattr(api, method)
            return handler(payload) if method != "get_capabilities" else handler()
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except StaleVersionError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        except PdpHttpError as error:
            if error.code in {"stale_version", "idempotency_conflict"}:
                return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
            if error.code == "pdp_request_invalid":
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())

    def invoke_worker(action: str, order_id: str | None, payload: JsonObject) -> JsonObject | tuple[Response, int]:
        try:
            if action == "claim":
                if factory_sync.has_pending():
                    factory_claim = factory_sync.claim(payload)
                    if factory_claim.get("order") is not None:
                        return factory_claim
                local_claim = getattr(bridge, "claim", None)
                if callable(local_claim):
                    local_result = local_claim(payload)
                    if local_result.get("order") is not None:
                        return local_result
                return api.worker_claim(payload)
            if order_id is None:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            if factory_sync.owns(order_id):
                return factory_sync.lifecycle(order_id, action, payload)
            local_owns = getattr(bridge, "owns", None)
            local_lifecycle = getattr(bridge, "lifecycle", None)
            if callable(local_owns) and callable(local_lifecycle) and local_owns(order_id):
                return local_lifecycle(order_id, action, payload)
            return api.worker_lifecycle(order_id, action, payload)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            if error.code in {"stale_version", "stale_event_sequence", "stale_fencing_token", "stale_run_fingerprint", "lease_conflict", "idempotency_conflict"}:
                return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except StaleVersionError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        except Cafe24BridgeError as error:
            conflict_codes = {
                "stale_event_sequence",
                "stale_fencing_token",
                "stale_run_fingerprint",
                "stale_workfile_revision",
                "lease_conflict",
                "idempotency_conflict",
            }
            return _error(
                error.code,
                409 if error.code in conflict_codes else 422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        except FactorySyncError as error:
            conflict_codes = {
                "factory_session_missing",
                "stale_event_sequence",
                "stale_fencing_token",
                "stale_run_fingerprint",
                "stale_workfile_revision",
                "lease_conflict",
            }
            return _error(
                error.code,
                409 if error.code in conflict_codes else 422,
                retryable=False,
                correlation_id=_correlation_id(),
            )

    def record_cafe24_publication(job_id: str, preview: Mapping[str, JsonValue], bridge_result: Mapping[str, JsonValue]) -> JsonObject:
        readback = verify_readback(
            preview,
            {
                "payloadDigest": bridge_result.get("payloadDigest"),
                "externalProductNo": bridge_result.get("externalProductNo"),
                "remoteReadbackDigest": bridge_result.get("remoteReadbackDigest"),
            },
        )
        payload = preview.get("payload")
        if not isinstance(payload, dict):
            raise Cafe24StagingError("staging_payload_invalid")
        receipt_payload: JsonObject = {
            "target": "cafe24",
            "targetKey": payload["productId"],
            "payloadDigest": readback["payloadDigest"],
            "remoteId": readback["externalProductNo"],
            "observedPayloadDigest": readback["remoteReadbackDigest"],
            "idempotencyKey": readback["idempotencyKey"],
            "actor": "production-control-tower",
        }
        return api.create_publication_receipt(job_id, receipt_payload)

    @app.get("/api/pdp/capabilities")
    def capabilities() -> Response | tuple[Response, int]:
        result = invoke("get_capabilities", {})
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/sources")
    def product_sources() -> Response | tuple[Response, int]:
        query = {
            key: value
            for key, value in request.args.items()
            if key in {"jcode", "q"}
        }
        try:
            result = api.list_sources(query)
        except (ExternalDependencyError, PdpHttpError):
            return _error(
                "blocked_external",
                503,
                retryable=True,
                correlation_id=_correlation_id(),
            )
        return jsonify(result)

    @app.get("/api/pdp/readiness")
    def product_readiness() -> Response | tuple[Response, int]:
        raw_jcode = request.args.get("jcode", "")
        try:
            jcode = int(raw_jcode)
        except ValueError:
            return _error(
                "request_invalid",
                422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        if jcode < 1:
            return _error(
                "request_invalid",
                422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        try:
            result = api.get_readiness(jcode)
        except (ExternalDependencyError, PdpHttpError):
            return _error(
                "blocked_external",
                503,
                retryable=True,
                correlation_id=_correlation_id(),
            )
        return jsonify(result)

    @app.get("/api/jobs")
    def list_jobs() -> Response | tuple[Response, int]:
        query, valid_limit = _validated_limit_query()
        if not valid_limit:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = api.list_jobs(query)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            if error.status == 422:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(result)

    @app.get("/api/jobs/<job_id>")
    def get_job(job_id: str) -> Response | tuple[Response, int]:
        try:
            result = api.get_job(job_id)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            status = 409 if error.code == "stale_version" else 503
            return _error(error.code if status == 409 else "blocked_external", status, retryable=False if status == 409 else True, correlation_id=_correlation_id())
        return jsonify(result)

    @app.get("/api/jobs/<job_id>/publication-events")
    def get_publication_events(job_id: str) -> Response | tuple[Response, int]:
        try:
            result = api.get_publication_events(job_id)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            return _error(
                error.code if error.status == 409 else "blocked_external",
                409 if error.status == 409 else 503,
                retryable=error.status != 409,
                correlation_id=_correlation_id(),
            )
        return jsonify(result)

    @app.get("/api/events/<job_id>")
    def stream_job_state(job_id: str) -> Response | tuple[Response, int]:
        try:
            state = api.get_job(job_id)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())

        @stream_with_context
        def event_stream():
            yield f"event: job-state\ndata: {json.dumps(state, ensure_ascii=False, separators=(',', ':'))}\n\n"

        response = Response(event_stream(), mimetype="text/event-stream")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"
        return response

    @app.get("/api/reviews")
    def list_reviews() -> Response | tuple[Response, int]:
        query, valid_limit = _validated_limit_query()
        if not valid_limit:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = api.list_reviews(query)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            if error.status == 422:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(result)

    @app.get("/api/jobs/<job_id>/requirements")
    def get_requirements(job_id: str) -> Response | tuple[Response, int]:
        try:
            result = api.get_requirements(job_id)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(result)

    @app.post("/api/handoff/open")
    def open_handoff() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        settings = app.config["CONTROL_TOWER_CONFIG"]
        try:
            result = handoffs.issue(payload, factory_url=settings.factory_frontend_url)
        except HandoffError as error:
            return _error(error.code, 422, retryable=False, correlation_id=_correlation_id())
        return jsonify(result), 201

    @app.get("/api/handoff/<token>")
    def consume_handoff(token: str) -> Response | tuple[Response, int]:
        raw_revision = request.args.get("expectedRevision", "")
        try:
            expected_revision = int(raw_revision)
            result = handoffs.consume(token, expected_revision=expected_revision)
        except (ValueError, HandoffError) as error:
            code = error.code if isinstance(error, HandoffError) else "request_invalid"
            return _error(code, 409 if code == "stale_workfile_revision" else 410, retryable=False, correlation_id=_correlation_id())
        return jsonify(result)

    @app.post("/api/cafe24/staging-preview")
    def cafe24_staging_preview() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            build_preview(payload)
            result = build_preview(payload, authority=bridge.inspect())
            approval = cafe24_approvals.issue(result)
        except Cafe24StagingError as error:
            status = 409 if error.code.startswith("stale_") or error.code == "factory_cafe24_target_mismatch" else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        except Cafe24BridgeError as error:
            return _error(error.code, 503, retryable=True, correlation_id=_correlation_id())
        return jsonify({**result, **approval})

    @app.post("/api/cafe24/preflight")
    def cafe24_preflight() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        try:
            result = bridge.inspect()
        except Cafe24BridgeError as error:
            return _error(error.code, 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(result)

    @app.post("/api/cafe24/approve")
    def cafe24_approve() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        request_id = payload.get("approvalRequestId") if payload is not None else None
        if payload is None or not isinstance(request_id, str) or not request_id.strip() or payload.get("approved") is not True:
            return _error("approval_required", 409, retryable=False, correlation_id=_correlation_id())
        binding = {key: payload.get(key) for key in APPROVAL_BINDING_FIELDS}
        try:
            result = cafe24_approvals.approve(request_id, binding)
        except Cafe24StagingError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        return jsonify(result)

    @app.post("/api/cafe24/publish")
    def cafe24_publish() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        token = payload.get("approvalToken") if payload is not None else None
        job_id = payload.get("jobId") if payload is not None else None
        if payload is None or not isinstance(token, str) or not token.strip() or not isinstance(job_id, str) or not job_id.strip():
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        binding = {key: payload.get(key) for key in APPROVAL_BINDING_FIELDS}
        grant: JsonObject | None = None
        reservation_open = False
        try:
            grant = cafe24_approvals.reserve(token, binding)
            reservation_open = True
            command = build_cafe24_command(grant, str(grant["approvalGrantDigest"]), job_id=job_id)
            validated = build_preview(grant["payload"], authority=bridge.inspect())
            if validated["payloadDigest"] != grant["payloadDigest"]:
                raise Cafe24StagingError("approval_binding_mismatch")
            cafe24_approvals.commit(str(grant["approvalGrantDigest"]))
            reservation_open = False
            bridge_result = bridge.execute(command)
            receipt = record_cafe24_publication(job_id, grant, bridge_result)
        except Cafe24StagingError as error:
            if reservation_open and grant is not None:
                cafe24_approvals.reject(str(grant["approvalGrantDigest"]))
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        except Cafe24BridgeError as error:
            if reservation_open and grant is not None:
                cafe24_approvals.reject(str(grant["approvalGrantDigest"]))
            return _error(error.code, 503, retryable=True, correlation_id=_correlation_id())
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify({"status": "staged_verified", "command": command, "publicationReceipt": receipt})

    @app.post("/api/cafe24/reconcile")
    def cafe24_reconcile() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        job_id = payload.get("jobId") if payload is not None else None
        claimed_digest = payload.get("payloadDigest") if payload is not None else None
        if payload is None or not isinstance(job_id, str) or not job_id.strip() or not isinstance(claimed_digest, str) or not claimed_digest.strip():
            return _error("approval_binding_mismatch", 409, retryable=False, correlation_id=_correlation_id())
        try:
            preview = build_preview(payload)
            if preview["payloadDigest"] != claimed_digest:
                raise Cafe24StagingError("approval_binding_mismatch")
            command = build_cafe24_reconcile_command(preview, job_id=job_id)
            bridge_result = bridge.execute(command)
            receipt = record_cafe24_publication(job_id, preview, bridge_result)
        except Cafe24StagingError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        except Cafe24BridgeError as error:
            return _error(error.code, 503, retryable=True, correlation_id=_correlation_id())
        except (ExternalDependencyError, PdpHttpError):
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify({"status": "staged_verified", "externalWrite": False, "command": command, "publicationReceipt": receipt})

    @app.get("/api/factory/state")
    def factory_state() -> Response:
        return jsonify(factory_sync.current_state())

    @app.post("/api/factory/session/hello")
    def factory_session_hello() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            http_session_id = request.cookies.get(SESSION_COOKIE) or request.headers.get("X-Control-Tower-Session")
            result = factory_sync.hello({**payload, "_httpSessionId": str(http_session_id or "")})
        except FactorySyncError as error:
            conflict_codes = {"stale_factory_session", "stale_session_cursor", "stale_run_fingerprint"}
            return _error(
                error.code,
                409 if error.code in conflict_codes else 422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        return jsonify(result)

    @app.post("/api/factory/session/heartbeat")
    def factory_session_heartbeat() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = factory_sync.session_heartbeat(payload)
        except FactorySyncError as error:
            conflict_codes = {
                "factory_session_missing",
                "stale_factory_session",
                "stale_session_cursor",
                "stale_run_fingerprint",
            }
            return _error(
                error.code,
                409 if error.code in conflict_codes else 422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        return jsonify(result)

    @app.post("/api/factory/sync")
    def factory_sync_projection() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        projection = payload.get("projection") if payload is not None else None
        if not isinstance(projection, dict) or _has_raw_path(projection):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = (
                factory_sync.accept_session_projection(payload)
                if isinstance(payload.get("sessionId"), str)
                else factory_sync.accept_projection(projection)
            )
        except FactorySyncError as error:
            status = 409 if error.code.startswith("stale_") else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify(result)

    @app.post("/api/factory/refresh")
    def factory_refresh() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        return jsonify({"accepted": True, "order": factory_sync.queue_snapshot()}), 202

    @app.post("/api/factory/workfile/hydrate")
    def factory_workfile_hydrate() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or any(
            key.casefold() in {"filepath", "sourcepath", "absolutepath", "path"}
            for key in payload
        ):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            order = factory_sync.queue_workfile_hydration(payload)
        except FactorySyncError as error:
            conflict_codes = {
                "factory_session_missing",
                "idempotency_conflict",
                "stale_factory_session",
                "stale_workfile_revision",
            }
            return _error(
                error.code,
                409 if error.code in conflict_codes else 422,
                retryable=False,
                correlation_id=_correlation_id(),
            )
        return jsonify({
            "accepted": True,
            "order": {
                key: value
                for key, value in order.items()
                if key not in {"command", "operationToken", "workerHttpSessionId"}
            },
        }), 202

    @app.post("/api/factory/a-cuts/select")
    def factory_select_a_cut() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        required_text = {
            key: str(payload.get(key) or "").strip()
            for key in (
                "bundleId",
                "jobId",
                "productId",
                "productKey",
                "stageKey",
                "expectedRunId",
                "expectedInputFingerprint",
                "expectedProjectionCursor",
                "idempotencyKey",
                "decisionMode",
            )
        }
        revision = payload.get("expectedRevision")
        if (
            workbench_api is None
            or any(not value for value in required_text.values())
            or required_text["decisionMode"] not in {"manual", "auto"}
            or type(revision) is not int
            or revision < 0
        ):
            return _error("decision_target_required", 422, retryable=False, correlation_id=_correlation_id())
        try:
            job = api.get_job(required_text["jobId"])
            bundle = workbench_api.get_work_bundle(required_text["bundleId"])
        except (ExternalDependencyError, PdpHttpError):
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())

        job_version = job.get("version")
        bundle_key = str(bundle.get("bundleKey") or "")
        expected_bundle_keys = {
            required_text["productKey"],
            f"kuasangse:{required_text['productKey']}",
        }
        job_product_id = job.get("productId")
        job_product_key = job.get("productKey")
        if (
            job.get("jobId") != required_text["jobId"]
            or type(job_version) is not int
            or job_version < 1
            or bundle.get("id") != required_text["bundleId"]
            or bundle_key not in expected_bundle_keys
            or (
                isinstance(job_product_id, str)
                and job_product_id
                and job_product_id != required_text["productId"]
            )
            or (
                isinstance(job_product_key, str)
                and job_product_key
                and job_product_key != required_text["productKey"]
            )
        ):
            return _error("decision_target_required", 422, retryable=False, correlation_id=_correlation_id())

        projection = factory_sync.current_state()
        if str(projection.get("cursor") or "") != required_text["expectedProjectionCursor"]:
            return _error("stale_event_sequence", 409, retryable=False, correlation_id=_correlation_id())
        bundle_candidates = _bundle_stage_candidates(bundle, required_text["stageKey"])
        try:
            candidates = _map_factory_bundle_candidates(
                _factory_stage_candidates(projection, required_text["stageKey"]),
                bundle_candidates,
            )
        except CandidateSelectionError as error:
            return _error(error.code, 422, retryable=False, correlation_id=_correlation_id())
        candidate_ids = [str(candidate["candidateId"]) for candidate in candidates]
        candidate_asset_map = {
            str(candidate["candidateId"]): str(candidate["assetId"])
            for candidate in candidates
        }
        selected_id = str(payload.get("candidateId") or "").strip()
        receipt: JsonObject
        selection_status = "selected"
        if required_text["decisionMode"] == "manual":
            if not selected_id or selected_id not in candidate_ids:
                return _error("candidate_membership_invalid", 422, retryable=False, correlation_id=_correlation_id())
            receipt = _manual_selection_receipt(payload, selected_id)
        else:
            raw_policy = payload.get("policySnapshot")
            raw_options = payload.get("judgementOptions")
            if not isinstance(raw_policy, dict) or not isinstance(raw_options, dict):
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            session = projection.get("session")
            if not isinstance(session, dict):
                return _error("factory_session_missing", 409, retryable=False, correlation_id=_correlation_id())
            try:
                selection = decide_candidates(
                    FACTORY_DECISION_TYPES.get(
                        required_text["stageKey"],
                        required_text["stageKey"],
                    ),
                    candidates,
                    identity={
                        "jobId": required_text["jobId"],
                        "productId": required_text["productId"],
                        "productKey": required_text["productKey"],
                        "runId": required_text["expectedRunId"],
                        "inputFingerprint": required_text["expectedInputFingerprint"],
                        "revision": revision,
                        "eventId": required_text["expectedProjectionCursor"],
                        "projectionCursor": required_text["expectedProjectionCursor"],
                    },
                    policy_snapshot=raw_policy,
                    judge=judge,
                    model=str(raw_options.get("model") or "latestModel"),
                    reasoning_effort=str(raw_options.get("reasoningEffort") or "medium"),
                    service_tier=str(raw_options.get("serviceTier") or "standard"),
                    preset=str(raw_options.get("preset") or "fast_single"),
                )
            except CandidateSelectionError as error:
                return _error(error.code, 422, retryable=False, correlation_id=_correlation_id())
            except GptOAuthError as error:
                return _error(
                    error.code,
                    503 if error.retryable else 422,
                    retryable=error.retryable,
                    correlation_id=_correlation_id(),
                )
            if not isinstance(selection.receipt, dict):
                return _error("decision_receipt_missing", 422, retryable=False, correlation_id=_correlation_id())
            receipt = selection.receipt
            selection_status = selection.status
            selected_id = str(selection.candidate_id or "")
        receipt["candidateAssetMap"] = candidate_asset_map
        receipt["selectedAssetId"] = candidate_asset_map.get(selected_id, "")

        decision_payload: JsonObject = {
            "mode": required_text["decisionMode"],
            "decision": "approve" if selected_id else None,
            "candidateIds": candidate_ids,
            "selectedId": selected_id or None,
            "judgeId": (
                "manual"
                if required_text["decisionMode"] == "manual"
                else "chatgpt_login_oauth"
            ),
            "model": str(receipt.get("model") or "deterministic"),
            "reasoningEffort": (
                "low"
                if required_text["decisionMode"] == "manual"
                else str(receipt.get("reasoningEffort") or "medium")
            ),
            "promptVersion": str(receipt.get("preset") or "factory-a-cut:v1"),
            "schemaVersion": "factory-a-cut-decision:v1",
            "evidenceRefs": [
                f"work-bundle:{required_text['bundleId']}",
                *[
                    f"factory-candidate:{candidate_id}:asset:{candidate_asset_map[candidate_id]}"
                    for candidate_id in candidate_ids
                ],
            ],
            "confidence": receipt.get("confidence", 1.0 if selected_id else 0.0),
            "abstained": not bool(selected_id),
            "expectedVersion": job_version,
            "idempotencyKey": f"pdp:{required_text['idempotencyKey']}",
            "actor": "batch-production-control",
        }
        try:
            pdp_receipt = api.create_decision(required_text["jobId"], decision_payload)
        except (ExternalDependencyError, PdpHttpError):
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        receipt["persistence"] = pdp_receipt
        if selection_status != "selected" or not selected_id:
            return jsonify(
                {
                    "accepted": False,
                    "status": "decision_recorded",
                    "selectionStatus": selection_status,
                    "pdpReceipt": pdp_receipt,
                    "decisionReceipt": receipt,
                },
            ), 200
        queue_payload = {
            **payload,
            "candidateId": selected_id,
        }
        try:
            order = factory_sync.queue_selection(queue_payload)
        except FactorySyncError as error:
            return jsonify(
                {
                    "accepted": False,
                    "status": "decision_recorded",
                    "error": {"code": error.code, "retryable": False},
                    "pdpReceipt": pdp_receipt,
                    "decisionReceipt": receipt,
                },
            ), 409 if error.code in {
                "factory_session_missing",
                "idempotency_conflict",
                "stale_run_fingerprint",
                "stale_workfile_revision",
            } else 422
        return jsonify(
            {
                "accepted": True,
                "status": "factory_queued",
                "selectionStatus": "saving",
                "pdpReceipt": pdp_receipt,
                "decisionReceipt": receipt,
                "order": order,
            },
        ), 202

    @app.get("/api/factory/events")
    def factory_events() -> Response | tuple[Response, int]:
        session_error = require_session_cookie()
        if session_error is not None:
            return session_error
        cursor = request.headers.get("Last-Event-ID") or request.args.get("cursor", "0")

        @stream_with_context
        def event_stream():
            current_cursor = str(cursor or "0")
            while True:
                events = factory_sync.wait_events_after(current_cursor, timeout=15.0)
                if not events:
                    yield ": heartbeat\n\n"
                    continue
                for event in events:
                    current_cursor = str(event["eventId"])
                    event_type = str(event.get("type") or "factory.snapshot")
                    public_event = _public_event_value(event)
                    yield (
                        f"id: {current_cursor}\n"
                        f"event: {event_type}\n"
                        f"data: {json.dumps(public_event, ensure_ascii=False, separators=(',', ':'))}\n\n"
                    )

        response = Response(event_stream(), mimetype="text/event-stream")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"
        return response

    @app.post("/api/input-snapshots")
    def create_input_snapshot() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        if _has_raw_path(payload):
            return _error("raw_path_forbidden", 422, retryable=False, correlation_id=_correlation_id())
        result = invoke("create_input_snapshot", payload)
        return result if isinstance(result, tuple) else (jsonify(result), 201)

    @app.post("/api/jobs")
    def create_job() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        result = invoke("create_job", payload)
        return result if isinstance(result, tuple) else (jsonify(result), 201)

    @app.post("/api/jobs/<job_id>/decisions")
    def create_decision(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = api.create_decision(job_id, payload)
        except ExternalDependencyError:
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        except PdpHttpError as error:
            if error.code in {"stale_version", "idempotency_conflict"}:
                return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify(result), 201

    @app.post("/api/worker/claim")
    def worker_claim() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        http_session_id = request.cookies.get(SESSION_COOKIE) or request.headers.get("X-Control-Tower-Session")
        result = invoke_worker(
            "claim",
            None,
            {**payload, "_httpSessionId": str(http_session_id or "")},
        )
        return result if isinstance(result, tuple) else jsonify(result)

    @app.post("/api/worker/<order_id>/<action>")
    def worker_lifecycle(order_id: str, action: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload) or action not in {"ack", "heartbeat", "events", "complete", "fail"}:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        result = invoke_worker(action, order_id, payload)
        return result if isinstance(result, tuple) else jsonify(result)

    if workbench_api is not None:
        register_workbench_routes(app, workbench_api, require_csrf)
