from __future__ import annotations

from collections import Counter

import base64
import binascii
import hashlib
import json
import mimetypes
import re
import secrets
from io import BytesIO
from collections.abc import Mapping
from pathlib import Path
from typing import Final, Protocol, TypeAlias, assert_never
from urllib.parse import unquote_to_bytes
from uuid import uuid4

from flask import Flask, Response, jsonify, request, stream_with_context
from PIL import Image, ImageOps, UnidentifiedImageError

from .runtime_cache import JsonObject, JsonValue
from .pdp_client import PdpHttpError
from .cafe24_bridge import Cafe24BridgeError, Cafe24CommandBridge, UnavailableCafe24CommandBridge, build_cafe24_command, build_cafe24_reconcile_command
from .cafe24_staging import APPROVAL_BINDING_FIELDS, SAFE_DEFAULTS, Cafe24ApprovalGate, Cafe24StagingError, build_preview, verify_readback
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
    r"authorization|bearer|secret|password|credential|token|api.?key|service.?key|csrf|cookie",
    re.IGNORECASE,
)
FACTORY_HISTORY_CATEGORY_MAP: Final = {
    "03_OUTPUT_경쟁사후보": ("competitor", "general"),
    "04_OUTPUT_경쟁사선택": ("competitor-page", "general"),
    "05_OUTPUT_Cafe24후보": ("cafe24-candidate-image", "general"),
    "06_OUTPUT_Cafe24선택": ("cafe24-candidate-image", "general"),
    "07_OUTPUT_신화사DB후보": ("other", "general"),
    "08_OUTPUT_신화사DB선택": ("other", "general"),
    "09_OUTPUT_대표이미지": ("hero", "representative"),
    "10_OUTPUT_이미지컷": ("generated", "general"),
    "11_OUTPUT_사이즈컷": ("size", "size"),
    "12_OUTPUT_색상옵션컷": ("color-option-output", "option_color"),
    "13_OUTPUT_섹션이미지": ("section", "sections"),
    "14_OUTPUT_최종선택": ("stitched-detail", "final_detail"),
}
FACTORY_HISTORY_ARCHIVE_STAGE_MAP: Final = {
    "hero": ("hero", "representative"),
    "representative": ("hero", "representative"),
    "size": ("size", "size"),
    "option_color": ("color-option-output", "option_color"),
    "general": ("generated", "general"),
    "sections": ("section", "sections"),
    "final_detail": ("stitched-detail", "final_detail"),
}
HISTORY_THUMBNAIL_SIZE: Final = (480, 360)
_HISTORY_THUMBNAIL_CACHE: dict[str, tuple[str, bytes]] = {}
HISTORY_THUMBNAIL_PLACEHOLDER: Final = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">'
    b'<title>preview unavailable</title></svg>'
)


def _history_thumbnail(content: bytes, mime_type: str) -> tuple[str, bytes]:
    cache_key = hashlib.sha256(content).hexdigest()
    cached = _HISTORY_THUMBNAIL_CACHE.get(cache_key)
    if cached is not None:
        return cached
    try:
        with Image.open(BytesIO(content)) as source:
            source.draft("RGB", HISTORY_THUMBNAIL_SIZE)
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail(HISTORY_THUMBNAIL_SIZE, Image.Resampling.BILINEAR)
            encoded = BytesIO()
            image.save(
                encoded,
                format="JPEG",
                quality=78,
                optimize=True,
                progressive=True,
            )
    except (OSError, UnidentifiedImageError, ValueError):
        return "image/svg+xml", HISTORY_THUMBNAIL_PLACEHOLDER
    result = ("image/jpeg", encoded.getvalue())
    if len(_HISTORY_THUMBNAIL_CACHE) >= 128:
        _HISTORY_THUMBNAIL_CACHE.pop(next(iter(_HISTORY_THUMBNAIL_CACHE)))
    _HISTORY_THUMBNAIL_CACHE[cache_key] = result
    return result


def _history_safe_name(value: object, fallback: str = "asset", max_len: int = 120) -> str:
    normalized = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", str(value or "").strip() or fallback)
    normalized = re.sub(r"\s+", "_", normalized).strip(" ._")
    normalized = re.sub(r"_+", "_", normalized)
    return normalized[:max_len].strip(" ._") or fallback


def _history_asset_key(category: object, file_name: object, content_hash: object, source_key: object) -> str:
    raw = "|".join(str(value or "") for value in (category, file_name, content_hash, source_key))
    return f"archive-{hashlib.sha256(raw.encode('utf-8', errors='ignore')).hexdigest()[:24]}"


def _history_workfile_dir(archive_root: Path, product_name: object, workspace_id: object) -> Path:
    folder_name = _history_safe_name(f"{product_name}__{workspace_id}", "작업파일")
    return archive_root / "작업파일별" / folder_name


def _history_load_manifest(
    archive_root: Path,
    product_name: object,
    workspace_id: object,
    product_key: object,
    run_id: object,
    job_id: object,
) -> tuple[Path, list[JsonObject]]:
    normalized_workspace_id = str(workspace_id).strip()
    legacy_workfile_dir = _history_workfile_dir(archive_root, product_name, workspace_id)
    current_folder_name = (
        f"{_history_safe_name(normalized_workspace_id, 'workfile', max_len=56)}__"
        f"{hashlib.sha256(normalized_workspace_id.encode('utf-8')).hexdigest()[:12]}"
    )
    current_workfile_dir = archive_root / "workfiles" / current_folder_name
    workfile_dir = legacy_workfile_dir if (legacy_workfile_dir / "manifest.json").is_file() else current_workfile_dir
    manifest_path = workfile_dir / "manifest.json"
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FactorySyncError("factory_history_manifest_unavailable") from error
    expected_workspace_id = f"batch:{str(job_id or '').strip()}"
    manifest_workspace_id = str(document.get("workspaceId") or "").strip() if isinstance(document, dict) else ""
    manifest_product_key = str(document.get("productKey") or "").strip() if isinstance(document, dict) else ""
    manifest_run_id = str(document.get("runId") or document.get("currentRunId") or "").strip() if isinstance(document, dict) else ""
    if not isinstance(document, dict) or manifest_workspace_id != normalized_workspace_id or manifest_workspace_id != expected_workspace_id:
        raise FactorySyncError("factory_history_identity_mismatch")
    records = document.get("assets")
    if not isinstance(records, list):
        raise FactorySyncError("factory_history_manifest_invalid")
    if workfile_dir == current_workfile_dir:
        if any(
            str(record.get("productKey") or "").strip() != str(product_key).strip()
            for record in records
            if isinstance(record, dict)
        ):
            raise FactorySyncError("factory_history_identity_mismatch")
    elif manifest_product_key != str(product_key).strip() or (manifest_run_id and manifest_run_id != str(run_id).strip()):
        raise FactorySyncError("factory_history_identity_mismatch")
    return workfile_dir, [dict(record) for record in records if isinstance(record, dict)]


def _history_entry_path(workfile_dir: Path, record: Mapping[str, object]) -> Path | None:
    files = record.get("files")
    current_image_path = str(files.get("imagePath") or "").strip() if isinstance(files, Mapping) else ""
    if current_image_path:
        root = workfile_dir.resolve()
        candidate = Path(current_image_path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None
    category = str(record.get("category") or "").strip()
    file_name = str(record.get("file") or "").strip()
    if not category or not file_name or Path(file_name).name != file_name:
        return None
    root = workfile_dir.resolve()
    candidate = (root / category / file_name).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def _history_decode_data_url(value: object) -> tuple[str, bytes] | None:
    raw = str(value or "")
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", raw, re.DOTALL)
    if not match:
        return None
    mime = str(match.group(1) or "application/octet-stream")
    payload = match.group(3) or ""
    try:
        content = base64.b64decode(payload, validate=True) if match.group(2) else unquote_to_bytes(payload)
    except (binascii.Error, ValueError):
        return None
    return mime, content


def _history_selection_state(
    category: str,
    *,
    content_hash: object = "",
    file_name: object = "",
    final_hashes: set[str] | frozenset[str] = frozenset(),
    final_files: set[str] | frozenset[str] = frozenset(),
) -> str:
    explicit = category.endswith("선택") or category.startswith("14_OUTPUT_")
    linked_to_final = (
        bool(str(content_hash or "").strip())
        and str(content_hash).strip() in final_hashes
    ) or (
        bool(str(file_name or "").strip())
        and str(file_name).strip() in final_files
    )
    return "selected" if explicit or linked_to_final else "candidate"


def _factory_history_snapshot(
    factory_sync: FactorySyncBridge,
    archive_root: Path,
    job_id: str,
) -> tuple[JsonObject, JsonObject, JsonObject, Path]:
    context = factory_sync.product_job_context(job_id)
    job = context.get("job")
    payload = context.get("payload")
    checkpoint = context.get("checkpoint")
    if not isinstance(job, dict) or not isinstance(payload, dict) or not isinstance(checkpoint, dict):
        raise FactorySyncError("factory_history_checkpoint_missing")
    workspace_id = str(checkpoint.get("projectId") or "").strip()
    product_key = str(checkpoint.get("productKey") or "").strip()
    run_id = str(checkpoint.get("runId") or "").strip()
    product_name = str(payload.get("productName") or product_key).strip()
    if not workspace_id or not product_key or not run_id or not product_name:
        raise FactorySyncError("factory_history_identity_missing")
    workfile_dir, records = _history_load_manifest(
        archive_root,
        product_name,
        workspace_id,
        product_key,
        run_id,
        job_id,
    )
    output_assets: list[JsonObject] = []
    category_counts: dict[str, int] = {}
    selected_by_category: dict[str, int] = {}
    selected_by_stage: dict[str, int] = {}
    final_records = [
        record
        for record in records
        if str(record.get("category") or "").strip() == "14_OUTPUT_최종선택"
    ]
    final_hashes = frozenset(
        str(record.get("contentHash") or "").strip()
        for record in final_records
        if str(record.get("contentHash") or "").strip()
    )
    final_files = frozenset(
        str(record.get("file") or "").strip()
        for record in final_records
        if str(record.get("file") or "").strip()
    )
    selected_result_count = 0
    selected_source_count = 0
    for record in records:
        category = str(record.get("category") or "").strip()
        path = _history_entry_path(workfile_dir, record)
        if not category or path is None:
            continue
        role, stage_key = FACTORY_HISTORY_CATEGORY_MAP.get(
            category,
            FACTORY_HISTORY_ARCHIVE_STAGE_MAP.get(str(record.get("stageId") or "").strip(), ("other", "general")),
        )
        asset_key = _history_asset_key(
            category,
            record.get("file"),
            record.get("contentHash"),
            record.get("sourceKey"),
        )
        selection_state = _history_selection_state(
            category,
            content_hash=record.get("contentHash"),
            file_name=record.get("file"),
            final_hashes=final_hashes,
            final_files=final_files,
        )
        explicit_selection = category.endswith("선택") or category.startswith("14_OUTPUT_")
        linked_to_final = selection_state == "selected" and not explicit_selection
        category_counts[category] = category_counts.get(category, 0) + 1
        if selection_state == "selected":
            selected_by_category[category] = selected_by_category.get(category, 0) + 1
            selected_by_stage[stage_key] = selected_by_stage.get(stage_key, 0) + 1
            if explicit_selection:
                selected_result_count += 1
            elif linked_to_final:
                selected_source_count += 1
        output_assets.append(
            {
                "id": asset_key,
                "assetKey": asset_key,
                "phase": "output",
                "stage": stage_key,
                "role": role,
                "displayName": str(record.get("title") or record.get("file") or asset_key),
                "sourceChecksum": str(record.get("contentHash") or ""),
                "selectionState": selection_state,
                "metadata": {
                    "archiveCategory": category,
                    "archiveFile": str(record.get("file") or ""),
                    "source": str(record.get("source") or ""),
                    "sectionId": str(record.get("sectionId") or ""),
                    "selectionEvidence": "14_OUTPUT_최종선택 파일·해시 일치" if linked_to_final else "",
                },
                "storedAssetId": asset_key,
                "contentReference": f"/api/factory/jobs/{job_id}/history/assets/{asset_key}/image",
                "thumbnailReference": f"/api/factory/jobs/{job_id}/history/assets/{asset_key}/thumbnail",
                "factoryStageKey": stage_key,
                "version": int(checkpoint.get("revision") or 0),
            },
        )

    input_assets: list[JsonObject] = []
    raw_images = payload.get("inputImages")
    if isinstance(raw_images, list):
        for index, raw_image in enumerate(raw_images):
            if not isinstance(raw_image, dict):
                continue
            role = "color-option-input" if str(raw_image.get("role") or "") == "color-option" else "base"
            input_key = f"input-{index}"
            input_assets.append(
                {
                    "id": input_key,
                    "assetKey": input_key,
                    "phase": "input",
                    "stage": "db",
                    "role": role,
                    "displayName": str(raw_image.get("name") or raw_image.get("fileName") or input_key),
                    "sourceChecksum": str(raw_image.get("sha256") or ""),
                    "selectionState": "selected",
                    "metadata": {
                        "ordinal": raw_image.get("ordinal"),
                        "colorName": str(raw_image.get("colorName") or ""),
                        "fileName": str(raw_image.get("fileName") or ""),
                        "sourceRole": str(raw_image.get("role") or ""),
                    },
                    "storedAssetId": input_key,
                    "contentReference": f"/api/factory/jobs/{job_id}/history/assets/{input_key}/image",
                    "thumbnailReference": f"/api/factory/jobs/{job_id}/history/assets/{input_key}/thumbnail",
                    "factoryStageKey": "db",
                    "version": int(checkpoint.get("revision") or 0),
                },
            )

    required_values = payload.get("requiredValues")
    safe_required_values = {
        str(key): value
        for key, value in required_values.items()
        if isinstance(key, str) and isinstance(value, (str, int, float, bool))
    } if isinstance(required_values, dict) else {}
    selected_count = sum(selected_by_category.values())
    work_bundle: JsonObject = {
        "id": f"history:{job_id}",
        "bundleKey": f"kuasangse:{workspace_id}",
        "workfileName": workfile_dir.name,
        "version": int(checkpoint.get("revision") or 0),
        "assets": input_assets + output_assets,
    }
    history: JsonObject = {
        "scope": "completed-job",
        "sourceLabel": "kuasangse 작업파일별 보관소",
        "preservation": "현재 완료 작업의 workspaceId/productKey/runId로 고정된 읽기 전용 자료",
        "productName": product_name,
        "productKey": product_key,
        "workspaceId": workspace_id,
        "runId": run_id,
        "revision": int(checkpoint.get("revision") or 0),
        "workfileFolderName": workfile_dir.name,
        "input": {
            "count": len(input_assets),
            "sourceKind": str((payload.get("source") or {}).get("kind") or "") if isinstance(payload.get("source"), dict) else "",
            "mode": str(payload.get("mode") or ""),
            "jcode": payload.get("jcode"),
            "requiredValues": safe_required_values,
        },
        "output": {
            "count": len(output_assets),
            "selectedCount": selected_count,
            "candidateCount": len(output_assets) - selected_count,
            "byCategory": category_counts,
            "selectedByCategory": selected_by_category,
            "selectedByStage": selected_by_stage,
            "selectedResultCount": selected_result_count,
            "selectedSourceCount": selected_source_count,
        },
        "job": job,
    }
    return work_bundle, history, payload, workfile_dir


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

    def remember(self, session_id: str, csrf_token: str) -> None:
        self._sessions[session_id] = csrf_token


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
            "identityKey": f"{stage_key}:{item['id']}",
            "contentDigest": str(item.get("digest") or ""),
            "thumbnailRef": str(item.get("thumbnailUrl") or item.get("assetId") or ""),
            "source": str(item.get("source") or "factory"),
            "model": str(item.get("model") or ""),
            "confidence": item.get("confidence"),
            "rationale": str(item.get("rationale") or ""),
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
    factory_archive_root: Path | None = None,
) -> None:
    api = pdp_api if pdp_api is not None else UnavailablePdpApi()
    bridge = cafe24_bridge if cafe24_bridge is not None else UnavailableCafe24CommandBridge()
    sessions = LocalSessionStore()
    handoffs = HandoffStore()
    cafe24_approvals = Cafe24ApprovalGate()
    factory_sync = factory_sync_bridge if factory_sync_bridge is not None else FactorySyncBridge()
    judge = gpt_judge if gpt_judge is not None else GptOAuthJudge()
    archive_root = (factory_archive_root or (Path("output") / "local-archive")).resolve()

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
        cookie_session = request.cookies.get(SESSION_COOKIE)
        header_session = request.headers.get("X-Control-Tower-Session")
        session_id = header_session or cookie_session
        expected = sessions.csrf_for(session_id)
        provided = request.headers.get("X-Control-Tower-CSRF")
        trusted_cookie = bool(
            cookie_session
            and (
                cookie_session == header_session
                or sessions.csrf_for(cookie_session) is not None
            )
        )
        if expected is None and trusted_cookie and header_session and provided:
            sessions.remember(header_session, provided)
            expected = provided
        return None if expected is not None and secrets.compare_digest(provided or "", expected) else _error("csrf_required", 428, retryable=False, correlation_id=_correlation_id())

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
            or bool(raw_inputs)
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
                input_refs=(),
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
        if job_id.startswith("factory-job-"):
            current = factory_sync.current_state()
            registration = current.get("registration")
            remote_projection = bridge_result.get("remoteReadback")
            if (
                not isinstance(registration, dict)
                or registration.get("jobId") != job_id
                or not isinstance(remote_projection, dict)
            ):
                raise Cafe24StagingError("stale_run_fingerprint")
            terminal: JsonObject = {
                "schema": "factory-cafe24-terminal-publication-receipt:v1",
                "status": "staged_verified",
                "registrationMode": str(registration.get("mode") or "update"),
                "jobId": job_id,
                "receiptId": f"factory-cafe24-local:{readback['remoteReadbackDigest']}",
                "eventType": "FACTORY_CAFE24_REMOTE_READBACK",
                "productId": payload["productId"],
                "productKey": payload["productKey"],
                "remoteProductNo": readback["externalProductNo"],
                "payloadDigest": readback["payloadDigest"],
                "idempotencyKey": readback["idempotencyKey"],
                "remoteReadbackDigest": readback["remoteReadbackDigest"],
                "remoteReadback": dict(remote_projection),
                "expectedWorkfileRevision": payload["expectedWorkfileRevision"],
                "expectedRunId": payload["expectedRunId"],
                "expectedInputFingerprint": payload["expectedInputFingerprint"],
                "safeDefaults": dict(SAFE_DEFAULTS),
            }
            factory_sync.record_publication_receipt(terminal)
            return terminal
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

    @app.post("/api/cafe24/confirm")
    def cafe24_confirm() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        token = payload.get("approvalToken") if payload is not None else None
        if (
            payload is None
            or payload.get("confirmed") is not True
            or not isinstance(token, str)
            or not token.strip()
        ):
            return _error("confirmation_required", 409, retryable=False, correlation_id=_correlation_id())
        binding = {key: payload.get(key) for key in APPROVAL_BINDING_FIELDS}
        try:
            result = cafe24_approvals.confirm(token, binding)
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
        confirmation_nonce = payload.get("confirmationNonce") if payload is not None else None
        job_id = payload.get("jobId") if payload is not None else None
        if payload is None or not isinstance(token, str) or not token.strip() or not isinstance(job_id, str) or not job_id.strip():
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        if not isinstance(confirmation_nonce, str) or not confirmation_nonce.strip():
            return _error("confirmation_required", 409, retryable=False, correlation_id=_correlation_id())
        binding = {key: payload.get(key) for key in APPROVAL_BINDING_FIELDS}
        grant: JsonObject | None = None
        reservation_open = False
        try:
            grant = cafe24_approvals.reserve(token, binding, confirmation_nonce)
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
        except FactorySyncError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
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
        except FactorySyncError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        except (ExternalDependencyError, PdpHttpError):
            return _error("blocked_external", 503, retryable=True, correlation_id=_correlation_id())
        return jsonify({"status": "staged_verified", "externalWrite": False, "command": command, "publicationReceipt": receipt})

    @app.get("/api/factory/jobs")
    def factory_product_jobs() -> Response:
        jobs = factory_sync.product_jobs()
        return jsonify({"jobs": jobs, "total": len(jobs)})

    @app.get("/api/factory/jobs/<job_id>/history")
    def factory_product_history(job_id: str) -> Response | tuple[Response, int]:
        try:
            work_bundle, history, _payload, _workfile_dir = _factory_history_snapshot(
                factory_sync,
                archive_root,
                job_id,
            )
        except FactorySyncError as error:
            status = 404 if error.code == "factory_product_job_not_found" else 409
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"workBundle": work_bundle, "history": history})

    @app.get("/api/factory/jobs/<job_id>/history/assets/<asset_key>/<variant>")
    def factory_product_history_asset(
        job_id: str,
        asset_key: str,
        variant: str,
    ) -> Response | tuple[Response, int]:
        if (
            not re.fullmatch(r"(?:archive-[a-f0-9]{24}|input-\d+)", asset_key)
            or variant not in {"image", "thumbnail"}
        ):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            work_bundle, history, _payload, workfile_dir = _factory_history_snapshot(
                factory_sync,
                archive_root,
                job_id,
            )
        except FactorySyncError as error:
            status = 404 if error.code == "factory_product_job_not_found" else 409
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        assets = work_bundle.get("assets") if isinstance(work_bundle.get("assets"), list) else []
        asset = next(
            (item for item in assets if isinstance(item, dict) and item.get("id") == asset_key),
            None,
        )
        if not isinstance(asset, dict):
            return _error("factory_history_asset_not_found", 404, retryable=False, correlation_id=_correlation_id())
        if asset_key.startswith("input-"):
            context = factory_sync.product_job_context(job_id)
            payload = context.get("payload")
            images = payload.get("inputImages") if isinstance(payload, dict) else None
            index = int(asset_key.removeprefix("input-"))
            raw_image = images[index] if isinstance(images, list) and 0 <= index < len(images) else None
            decoded = _history_decode_data_url(raw_image.get("dataUrl") if isinstance(raw_image, dict) else "")
            if decoded is None:
                return _error("factory_history_input_image_missing", 404, retryable=False, correlation_id=_correlation_id())
            mime, content = decoded
        else:
            try:
                _loaded_dir, records = _history_load_manifest(
                    archive_root,
                    history.get("productName"),
                    history.get("workspaceId"),
                    history.get("productKey"),
                    history.get("runId"),
                    job_id,
                )
            except FactorySyncError:
                return _error("factory_history_asset_missing", 404, retryable=False, correlation_id=_correlation_id())
            record = next(
                (
                    item
                    for item in records
                    if _history_asset_key(
                        item.get("category"),
                        item.get("file"),
                        item.get("contentHash"),
                        item.get("sourceKey"),
                    ) == asset_key
                ),
                None,
            )
            path = _history_entry_path(workfile_dir, record) if isinstance(record, dict) else None
            if path is None:
                return _error("factory_history_asset_missing", 404, retryable=False, correlation_id=_correlation_id())
            try:
                content = path.read_bytes()
            except OSError:
                return _error("factory_history_asset_missing", 404, retryable=False, correlation_id=_correlation_id())
            mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if variant == "thumbnail":
            mime, content = _history_thumbnail(content, mime)
        response = Response(content, mimetype=mime)
        response.headers["Cache-Control"] = "public, max-age=3600"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.post("/api/factory/jobs")
    def factory_product_create() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            job = factory_sync.queue_product(payload)
        except FactorySyncError as error:
            status = 409 if error.code == "idempotency_conflict" else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"accepted": True, "job": job}), 202

    @app.post("/api/factory/jobs/from-workfile")
    def factory_product_create_from_workfile() -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = factory_sync.queue_product_from_workfile(payload)
        except FactorySyncError as error:
            status = 409 if error.code in {
                "factory_workfile_fork_foreign_live_job",
                "factory_workfile_fork_identity_mismatch",
                "factory_worker_build_not_admitted",
                "idempotency_conflict",
                "stale_workfile_revision",
            } else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify(result), 202

    @app.post("/api/factory/jobs/<job_id>/resume")
    def factory_product_resume(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or set(payload) - {"imageModel", "expectedCheckpointRevision", "expectedCheckpointRunId"}:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        match payload.get("imageModel"):
            case None:
                image_model = None
            case str() as value:
                image_model = value
            case _:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        match payload.get("expectedCheckpointRevision"):
            case None:
                expected_checkpoint_revision = None
            case int() as value if type(value) is int:
                expected_checkpoint_revision = value
            case _:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        match payload.get("expectedCheckpointRunId"):
            case None:
                expected_checkpoint_run_id = None
            case str() as value:
                expected_checkpoint_run_id = value
            case _:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            job = factory_sync.resume_product(
                job_id,
                image_model=image_model,
                expected_checkpoint_revision=expected_checkpoint_revision,
                expected_checkpoint_run_id=expected_checkpoint_run_id,
            )
        except FactorySyncError as error:
            status = (
                404
                if error.code == "factory_product_job_not_found"
                else 422
                if error.code == "factory_product_image_model_invalid"
                else 409
            )
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"accepted": True, "job": job}), 202

    @app.post("/api/factory/jobs/<job_id>/values")
    def factory_product_values(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            job = factory_sync.update_product_values(job_id, payload)
        except FactorySyncError as error:
            status = (
                404
                if error.code == "factory_product_job_not_found"
                else 409
                if error.code == "factory_product_job_busy"
                else 422
            )
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"accepted": True, "job": job})

    @app.post("/api/factory/jobs/<job_id>/images")
    def factory_product_images(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or set(payload) != {"inputImages"}:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            job = factory_sync.update_product_images(job_id, payload["inputImages"])
        except FactorySyncError as error:
            status = (
                404
                if error.code == "factory_product_job_not_found"
                else 409
                if error.code == "factory_product_job_busy"
                else 422
            )
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"accepted": True, "job": job})

    @app.post("/api/factory/jobs/<job_id>/cafe24/register")
    def factory_product_cafe24_register(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        # 등록 방식(새 상품/기존 수정)은 사람이 정하는 값이다. 이 목록에 없으면 보드에서
        # 골라도 조립공장까지 전달되지 않아, 스토어에 이미 있는 제품이 늘 덮어쓰기가 된다.
        allowed = {
            "categoryId",
            "salePrice",
            "supplyPrice",
            "displayStatus",
            "sellingStatus",
            "registrationMode",
            # 어느 상품을 고칠지도 사람이 정한다. 비워 두면 조립공장이 후보에서 고른다.
            "targetProductNo",
        }
        if payload is None or set(payload) - allowed:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        for key in allowed:
            value = payload.get(key)
            if value is not None and not isinstance(value, str):
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            order = factory_sync.queue_cafe24_registration(job_id, payload)
        except FactorySyncError as error:
            status = 404 if error.code == "factory_product_job_not_found" else 409
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        return jsonify({"accepted": True, "orderId": order["orderId"]}), 202

    @app.post("/api/factory/jobs/<job_id>/workfile-rebind")
    def factory_product_workfile_rebind(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        allowed_fields = {
            "fileName",
            "workfileText",
            "expectedSha256",
            "expectedWorkspaceId",
            "expectedProductId",
            "expectedProductKey",
            "expectedRunId",
            "expectedInputFingerprint",
            "expectedWorkfileRevision",
            "expectedHydratedWorkfileRevision",
            "expectedCheckpointRevision",
            "expectedCheckpointRunId",
            "idempotencyKey",
        }
        if payload is None or set(payload) != allowed_fields or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            result = factory_sync.queue_product_workfile_rebind(job_id, payload)
        except FactorySyncError as error:
            status = 404 if error.code == "factory_product_job_not_found" else 409 if error.code in {
                "stale_product_checkpoint",
                "factory_workfile_rebind_identity_mismatch",
                "idempotency_conflict",
                "stale_workfile_revision",
                "factory_session_missing",
            } else 422
            return _error(error.code, status, retryable=False, correlation_id=_correlation_id())
        if result.get("idempotent") is True:
            receipt = result.get("receipt")
            if not isinstance(receipt, dict):
                return _error(
                    "factory_product_checkpoint_rebind_receipt_invalid",
                    422,
                    retryable=False,
                    correlation_id=_correlation_id(),
                )
            return jsonify({
                "accepted": True,
                "idempotent": True,
                "status": "rebound",
                "receipt": {
                    key: receipt.get(key)
                    for key in (
                        "schema",
                        "jobId",
                        "workfileSha256",
                        "oldRevision",
                        "oldRunId",
                        "newRevision",
                        "newRunId",
                        "checkpointDigest",
                    )
                },
            })
        return jsonify({
            "accepted": True,
            "status": "queued",
            "order": {
                "jobId": job_id,
                "orderId": result.get("orderId"),
                "workspaceId": payload.get("expectedWorkspaceId"),
                "productId": payload.get("expectedProductId"),
                "productKey": payload.get("expectedProductKey"),
                "workfileSha256": payload.get("expectedSha256"),
                "runId": payload.get("expectedRunId"),
                "workfileRevision": payload.get("expectedWorkfileRevision"),
                "hydratedWorkfileRevision": payload.get("expectedHydratedWorkfileRevision"),
                "checkpointRevision": payload.get("expectedCheckpointRevision"),
                "checkpointRunId": payload.get("expectedCheckpointRunId"),
            },
        }), 202

    @app.post("/api/factory/jobs/<job_id>/select")
    def factory_product_select(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        try:
            context = factory_sync.product_job_context(job_id)
        except FactorySyncError as error:
            return _error(error.code, 404, retryable=False, correlation_id=_correlation_id())
        job = context["job"]
        job_payload = context["payload"]
        assert isinstance(job, dict) and isinstance(job_payload, dict)
        stage_key = str(payload.get("stageKey") or "").strip()
        decision_mode = str(payload.get("decisionMode") or "").strip()
        revision = payload.get("expectedRevision")
        selection_target = (
            job.get("status") == "waiting_manual" and job.get("stageKey") == stage_key
        ) or (job.get("status") == "completed" and decision_mode == "manual")
        if (
            not selection_target
            or decision_mode not in {"manual", "auto"}
            or type(revision) is not int
            or revision < 0
        ):
            return _error("decision_target_required", 422, retryable=False, correlation_id=_correlation_id())
        projection = factory_sync.current_state()
        session = projection.get("session")
        if not isinstance(session, dict) or projection.get("connected") is not True:
            return _error("factory_session_missing", 409, retryable=False, correlation_id=_correlation_id())
        identity_pairs = (
            ("productId", "productId"),
            ("productKey", "productKey"),
            ("expectedRunId", "runId"),
            ("expectedInputFingerprint", "inputFingerprint"),
            ("expectedRevision", "revision"),
        )
        if any(payload.get(request_key) != session.get(session_key) for request_key, session_key in identity_pairs):
            return _error("stale_run_fingerprint", 409, retryable=False, correlation_id=_correlation_id())
        candidates = _factory_stage_candidates(projection, stage_key)
        candidate_ids = [str(candidate["candidateId"]) for candidate in candidates]
        selected_id = str(payload.get("candidateId") or "").strip()
        if decision_mode == "manual":
            if selected_id not in candidate_ids:
                return _error("candidate_membership_invalid", 422, retryable=False, correlation_id=_correlation_id())
            receipt = _manual_selection_receipt(payload, selected_id)
            selection_status = "selected"
        else:
            policy_snapshot = job_payload.get("policySnapshot")
            raw_options = payload.get("judgementOptions")
            if not isinstance(policy_snapshot, dict) or not isinstance(raw_options, dict):
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            try:
                selection = decide_candidates(
                    FACTORY_DECISION_TYPES.get(stage_key, stage_key),
                    candidates,
                    identity={
                        "jobId": job_id,
                        "productId": session["productId"],
                        "productKey": session["productKey"],
                        "runId": session["runId"],
                        "inputFingerprint": session["inputFingerprint"],
                        "revision": session["revision"],
                        "eventId": str(projection.get("cursor") or ""),
                    },
                    policy_snapshot=policy_snapshot,
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
            receipt = selection.receipt or {}
            selection_status = selection.status
            selected_id = str(selection.candidate_id or "")
        if selection_status != "selected" or not selected_id:
            if selection_status == "manual_required":
                factory_sync.hold_product_decision(job_id, stage_key)
            return jsonify({
                "accepted": False,
                "status": "decision_recorded",
                "selectionStatus": selection_status,
                "decisionReceipt": receipt,
            })
        queue_payload: JsonObject = {
            "productId": session["productId"],
            "productKey": session["productKey"],
            "stageKey": stage_key,
            "candidateId": selected_id,
            "expectedRevision": session["revision"],
            "expectedRunId": session["runId"],
            "expectedInputFingerprint": session["inputFingerprint"],
            "idempotencyKey": str(payload.get("idempotencyKey") or f"factory-job:{job_id}:{stage_key}:{selected_id}:{revision}"),
        }
        try:
            order = factory_sync.queue_selection(queue_payload)
        except FactorySyncError as error:
            return _error(error.code, 409, retryable=False, correlation_id=_correlation_id())
        return jsonify({
            "accepted": True,
            "status": "factory_queued",
            "selectionStatus": "saving",
            "decisionReceipt": receipt,
            "order": order,
        }), 202

    def _waiting_stage_key(progress: Mapping[str, JsonValue] | None, requested: str) -> str:
        if requested:
            return requested
        if not isinstance(progress, Mapping):
            return ""
        awaiting = progress.get("awaitingStageKeys")
        for value in awaiting if isinstance(awaiting, list) else []:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return str(progress.get("stageKey") or "").strip()

    def _auto_selected_candidate(
        job_id: str,
        job_payload: Mapping[str, JsonValue],
        checkpoint: Mapping[str, JsonValue],
        candidates: list[JsonObject],
        stage_key: str,
        options: Mapping[str, JsonValue],
    ) -> tuple[str, str, JsonObject]:
        policy_snapshot = job_payload.get("policySnapshot")
        if not isinstance(policy_snapshot, dict):
            return "", "policy_snapshot_missing", {}
        try:
            selection = decide_candidates(
                FACTORY_DECISION_TYPES.get(stage_key, stage_key),
                candidates,
                identity={
                    "jobId": job_id,
                    "productId": str(checkpoint.get("productId") or ""),
                    "productKey": str(checkpoint.get("productKey") or ""),
                    "runId": str(checkpoint.get("runId") or ""),
                    "inputFingerprint": str(checkpoint.get("inputFingerprint") or ""),
                    "revision": checkpoint.get("revision"),
                    "eventId": str(checkpoint.get("savedAt") or ""),
                },
                policy_snapshot=policy_snapshot,
                judge=judge,
                model=str(options.get("model") or "latestModel"),
                reasoning_effort=str(options.get("reasoningEffort") or "medium"),
                service_tier=str(options.get("serviceTier") or "standard"),
                preset=str(options.get("preset") or "fast_single"),
            )
        except CandidateSelectionError as error:
            return "", error.code, {}
        except GptOAuthError as error:
            return "", error.code, {}
        if selection.status != "selected" or not selection.candidate_id:
            return "", selection.reason or selection.status, selection.receipt or {}
        return str(selection.candidate_id), "", selection.receipt or {}

    @app.post("/api/factory/jobs/selections")
    def factory_product_batch_select() -> Response | tuple[Response, int]:
        """대기 중인 여러 작업의 A컷 선택을 한 번에 예약한다.

        워커가 지금 열고 있는 작업은 즉시 적용되고, 나머지는 예약되어 워커가 그
        작업을 다시 열 때 자동으로 적용된다.
        """
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        mode = str(payload.get("mode") or "manual").strip()
        if mode not in {"manual", "auto"}:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        raw_options = payload.get("judgementOptions")
        options = raw_options if isinstance(raw_options, dict) else {}
        auto_resume = payload.get("autoResume") is not False
        requests: list[JsonObject] = []
        if mode == "manual":
            raw_selections = payload.get("selections")
            if not isinstance(raw_selections, list) or not raw_selections:
                return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
            for entry in raw_selections:
                if not isinstance(entry, dict):
                    return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
                requests.append(
                    {
                        "jobId": str(entry.get("jobId") or "").strip(),
                        "stageKey": str(entry.get("stageKey") or "").strip(),
                        "candidateId": str(entry.get("candidateId") or "").strip(),
                    },
                )
        else:
            raw_job_ids = payload.get("jobIds")
            wanted = (
                {str(value).strip() for value in raw_job_ids if isinstance(value, str)}
                if isinstance(raw_job_ids, list)
                else set()
            )
            for job in factory_sync.product_jobs():
                job_id = str(job.get("jobId") or "")
                if job.get("status") not in {"waiting_manual", "blocked"}:
                    continue
                if wanted and job_id not in wanted:
                    continue
                requests.append({"jobId": job_id, "stageKey": "", "candidateId": ""})
        if len(requests) > 200:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        results: list[JsonValue] = []
        for entry in requests:
            job_id = str(entry["jobId"])
            if not job_id:
                results.append({"jobId": job_id, "status": "error", "reason": "job_id_required"})
                continue
            try:
                context = factory_sync.product_job_context(job_id)
            except FactorySyncError as error:
                results.append({"jobId": job_id, "status": "error", "reason": error.code})
                continue
            job = context.get("job")
            job_payload = context.get("payload")
            checkpoint = context.get("checkpoint")
            if not isinstance(job, dict) or not isinstance(job_payload, dict):
                results.append({"jobId": job_id, "status": "error", "reason": "factory_product_job_missing"})
                continue
            progress = job.get("progress")
            stage_key = _waiting_stage_key(
                progress if isinstance(progress, dict) else None,
                str(entry["stageKey"]),
            )
            if not stage_key:
                results.append({"jobId": job_id, "status": "skipped", "reason": "stage_not_waiting"})
                continue
            candidate_id = str(entry["candidateId"])
            receipt: JsonObject = {}
            if mode == "auto":
                candidates = _factory_stage_candidates(
                    progress if isinstance(progress, dict) else {},
                    stage_key,
                )
                if not candidates:
                    results.append(
                        {"jobId": job_id, "status": "skipped", "stageKey": stage_key, "reason": "candidate_empty"},
                    )
                    continue
                candidate_id, reason, receipt = _auto_selected_candidate(
                    job_id,
                    job_payload,
                    checkpoint if isinstance(checkpoint, dict) else {},
                    candidates,
                    stage_key,
                    options,
                )
                if not candidate_id:
                    results.append(
                        {
                            "jobId": job_id,
                            "status": "skipped",
                            "stageKey": stage_key,
                            "reason": reason or "manual_required",
                            "decisionReceipt": receipt,
                        },
                    )
                    continue
            try:
                reserved = factory_sync.reserve_product_selection(
                    job_id,
                    {
                        "stageKey": stage_key,
                        "candidateId": candidate_id,
                        "decisionMode": mode,
                        "autoResume": auto_resume,
                        **({"decisionReceipt": receipt} if receipt else {}),
                    },
                )
            except FactorySyncError as error:
                results.append(
                    {"jobId": job_id, "status": "error", "stageKey": stage_key, "reason": error.code},
                )
                continue
            results.append(
                {
                    "jobId": job_id,
                    "status": reserved["status"],
                    "stageKey": stage_key,
                    "candidateId": candidate_id,
                    **({"decisionReceipt": receipt} if receipt else {}),
                },
            )
        counts = Counter(str(item["status"]) for item in results if isinstance(item, dict))
        return jsonify(
            {
                "schema": "factory-batch-selection:v1",
                "mode": mode,
                "results": results,
                "applied": counts["applied"],
                "reserved": counts["reserved"],
                "skipped": counts["skipped"],
                "failed": counts["error"],
            },
        )

    @app.post("/api/factory/jobs/resume")
    def factory_product_batch_resume() -> Response | tuple[Response, int]:
        """컷 선택이 끝난 작업 여러 건을 한 번에 다음 단계로 넘긴다."""
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        payload = _json_object()
        if payload is None or _has_raw_path(payload):
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        raw_job_ids = payload.get("jobIds")
        if raw_job_ids is None:
            job_ids = [
                str(job.get("jobId") or "")
                for job in factory_sync.product_jobs()
                if job.get("status") in {"waiting_manual", "blocked"}
            ]
        elif isinstance(raw_job_ids, list) and all(isinstance(value, str) for value in raw_job_ids):
            job_ids = [value.strip() for value in raw_job_ids if value.strip()]
        else:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        if len(job_ids) > 200:
            return _error("request_invalid", 422, retryable=False, correlation_id=_correlation_id())
        return jsonify(factory_sync.resume_products(job_ids))

    @app.post("/api/factory/jobs/<job_id>/selection/clear")
    def factory_product_selection_clear(job_id: str) -> Response | tuple[Response, int]:
        csrf_error = require_csrf()
        if csrf_error is not None:
            return csrf_error
        try:
            return jsonify(factory_sync.clear_product_selection(job_id))
        except FactorySyncError as error:
            return _error(error.code, 404, retryable=False, correlation_id=_correlation_id())

    @app.get("/api/factory/state")
    def factory_state() -> Response:
        return jsonify(_public_event_value(factory_sync.current_state()))

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
            conflict_codes = {
                "factory_worker_build_mismatch",
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
