from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Final, TypeAlias
from uuid import UUID, uuid4

from flask import Flask, Response, jsonify, request

from .pdp_client import PdpHttpError
from .pdp_workbench_client import PdpWorkbenchApi
from .runtime_cache import JsonObject, JsonValue

CsrfError: TypeAlias = tuple[Response, int]
CsrfGuard: TypeAlias = Callable[[], CsrfError | None]
JsonAction: TypeAlias = Callable[[], JsonObject]
COMMANDS: Final = frozenset(
    {"start", "pause", "resume", "cancel", "retry-failed", "publish"},
)
FORBIDDEN_CLIENT_FIELDS: Final = frozenset({"servicekey", "accesstoken", "actor"})
PRIVATE_RESPONSE_FIELDS: Final = frozenset(
    {
        "sourcepath",
        "sourcelocator",
        "servicekey",
        "accesstoken",
        "refreshtoken",
        "authorization",
        "clientsecret",
    },
)
OUTPUT_FACTORY_STAGES: Final = {
    "hero": "representative",
    "size": "size",
    "color-option": "option_color",
    "color-option-output": "option_color",
    "section": "sections",
    "stitched-detail": "final_detail",
    "competitor": "general",
    "lifestyle": "general",
    "feature": "general",
    "generated": "general",
    "other": "general",
}


def _error(code: str, status: int, *, retryable: bool = False) -> CsrfError:
    return (
        jsonify(
            {
                "error": {
                    "code": code,
                    "message": (
                        "외부 원장 상태를 확인한 뒤 다시 시도해 주세요."
                        if code == "blocked_external"
                        else "요청을 처리할 수 없습니다."
                    ),
                    "retryable": retryable,
                    "correlationId": f"ct-{uuid4().hex}",
                },
            },
        ),
        status,
    )


def _remote_error(error: PdpHttpError) -> CsrfError:
    if error.status in {404, 409, 422}:
        return _error(error.code, error.status)
    return _error("blocked_external", 503, retryable=True)


def _invoke(action: JsonAction) -> JsonObject | CsrfError:
    try:
        return action()
    except PdpHttpError as error:
        return _remote_error(error)


def _payload() -> JsonObject | None:
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) and not _has_forbidden_client_field(value) else None


def _has_forbidden_client_field(value: JsonValue) -> bool:
    if isinstance(value, dict):
        return any(
            key.casefold() in FORBIDDEN_CLIENT_FIELDS
            or _has_forbidden_client_field(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_has_forbidden_client_field(child) for child in value)
    return False


def _text(payload: Mapping[str, JsonValue], key: str) -> str | None:
    value = payload.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _version(payload: Mapping[str, JsonValue]) -> int | None:
    value = payload.get("expectedVersion")
    return value if type(value) is int and value >= 1 else None


def _body(payload: Mapping[str, JsonValue]) -> JsonObject:
    return {
        key: value
        for key, value in payload.items()
        if key not in {"idempotencyKey", "expectedVersion"}
    }


def _valid_batch(payload: Mapping[str, JsonValue]) -> bool:
    jcodes = payload.get("jcodes")
    concurrency = payload.get("concurrencyLimit", 2)
    return (
        isinstance(jcodes, list)
        and 1 <= len(jcodes) <= 500
        and len(jcodes) == len(set(value for value in jcodes if type(value) is int))
        and all(type(value) is int and value > 0 for value in jcodes)
        and type(concurrency) is int
        and 1 <= concurrency <= 4
    )


def _valid_uuid(value: str) -> bool:
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _sanitize(value: JsonValue) -> JsonValue:
    if isinstance(value, dict):
        return {
            key: _sanitize(child)
            for key, child in value.items()
            if key.casefold() not in PRIVATE_RESPONSE_FIELDS
        }
    if isinstance(value, list):
        return [_sanitize(child) for child in value]
    return value


def _work_bundle_detail(value: JsonObject) -> JsonObject:
    sanitized = _sanitize(value)
    if not isinstance(sanitized, dict):
        return {}
    bundle_id = sanitized.get("id")
    assets = sanitized.get("assets")
    if not isinstance(bundle_id, str) or not isinstance(assets, list):
        return sanitized
    exposed_assets: list[JsonValue] = []
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            continue
        asset = dict(raw_asset)
        asset_id = asset.get("id")
        phase = asset.get("phase")
        role = asset.get("role")
        if not isinstance(asset_id, str):
            continue
        asset["factoryStageKey"] = (
            OUTPUT_FACTORY_STAGES.get(role, "general")
            if phase == "output" and isinstance(role, str)
            else None
        )
        asset["contentReference"] = (
            f"/api/pdp/work-bundles/{bundle_id}/assets/{asset_id}/content"
        )
        asset["thumbnailReference"] = (
            f"/api/pdp/work-bundles/{bundle_id}/assets/{asset_id}/thumbnail"
        )
        exposed_assets.append(asset)
    sanitized["assets"] = exposed_assets
    return sanitized


def register_workbench_routes(
    app: Flask,
    api: PdpWorkbenchApi,
    require_csrf: CsrfGuard,
) -> None:
    @app.get("/api/pdp/products")
    def workbench_products() -> Response | CsrfError:
        result = _invoke(
            lambda: api.list_products(
                {
                    key: value
                    for key, value in request.args.items()
                    if key in {"cursor", "limit", "q", "status"}
                },
            ),
        )
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/products/<int:jcode>")
    def workbench_product(jcode: int) -> Response | CsrfError:
        result = _invoke(lambda: api.get_product(jcode))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/products/<int:jcode>/fields")
    def workbench_product_fields(jcode: int) -> Response | CsrfError:
        result = _invoke(lambda: api.get_product_fields(jcode))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/products/<int:jcode>/assets")
    def workbench_product_assets(jcode: int) -> Response | CsrfError:
        result = _invoke(lambda: api.get_product_assets(jcode))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/work-bundles")
    def workbench_list_work_bundles() -> Response | CsrfError:
        result = _invoke(
            lambda: api.list_work_bundles(
                {
                    key: value
                    for key, value in request.args.items()
                    if key in {"cursor", "limit", "q", "bindingState", "jcode"}
                },
            ),
        )
        if isinstance(result, tuple):
            return result
        sanitized = _sanitize(result)
        return jsonify(sanitized)

    @app.get("/api/pdp/work-bundles/<bundle_id>")
    def workbench_get_work_bundle(bundle_id: str) -> Response | CsrfError:
        if not _valid_uuid(bundle_id):
            return _error("request_invalid", 422)
        result = _invoke(lambda: api.get_work_bundle(bundle_id))
        return (
            result
            if isinstance(result, tuple)
            else jsonify(_work_bundle_detail(result))
        )

    @app.get(
        "/api/pdp/work-bundles/<bundle_id>/assets/<asset_id>/<variant>",
    )
    def workbench_work_bundle_asset(
        bundle_id: str,
        asset_id: str,
        variant: str,
    ) -> Response | CsrfError:
        if (
            not _valid_uuid(bundle_id)
            or not _valid_uuid(asset_id)
            or variant not in {"content", "thumbnail"}
        ):
            return _error("request_invalid", 422)
        detail = _invoke(lambda: api.get_work_bundle(bundle_id))
        if isinstance(detail, tuple):
            return detail
        assets = detail.get("assets")
        asset = next(
            (
                item
                for item in assets
                if isinstance(item, dict) and item.get("id") == asset_id
            ),
            None,
        ) if isinstance(assets, list) else None
        reference_key = (
            "thumbnailReference" if variant == "thumbnail" else "contentReference"
        )
        reference = asset.get(reference_key) if isinstance(asset, dict) else None
        if not isinstance(reference, str):
            return _error("asset_reference_missing", 404)
        try:
            binary = api.get_work_bundle_asset(reference)
        except PdpHttpError as error:
            return _remote_error(error)
        response = Response(binary.content, mimetype=binary.content_type)
        response.headers["Cache-Control"] = binary.cache_control
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.post("/api/pdp/production-batches")
    def workbench_create_batch() -> Response | CsrfError:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _payload()
        key = _text(payload, "idempotencyKey") if payload is not None else None
        if payload is None or key is None or not _valid_batch(payload):
            return _error("validation_error", 422)
        result = _invoke(lambda: api.create_batch(_body(payload), key))
        if isinstance(result, tuple):
            return result
        return jsonify(result), 200 if result.get("replayed") is True else 201

    @app.get("/api/pdp/production-batches")
    def workbench_list_batches() -> Response | CsrfError:
        result = _invoke(
            lambda: api.list_batches(
                {
                    key: value
                    for key, value in request.args.items()
                    if key in {"state", "cursor", "limit"}
                },
            ),
        )
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/production-batches/<batch_id>")
    def workbench_get_batch(batch_id: str) -> Response | CsrfError:
        if not _valid_uuid(batch_id):
            return _error("request_invalid", 422)
        result = _invoke(lambda: api.get_batch(batch_id))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/production-batches/<batch_id>/items")
    def workbench_batch_items(batch_id: str) -> Response | CsrfError:
        if not _valid_uuid(batch_id):
            return _error("request_invalid", 422)
        result = _invoke(lambda: api.get_batch_items(batch_id))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.post("/api/pdp/production-batches/<batch_id>/commands")
    def workbench_batch_command(batch_id: str) -> Response | CsrfError:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _payload()
        key = _text(payload, "idempotencyKey") if payload is not None else None
        expected = _version(payload) if payload is not None else None
        command = _text(payload, "command") if payload is not None else None
        if (
            not _valid_uuid(batch_id)
            or payload is None
            or key is None
            or expected is None
            or command not in COMMANDS
        ):
            return _error("request_invalid", 422)
        result = _invoke(
            lambda: api.command_batch(
                batch_id,
                _body(payload),
                key,
                expected,
            ),
        )
        return result if isinstance(result, tuple) else jsonify(result)

    @app.get("/api/pdp/production-batches/<batch_id>/events")
    def workbench_batch_events(batch_id: str) -> Response | CsrfError:
        if not _valid_uuid(batch_id):
            return _error("request_invalid", 422)
        raw_after = request.args.get("after", "0")
        try:
            after = int(raw_after)
        except ValueError:
            return _error("request_invalid", 422)
        if after < 0:
            return _error("request_invalid", 422)
        result = _invoke(lambda: api.get_batch_events(batch_id, after))
        return result if isinstance(result, tuple) else jsonify(result)

    @app.post("/api/pdp/reviews/<review_id>/decision")
    def workbench_review_decision(review_id: str) -> Response | CsrfError:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _payload()
        key = _text(payload, "idempotencyKey") if payload is not None else None
        expected = _version(payload) if payload is not None else None
        decision = _text(payload, "decision") if payload is not None else None
        if (
            not _valid_uuid(review_id)
            or payload is None
            or key is None
            or expected is None
            or decision not in {"approve", "reject"}
        ):
            return _error("request_invalid", 422)
        result = _invoke(
            lambda: api.decide_review(
                review_id,
                _body(payload),
                key,
                expected,
            ),
        )
        return result if isinstance(result, tuple) else jsonify(result)

    @app.post("/api/pdp/products/<int:jcode>/publications")
    def workbench_create_publication(jcode: int) -> Response | CsrfError:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _payload()
        key = _text(payload, "idempotencyKey") if payload is not None else None
        if payload is None or key is None:
            return _error("request_invalid", 422)
        result = _invoke(lambda: api.create_publication(jcode, _body(payload), key))
        return result if isinstance(result, tuple) else (jsonify(result), 201)


__all__ = ["register_workbench_routes"]
