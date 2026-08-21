"""API domain routes: archive. Auto-split from api.py — behavior unchanged."""
import hashlib
import ipaddress
import json
import re
import socket
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import httpx2

import routes.api_shared as _api_shared
from routes.api_shared import api  # noqa: F401
globals().update({k: v for k, v in vars(_api_shared).items() if not k.startswith("__")})
from routes.api_workspace_lock import (
    PreconditionRequired,
    commit_workspace_replica,
    commit_workspace_mutation,
    get_workspace_status,
    validate_workspace_mutation,
)
from services.workspace_lock_service import WorkspaceConflict
from services.workspace_mutation import FileDelete, FileWrite, StagedFilesystemMutation
from services import vm_candidate_bridge
from services.local_asset_library import (
    LibraryBuildRequest,
    LibraryIdentity,
    build_workfile_library,
    workfile_library_root,
)

@api.route("/recovery/crystal-preview/<path:filename>", methods=["GET"])
def serve_crystal_recovery_image(filename):
    """Serve only restored crystal preview images stored under output/recovery."""
    safe_name = os.path.basename(str(filename or ""))
    if not safe_name or safe_name != filename:
        return jsonify({"ok": False, "error": "invalid filename"}), 400
    if not os.path.isdir(_CRYSTAL_RECOVERY_IMAGE_DIR):
        return jsonify({"ok": False, "error": "recovery folder not found"}), 404
    full_path = os.path.abspath(os.path.join(_CRYSTAL_RECOVERY_IMAGE_DIR, safe_name))
    if not full_path.startswith(_CRYSTAL_RECOVERY_IMAGE_DIR + os.sep) or not os.path.isfile(full_path):
        return jsonify({"ok": False, "error": "file not found"}), 404
    response = send_from_directory(_CRYSTAL_RECOVERY_IMAGE_DIR, safe_name)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


# ── Last Work Recovery Store ────────────────────────────────────

_LAST_WORK_SCOPED_DIR = os.path.join(os.path.dirname(_LAST_WORK_PATH), "pdp-last-work-scoped")


def _last_work_workspace_id(body=None, incoming=None):
    body = body if isinstance(body, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}
    workspace_scope = incoming.get("workspaceScope")
    if isinstance(workspace_scope, dict):
        workspace_scope = workspace_scope.get("id")
    candidates = (
        request.args.get("workspaceId"),
        request.headers.get("X-Kuasangse-Workspace-Id"),
        body.get("workspaceId"),
        incoming.get("workspaceId"),
        workspace_scope,
        incoming.get("currentProjectId"),
    )
    for value in candidates:
        normalized = re.sub(r"\s+", "", str(value or "")).strip()
        if normalized:
            return normalized[:240]
    return ""


def _last_work_paths(workspace_id):
    if not workspace_id:
        return _LAST_WORK_PATH, _LAST_WORK_BACKUP_PATH
    digest = hashlib.sha256(workspace_id.encode("utf-8")).hexdigest()
    os.makedirs(_LAST_WORK_SCOPED_DIR, exist_ok=True)
    return (
        os.path.join(_LAST_WORK_SCOPED_DIR, f"{digest}.json"),
        os.path.join(_LAST_WORK_SCOPED_DIR, f"{digest}.bak.json"),
    )


def _last_work_has_destructive_identity_drift(existing, incoming):
    existing_factory = ((existing.get("assets") or {}).get("factory") or {})
    incoming_factory = ((incoming.get("assets") or {}).get("factory") or {})
    existing_product = existing_factory.get("product") or {}
    incoming_product = incoming_factory.get("product") or {}
    existing_assets = existing_factory.get("assets") or []
    incoming_assets = incoming_factory.get("assets") or []
    existing_key = str(existing_product.get("productKey") or "").strip()
    incoming_key = str(incoming_product.get("productKey") or "").strip()
    existing_run = str(existing_product.get("currentRunId") or "").strip()
    incoming_run = str(incoming_product.get("currentRunId") or "").strip()
    existing_input = str(
        existing_product.get("inputImageFingerprint")
        or existing_product.get("lockedInputImageFingerprint")
        or ""
    ).strip()
    incoming_input = str(
        incoming_product.get("inputImageFingerprint")
        or incoming_product.get("lockedInputImageFingerprint")
        or ""
    ).strip()
    if not all((existing_key, existing_run, existing_input)):
        return False
    if not all((incoming_key, incoming_run, incoming_input)):
        return True
    if existing_run != incoming_run or existing_input != incoming_input:
        return False
    if existing_key != incoming_key:
        return True
    existing_payload = existing.get("assets") or {}
    incoming_payload = incoming.get("assets") or {}
    existing_automation = existing_factory.get("automation") or {}
    incoming_automation = incoming_factory.get("automation") or {}
    existing_options_stage = (existing_factory.get("stages") or {}).get("options") or {}
    incoming_options_stage = (incoming_factory.get("stages") or {}).get("options") or {}
    existing_option_mode = str(existing_automation.get("optionMode") or "").strip()
    incoming_option_mode = str(incoming_automation.get("optionMode") or "").strip()
    existing_option_status = str(existing_options_stage.get("status") or "").strip()
    incoming_option_status = str(incoming_options_stage.get("status") or "").strip()
    if (
        existing_option_mode not in ("", "pending")
        and existing_option_status == "done"
        and (
            incoming_option_mode in ("", "pending")
            or incoming_option_status in ("", "idle", "pending")
        )
    ):
        return True
    allowed_removed_sections = (
        {"size_color"}
        if incoming_automation.get("optionMode") == "none"
        and incoming_options_stage.get("status") == "done"
        else set()
    )
    for key in ("sectionImages", "sectionContents"):
        existing_sections = existing_payload.get(key) or {}
        incoming_sections = incoming_payload.get(key) or {}
        if isinstance(existing_sections, dict) and isinstance(incoming_sections, dict):
            removed_sections = set(existing_sections) - set(incoming_sections)
            if removed_sections - allowed_removed_sections:
                return True
    if not existing_assets or len(existing_assets) != len(incoming_assets):
        return len(existing_assets) > len(incoming_assets)
    existing_active = sum(1 for asset in existing_assets if not asset.get("rejected"))
    incoming_active = sum(1 for asset in incoming_assets if not asset.get("rejected"))
    return existing_active > incoming_active


_LAST_WORK_REQUIRED_FIELD_ALIASES = {
    "size": ("size", "sizeSpec", "size_spec"),
    "width_mm": ("width_mm", "widthMm", "width"),
    "depth_mm": ("depth_mm", "depthMm", "depth", "length"),
    "material": ("material",),
    "usage": ("usage", "usagePurpose", "use"),
}


def _last_work_required_field_value(snapshot, field_id):
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), dict) else snapshot
    factory = assets.get("factory") if isinstance(assets.get("factory"), dict) else {}
    product = factory.get("product") if isinstance(factory.get("product"), dict) else {}
    settings = product.get("dbFieldSettings") if isinstance(product.get("dbFieldSettings"), dict) else {}
    manual_values = assets.get("productInfoManualValues") if isinstance(assets.get("productInfoManualValues"), dict) else {}
    aliases = _LAST_WORK_REQUIRED_FIELD_ALIASES.get(field_id, (field_id,))
    sources = (settings, manual_values, product)
    for source in sources:
        for alias in aliases:
            candidate = source.get(alias)
            if isinstance(candidate, dict):
                candidate = candidate.get("manualValue") or candidate.get("value") or candidate.get("text")
            value = str(candidate or "").strip()
            if value:
                return value
    return ""


def _last_work_has_required_field_drop(existing, incoming):
    return any(
        _last_work_required_field_value(existing, field_id)
        and not _last_work_required_field_value(incoming, field_id)
        for field_id in _LAST_WORK_REQUIRED_FIELD_ALIASES
    )


def _last_work_value_drop_path(existing, incoming, path=""):
    if isinstance(existing, str):
        if not existing.strip():
            return ""
        return (path or "$") if not isinstance(incoming, str) or not incoming.strip() else ""
    if isinstance(existing, list):
        if not existing:
            return ""
        if not isinstance(incoming, list) or len(existing) > len(incoming):
            return path or "$"
        for index, value in enumerate(existing):
            dropped = _last_work_value_drop_path(value, incoming[index], f"{path}[{index}]")
            if dropped:
                return dropped
        return ""
    if isinstance(existing, dict):
        if not existing:
            return ""
        if not isinstance(incoming, dict):
            return path or "$"
        for key, value in existing.items():
            child_path = f"{path}.{key}" if path else str(key)
            dropped = _last_work_value_drop_path(value, incoming.get(key), child_path)
            if dropped:
                return dropped
        return ""
    return (path or "$") if existing is not None and incoming is None else ""


def _last_work_value_dropped(existing, incoming):
    return bool(_last_work_value_drop_path(existing, incoming))


def _last_work_nonnegative_int(value):
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _last_work_row_key(row, index):
    if not isinstance(row, dict):
        return f"row:{index}"
    return str(
        row.get("id")
        or row.get("archiveId")
        or row.get("resultAssetId")
        or row.get("product_id")
        or row.get("product_no")
        or row.get("product_url")
        or row.get("url")
        or row.get("link")
        or f"row:{index}"
    )


def _last_work_rows_sparse_drop_reason(existing_rows, incoming_rows, *, match_by_position=False):
    existing_rows = existing_rows if isinstance(existing_rows, list) else []
    incoming_rows = incoming_rows if isinstance(incoming_rows, list) else []
    if len(existing_rows) > len(incoming_rows):
        return "length"
    if match_by_position:
        for index, row in enumerate(existing_rows):
            dropped = _last_work_value_drop_path(row, incoming_rows[index])
            if dropped:
                return f"[{index}].{dropped}"
        return ""
    incoming_by_key = {
        _last_work_row_key(row, index): row
        for index, row in enumerate(incoming_rows)
    }
    for index, row in enumerate(existing_rows):
        key = _last_work_row_key(row, index)
        if key not in incoming_by_key:
            return f"[{key}].missing"
        dropped = _last_work_value_drop_path(row, incoming_by_key[key])
        if dropped:
            return f"[{key}].{dropped}"
    return ""


def _last_work_rows_have_sparse_drop(existing_rows, incoming_rows, *, match_by_position=False):
    return bool(_last_work_rows_sparse_drop_reason(
        existing_rows,
        incoming_rows,
        match_by_position=match_by_position,
    ))


def _last_work_derived_state_drop_reason(existing, incoming):
    existing_assets = existing.get("assets") if isinstance(existing.get("assets"), dict) else {}
    incoming_assets = incoming.get("assets") if isinstance(incoming.get("assets"), dict) else {}
    existing_options = existing_assets.get("optionSorter") if isinstance(existing_assets.get("optionSorter"), dict) else {}
    incoming_options = incoming_assets.get("optionSorter") if isinstance(incoming_assets.get("optionSorter"), dict) else {}
    for key in ("images", "pool", "optionResults", "slots"):
        if _list_len(existing_options.get(key)) > _list_len(incoming_options.get(key)):
            return f"optionSorter.{key}.length"
    for key in ("slots", "optionResults"):
        if _last_work_rows_have_sparse_drop(
            existing_options.get(key),
            incoming_options.get(key),
            match_by_position=key == "slots",
        ):
            return f"optionSorter.{key}.content"
    existing_named = any(
        isinstance(slot, dict) and not re.fullmatch(r"\d+(?:번)?", str(slot.get("name") or "").strip())
        for slot in existing_options.get("slots") or []
    )
    incoming_named = any(
        isinstance(slot, dict) and not re.fullmatch(r"\d+(?:번)?", str(slot.get("name") or "").strip())
        for slot in incoming_options.get("slots") or []
    )
    if existing_named and not incoming_named:
        return "optionSorter.slots.names"

    existing_comp = existing_assets.get("compPage") if isinstance(existing_assets.get("compPage"), dict) else {}
    incoming_comp = incoming_assets.get("compPage") if isinstance(incoming_assets.get("compPage"), dict) else {}
    existing_market = existing_comp.get("marketScrape") if isinstance(existing_comp.get("marketScrape"), dict) else {}
    incoming_market = incoming_comp.get("marketScrape") if isinstance(incoming_comp.get("marketScrape"), dict) else {}
    for key in ("results", "vmResults", "localResults", "scrapedImages"):
        if _list_len(existing_market.get(key)) > _list_len(incoming_market.get(key)):
            return f"compPage.marketScrape.{key}.length"
        sparse_reason = _last_work_rows_sparse_drop_reason(existing_market.get(key), incoming_market.get(key))
        if sparse_reason:
            return f"compPage.marketScrape.{key}.content{sparse_reason}"
    existing_groups = existing_market.get("groupedResults") if isinstance(existing_market.get("groupedResults"), dict) else {}
    incoming_groups = incoming_market.get("groupedResults") if isinstance(incoming_market.get("groupedResults"), dict) else {}
    for group, rows in existing_groups.items():
        if (
            _list_len(rows) > _list_len(incoming_groups.get(group))
            or _last_work_rows_have_sparse_drop(rows, incoming_groups.get(group))
        ):
            return f"compPage.marketScrape.groupedResults.{group}"
    existing_selection_version = _last_work_nonnegative_int(existing_market.get("detailSelectionVersion"))
    incoming_selection_version = _last_work_nonnegative_int(incoming_market.get("detailSelectionVersion"))
    incoming_selection_is_newer = incoming_selection_version > existing_selection_version
    for key in ("selectedIds", "selectedImageIds"):
        existing_selected = {str(value) for value in existing_market.get(key) or [] if str(value)}
        incoming_selected = {str(value) for value in incoming_market.get(key) or [] if str(value)}
        if not incoming_selection_is_newer and not existing_selected.issubset(incoming_selected):
            return f"compPage.marketScrape.{key}"
    existing_details = existing_market.get("detailResults") if isinstance(existing_market.get("detailResults"), dict) else {}
    incoming_details = incoming_market.get("detailResults") if isinstance(incoming_market.get("detailResults"), dict) else {}
    if any(
        key not in incoming_details
        or _last_work_value_dropped(value, incoming_details.get(key))
        for key, value in existing_details.items()
    ):
        return "compPage.marketScrape.detailResults"
    for key in ("analysisResult", "sectionPlan", "planEdits"):
        if _last_work_value_dropped(existing_comp.get(key), incoming_comp.get(key)):
            return f"compPage.{key}"
    return ""

@api.route("/last-work", methods=["GET"])
def get_last_work():
    workspace_id = _last_work_workspace_id()
    last_work_path, _ = _last_work_paths(workspace_id)
    snapshot = _load_json_file(last_work_path)
    revision = 0
    if workspace_id.startswith("project:"):
        try:
            revision = get_workspace_status(workspace_id).revision
        except TypeError:
            revision = 0
    if not snapshot:
        response = jsonify({
            "ok": True,
            "hasSnapshot": False,
            "snapshot": None,
            "workspaceId": workspace_id,
            "path": last_work_path,
            "revision": revision,
        })
        response.headers["ETag"] = f'"workspace-rev-{revision}"'
        return response
    response = jsonify({
        "ok": True,
        "hasSnapshot": True,
        "snapshot": snapshot,
        "score": _last_work_score(snapshot),
        "path": last_work_path,
        "workspaceId": workspace_id,
        "revision": revision,
    })
    response.headers["ETag"] = f'"workspace-rev-{revision}"'
    return response


@api.route("/last-work", methods=["POST"])
def save_last_work():
    body = request.get_json(silent=True) or {}
    incoming = body.get("snapshot") if isinstance(body.get("snapshot"), dict) else body
    if not isinstance(incoming, dict):
        return jsonify({"ok": False, "error": "snapshot must be an object"}), 400

    workspace_id = _last_work_workspace_id(body, incoming)
    try:
        authority_snapshot = validate_workspace_mutation(workspace_id, body)
    except PreconditionRequired as error:
        return jsonify({
            "ok": False,
            "code": "PRECONDITION_REQUIRED",
            "error": str(error),
        }), 428
    except WorkspaceConflict as error:
        payload = error.snapshot.as_dict()
        payload.update({"ok": False, "accepted": False, "code": error.code})
        return jsonify(payload), 409
    last_work_path, last_work_backup_path = _last_work_paths(workspace_id)
    incoming.setdefault("id", "current")
    if workspace_id:
        incoming["workspaceId"] = workspace_id
        incoming["workspaceScope"] = {"id": workspace_id}
    incoming_score = _last_work_score(incoming)
    existing = _load_json_file(last_work_path)
    existing_score = _last_work_score(existing)
    force = bool(body.get("force") or incoming.get("force"))
    repair = body.get("repair") is True

    # Empty reloads must not erase a richer last-work snapshot.
    if existing and not force and existing_score > incoming_score and incoming_score <= 2:
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "reason": "incoming snapshot is emptier than saved last work",
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
        })

    if existing and _last_work_has_required_field_drop(existing, incoming):
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "protectedNoOp": True,
            "reason": "incoming snapshot dropped protected required fields",
            "scopeId": authority_snapshot.scope_id,
            "revision": authority_snapshot.revision,
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
        })

    derived_drop_reason = existing and _last_work_derived_state_drop_reason(existing, incoming)
    if derived_drop_reason:
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "protectedNoOp": True,
            "reason": f"incoming snapshot changed work identity or dropped protected work data: {derived_drop_reason}",
            "scopeId": authority_snapshot.scope_id,
            "revision": authority_snapshot.revision,
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
        })

    if existing and not force and _snapshot_has_comp_analysis(existing) and not _snapshot_has_comp_analysis(incoming):
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "protectedNoOp": True,
            "reason": "incoming snapshot has no competitor analysis result",
            "scopeId": authority_snapshot.scope_id,
            "revision": authority_snapshot.revision,
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
        })

    existing_comp_at = _snapshot_comp_analysis_time(existing)
    incoming_comp_at = _snapshot_comp_analysis_time(incoming)
    if existing and not force and existing_comp_at and incoming_comp_at and existing_comp_at > incoming_comp_at + 1000:
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "reason": "incoming competitor analysis is older than saved result",
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
            "existingCompAnalyzedAt": existing_comp_at,
            "incomingCompAnalyzedAt": incoming_comp_at,
        })

    if existing and not repair and _last_work_has_destructive_identity_drift(existing, incoming):
        return jsonify({
            "ok": True,
            "accepted": False,
            "keptExisting": True,
            "protectedNoOp": True,
            "reason": "incoming snapshot changed work identity or dropped protected work data",
            "scopeId": authority_snapshot.scope_id,
            "revision": authority_snapshot.revision,
            "score": existing_score,
            "incomingScore": incoming_score,
            "savedAt": existing.get("savedAt"),
        })

    last_work_changes = []
    if existing:
        last_work_changes.append(FileWrite(
            Path(last_work_backup_path), json.dumps(existing, ensure_ascii=False)
        ))
    last_work_changes.append(FileWrite(
        Path(last_work_path), json.dumps(incoming, ensure_ascii=False)
    ))

    try:
        authority, _ = commit_workspace_mutation(
            workspace_id,
            body,
            StagedFilesystemMutation(result=True, changes=tuple(last_work_changes)),
        )
    except PreconditionRequired as error:
        return jsonify({
            "ok": False,
            "code": "PRECONDITION_REQUIRED",
            "error": str(error),
        }), 428
    except WorkspaceConflict as error:
        payload = error.snapshot.as_dict()
        payload.update({"ok": False, "accepted": False, "code": error.code})
        return jsonify(payload), 409
    except OSError as error:
        return jsonify({"ok": False, "code": "WRITE_FAILED", "error": str(error)}), 500

    archive_body = {
        **body,
        "expectedRevision": authority.revision,
        "revision": authority.revision,
    }
    try:
        _, archive_result = commit_workspace_replica(
            workspace_id, archive_body, lambda: _archive_last_work_images(incoming)
        )
    except (PreconditionRequired, WorkspaceConflict, OSError) as error:
        archive_result = {"count": 0, "skipped": 0, "error": str(error)}

    return jsonify({
        "ok": True,
        "accepted": True,
        "score": incoming_score,
        "backupPath": last_work_backup_path if existing else "",
        "path": last_work_path,
        "workspaceId": workspace_id,
        "revision": authority.revision,
        "savedAt": incoming.get("savedAt"),
        "localArchive": {
            "count": archive_result.get("count", 0),
            "skipped": archive_result.get("skipped", 0),
            "error": archive_result.get("error", ""),
            "libraryRoot": archive_result.get("libraryRoot", ""),
            "libraryFileCount": archive_result.get("libraryFileCount", 0),
            "libraryPendingRemoteCount": archive_result.get("libraryPendingRemoteCount", 0),
        },
    })


@api.route("/last-work", methods=["DELETE"])
def clear_last_work():
    """Clear the cross-port last-work snapshot after explicit user action."""
    body = request.get_json(silent=True) or {}
    workspace_id = _last_work_workspace_id(body)
    try:
        validate_workspace_mutation(workspace_id, body)
    except PreconditionRequired as error:
        return jsonify({"ok": False, "code": "PRECONDITION_REQUIRED", "error": str(error)}), 428
    except WorkspaceConflict as error:
        payload = error.snapshot.as_dict()
        payload.update({"ok": False, "code": error.code})
        return jsonify(payload), 409
    last_work_path, last_work_backup_path = _last_work_paths(workspace_id)
    existing = _load_json_file(last_work_path)
    clear_changes = []
    if existing:
        clear_changes.append(FileWrite(
            Path(last_work_backup_path), json.dumps(existing, ensure_ascii=False)
        ))
    clear_changes.append(FileDelete(Path(last_work_path)))
    try:
        authority, _ = commit_workspace_mutation(
            workspace_id,
            body,
            StagedFilesystemMutation(result=True, changes=tuple(clear_changes)),
        )
    except PreconditionRequired as error:
        return jsonify({"ok": False, "code": "PRECONDITION_REQUIRED", "error": str(error)}), 428
    except WorkspaceConflict as error:
        payload = error.snapshot.as_dict()
        payload.update({"ok": False, "code": error.code})
        return jsonify(payload), 409
    except OSError as error:
        return jsonify({"ok": False, "code": "WRITE_FAILED", "error": str(error)}), 500
    return jsonify({
        "ok": True,
        "cleared": True,
        "workspaceId": workspace_id,
        "revision": authority.revision,
    })


# ── Local Generated Asset Archive ───────────────────────────────

def _local_archive_safe_name(value, fallback="asset", max_len=80):
    text = str(value or "").strip()
    if not text:
        text = fallback
    text = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", text)
    text = re.sub(r"\s+", "_", text).strip(" ._")
    text = re.sub(r"_+", "_", text)
    return (text[:max_len].strip(" ._") or fallback)


def _local_archive_load_index():
    data = _load_json_file(_LOCAL_ARCHIVE_INDEX_PATH)
    if not isinstance(data, dict):
        return {"version": 1, "root": Config.LOCAL_ARCHIVE_FOLDER, "assets": []}
    if not isinstance(data.get("assets"), list):
        data["assets"] = []
    data["root"] = Config.LOCAL_ARCHIVE_FOLDER
    data["version"] = data.get("version") or 1
    return data


def _local_archive_write_index(index):
    index["root"] = Config.LOCAL_ARCHIVE_FOLDER
    index["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    _atomic_write_json(_LOCAL_ARCHIVE_INDEX_PATH, index)


def _local_archive_scope_is_complete(identity):
    if not isinstance(identity, dict):
        return False
    return all(str(identity.get(field) or "").strip() for field in (
        "workspaceId",
        "productKey",
        "currentRunId",
        "inputImageFingerprint",
        "stageId",
    ))


def _local_archive_workfile_folder_name(workspace_id):
    normalized = str(workspace_id or "").strip()
    if not normalized:
        return ""
    readable = _local_archive_safe_name(normalized, "workfile", 56)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"{readable}__{digest}"


def _local_archive_workfile_paths(workspace_id):
    folder_name = _local_archive_workfile_folder_name(workspace_id)
    if not folder_name:
        return None, None
    workfile_dir = Path(Config.LOCAL_ARCHIVE_FOLDER) / "workfiles" / folder_name
    return workfile_dir, workfile_dir / "manifest.json"


def _local_archive_record_identity(record):
    return {
        "workspaceId": str(record.get("workspaceId") or "").strip(),
        "productKey": str(record.get("productKey") or "").strip(),
        "currentRunId": str(record.get("currentRunId") or "").strip(),
        "inputImageFingerprint": str(record.get("inputImageFingerprint") or "").strip(),
        "stageId": str(record.get("stageId") or "").strip(),
    }


def _local_archive_item_directory(identity, created_dt, category, stage_id, item_name):
    if _local_archive_scope_is_complete(identity):
        workfile_dir, _ = _local_archive_workfile_paths(identity["workspaceId"])
        if workfile_dir:
            return (
                workfile_dir /
                "assets" /
                _local_archive_safe_name(identity["productKey"], "product", 64) /
                _local_archive_safe_name(identity["currentRunId"], "run", 64) /
                _local_archive_safe_name(identity["inputImageFingerprint"], "image", 64) /
                _local_archive_safe_name(category, "category", 48) /
                _local_archive_safe_name(stage_id, "asset", 48) /
                item_name
            )
    return (
        Path(Config.LOCAL_ARCHIVE_FOLDER) /
        created_dt.strftime("%Y-%m-%d") /
        _local_archive_safe_name(identity.get("productName"), "product") /
        _local_archive_safe_name(identity.get("currentRunId") or "no_run", "no_run", 48) /
        _local_archive_safe_name(category, "category", 48) /
        _local_archive_safe_name(stage_id, "asset", 48) /
        item_name
    )


def _local_archive_append_workfile_manifest(record):
    identity = _local_archive_record_identity(record)
    if not _local_archive_scope_is_complete(identity):
        return ""
    workfile_dir, manifest_path = _local_archive_workfile_paths(identity["workspaceId"])
    if not workfile_dir or not manifest_path:
        return ""
    workfile_dir.mkdir(parents=True, exist_ok=True)
    existing = _load_json_file(str(manifest_path))
    manifest = existing if isinstance(existing, dict) else {}
    if str(manifest.get("workspaceId") or "").strip() not in {"", identity["workspaceId"]}:
        raise RuntimeError("workfile manifest workspace identity mismatch")

    record_copy = dict(record)
    record_copy["workfileFolder"] = str(workfile_dir)
    record_copy["workfileManifestPath"] = str(manifest_path)
    archive_id = str(record_copy.get("archiveId") or "").strip()
    current_records = manifest.get("assets") if isinstance(manifest.get("assets"), list) else []
    retained_records = [
        item for item in current_records
        if str(item.get("archiveId") or "").strip() != archive_id
    ]
    manifest.update({
        "version": 1,
        "workspaceId": identity["workspaceId"],
        "workfileFolder": str(workfile_dir),
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "assets": [record_copy, *retained_records],
    })
    _atomic_write_json(str(manifest_path), manifest)
    record["workfileFolder"] = str(workfile_dir)
    record["workfileManifestPath"] = str(manifest_path)
    return str(manifest_path)


def _local_archive_manifest_matches_scope(record, scope):
    identity = _local_archive_record_identity(record)
    if not _local_archive_scope_is_complete(identity):
        return False
    return all(identity[field] == str(scope.get(field) or "").strip() for field in (
        "workspaceId",
        "productKey",
        "currentRunId",
        "inputImageFingerprint",
    ))


def _local_archive_record_has_payload(record):
    if not isinstance(record, dict):
        return False
    files = record.get("files") if isinstance(record.get("files"), dict) else {}
    return any(
        _local_archive_safe_existing_file(files.get(field))
        for field in ("imagePath", "htmlPath", "contentPath")
    )


def _local_archive_latest_stage_records(workspace_id, product_key, input_image_fingerprint, preferred_stage_runs=None):
    preferred_stage_runs = preferred_stage_runs if isinstance(preferred_stage_runs, dict) else {}
    grouped = {}
    for record in _local_archive_load_index().get("assets", []):
        if not isinstance(record, dict):
            continue
        identity = _local_archive_record_identity(record)
        if not _local_archive_scope_is_complete(identity):
            continue
        if (
            identity["workspaceId"] != workspace_id
            or identity["productKey"] != product_key
            or identity["inputImageFingerprint"] != input_image_fingerprint
        ):
            continue
        if not _local_archive_record_has_payload(record):
            continue
        key = (identity["stageId"], identity["currentRunId"])
        grouped.setdefault(key, []).append(record)

    selected_runs = {}
    stage_ids = sorted({stage_id for stage_id, _ in grouped})
    for stage_id in stage_ids:
        preferred_run = str(preferred_stage_runs.get(stage_id) or "").strip()
        stage_groups = [
            (run_id, records)
            for (group_stage_id, run_id), records in grouped.items()
            if group_stage_id == stage_id and (not preferred_run or run_id == preferred_run)
        ]
        if not stage_groups:
            continue
        run_id, records = max(
            stage_groups,
            key=lambda item: max(
                str(record.get("savedAt") or record.get("createdAt") or "")
                for record in item[1]
            ),
        )
        selected_runs[stage_id] = run_id

    selected_records = [
        record
        for (stage_id, run_id), records in grouped.items()
        if selected_runs.get(stage_id) == run_id
        for record in records
    ]
    selected_records.sort(key=lambda item: str(item.get("savedAt") or item.get("createdAt") or ""), reverse=True)
    return selected_records, selected_runs


def _local_archive_decode_data_url(value):
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", str(value or ""), re.S)
    if not match:
        return None
    mime = (match.group(1) or "application/octet-stream").strip()
    payload = match.group(3) or ""
    if match.group(2):
        raw = base64.b64decode(payload)
    else:
        from urllib.parse import unquote_to_bytes
        raw = unquote_to_bytes(payload)
    return mime, raw


def _local_archive_ext_for_mime(mime, fallback="bin"):
    ext = (mimetypes.guess_extension(mime or "") or "").lstrip(".").lower()
    if ext == "jpe":
        ext = "jpg"
    if ext:
        return ext
    if "png" in str(mime or "").lower():
        return "png"
    if "jpeg" in str(mime or "").lower() or "jpg" in str(mime or "").lower():
        return "jpg"
    if "webp" in str(mime or "").lower():
        return "webp"
    return fallback


def _local_archive_kind_for_stage(stage_id="", metadata=None, source_map=None, title=""):
    metadata = metadata if isinstance(metadata, dict) else {}
    source_map = source_map if isinstance(source_map, dict) else {}
    raw_stage = str(stage_id or metadata.get("stageId") or source_map.get("stageId") or "asset").strip()
    stage = raw_stage.lower()
    raw_text = " ".join([
        raw_stage,
        str(title or ""),
        str(metadata.get("assetKind") or ""),
        str(metadata.get("category") or ""),
        str(metadata.get("source") or ""),
        str(source_map.get("source") or ""),
    ]).lower()
    section_id = str(metadata.get("sectionId") or source_map.get("sectionId") or "").strip()
    if not section_id and stage.startswith("section_"):
        section_id = raw_stage[len("section_"):]
    if not section_id and stage.startswith("detail_after_"):
        section_id = raw_stage[len("detail_after_"):]

    if metadata.get("assetKind") or metadata.get("categoryLabel"):
        return {
            "assetKind": str(metadata.get("assetKind") or "asset"),
            "category": str(metadata.get("category") or metadata.get("assetKind") or "asset"),
            "categoryLabel": str(metadata.get("categoryLabel") or metadata.get("assetKind") or "보관 이미지"),
            "sectionId": section_id,
        }
    if stage == "hero" or "대표" in raw_text:
        return {"assetKind": "hero", "category": "hero-images", "categoryLabel": "대표컷 이미지파일", "sectionId": section_id}
    if stage == "size" or "사이즈" in raw_text:
        return {"assetKind": "size", "category": "size-images", "categoryLabel": "사이즈 이미지파일", "sectionId": section_id}
    if stage == "options" or "색상" in raw_text or "option" in raw_text:
        return {"assetKind": "option", "category": "option-images", "categoryLabel": "색상옵션 이미지파일", "sectionId": section_id}
    if stage == "cuts" or stage.startswith("cuts_") or "이미지컷" in raw_text:
        return {"assetKind": "cut", "category": "cut-images", "categoryLabel": "이미지컷 파일", "sectionId": section_id}
    if stage.startswith("section_"):
        return {"assetKind": "section", "category": "section-images", "categoryLabel": "섹션 이미지파일", "sectionId": section_id}
    if stage.startswith("detail") or "상세" in raw_text:
        return {"assetKind": "detail", "category": "detail-page-files", "categoryLabel": "상세페이지 파일", "sectionId": section_id}
    return {"assetKind": "asset", "category": "misc-images", "categoryLabel": "기타 보관 파일", "sectionId": section_id}


def _last_work_archive_identity(snapshot):
    if not isinstance(snapshot, dict):
        snapshot = {}
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), dict) else snapshot
    factory = assets.get("factory") if isinstance(assets.get("factory"), dict) else {}
    product = factory.get("product") if isinstance(factory.get("product"), dict) else {}
    workspace = factory.get("workspace") if isinstance(factory.get("workspace"), dict) else {}
    scope = (
        assets.get("sectionWorkScope")
        if isinstance(assets.get("sectionWorkScope"), dict)
        else factory.get("sectionWorkScope") if isinstance(factory.get("sectionWorkScope"), dict) else {}
    )
    product_name = (
        assets.get("productName")
        or product.get("productName")
        or scope.get("productName")
        or scope.get("productKey")
        or "상품명_미지정"
    )
    return {
        "workspaceId": str(
            assets.get("currentProjectId")
            or factory.get("workspaceId")
            or workspace.get("id")
            or snapshot.get("workspaceId")
            or snapshot.get("currentProjectId")
            or ""
        ).strip(),
        "productName": str(product_name or "상품명_미지정").strip(),
        "productKey": str(
            scope.get("productKey") or product.get("productKey") or product_name or ""
        ).strip(),
        "currentRunId": str(
            scope.get("currentRunId")
            or product.get("currentRunId")
            or assets.get("currentRunId")
            or ""
        ).strip(),
        "inputImageFingerprint": str(
            scope.get("inputImageFingerprint")
            or scope.get("inputImageKey")
            or scope.get("sourceImageKey")
            or product.get("inputImageFingerprint")
            or product.get("lockedInputImageFingerprint")
            or ""
        ).strip(),
    }


_LOCAL_ASSET_HTTP_LIMITS = httpx2.Limits(
    max_connections=200,
    max_keepalive_connections=40,
    keepalive_expiry=30.0,
)
_LOCAL_ASSET_HTTP_TIMEOUT = httpx2.Timeout(
    connect=5.0,
    read=30.0,
    write=10.0,
    pool=10.0,
)
_LOCAL_ASSET_SOCKET_OPTIONS = [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]
_LOCAL_ASSET_MAX_REMOTE_BYTES = 20 * 1024 * 1024


def _local_asset_http_client():
    transport = httpx2.HTTPTransport(
        http2=True,
        retries=3,
        limits=_LOCAL_ASSET_HTTP_LIMITS,
        socket_options=_LOCAL_ASSET_SOCKET_OPTIONS,
    )
    return httpx2.Client(
        transport=transport,
        timeout=_LOCAL_ASSET_HTTP_TIMEOUT,
        follow_redirects=True,
    )


def _local_asset_remote_url_is_public(url):
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    try:
        addresses = socket.getaddrinfo(
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror:
        return False
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return bool(addresses)


def _local_asset_fetch_remote_image(client, url):
    if not _local_asset_remote_url_is_public(url):
        return None
    try:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            mime = str(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if not mime.startswith("image/"):
                return None
            chunks = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > _LOCAL_ASSET_MAX_REMOTE_BYTES:
                    return None
                chunks.append(chunk)
            return mime, b"".join(chunks)
    except httpx2.HTTPError:
        return None


def _local_asset_read_image_file(path_value):
    path = Path(str(path_value or "")).expanduser()
    if not path.is_file():
        return None
    mime = str(mimetypes.guess_type(path.name)[0] or "").lower()
    if not mime.startswith("image/"):
        return None
    try:
        return mime, path.read_bytes()
    except OSError:
        return None


def _local_asset_fetch_local_reference(url, records):
    parsed = urlparse(str(url or "").strip())
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return None
    if parsed.path == "/api/local_image":
        paths = parse_qs(parsed.query).get("path") or []
        return _local_asset_read_image_file(paths[0] if paths else "")
    archive_match = re.fullmatch(
        r"/api/local-archive/assets/([^/]+)/image",
        parsed.path,
    )
    if archive_match:
        archive_id = unquote(archive_match.group(1))
        record = next(
            (
                item
                for item in records
                if str(item.get("archiveId") or "") == archive_id
            ),
            {},
        )
        files = record.get("files") if isinstance(record.get("files"), dict) else {}
        return _local_asset_read_image_file(files.get("imagePath"))
    artifact_match = re.fullmatch(
        r"/api/vm-detail-capture/([^/]+)/artifacts/(\d+)",
        parsed.path,
    )
    if not artifact_match:
        return None
    artifact = vm_candidate_bridge.read_artifact(
        artifact_match.group(1),
        int(artifact_match.group(2)),
    )
    return _local_asset_read_image_file(artifact)


def _local_asset_fetch_sync_reference(url, records):
    parsed = urlparse(str(url or "").strip())
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return None
    if parsed.path != "/api/local_image":
        return _local_asset_fetch_local_reference(url, records)
    paths = parse_qs(parsed.query).get("path") or []
    if not paths:
        return None
    try:
        candidate = Path(paths[0]).expanduser().resolve()
        managed_root = Path(_JEPUM_ROOT).expanduser().resolve()
    except OSError:
        return None
    if not candidate.is_relative_to(managed_root):
        return None
    return _local_asset_read_image_file(candidate)


def _local_asset_library_identity(snapshot, fallback=None):
    fallback = fallback if isinstance(fallback, dict) else {}
    identity = _last_work_archive_identity(snapshot)
    return LibraryIdentity(
        workspace_id=str(identity.get("workspaceId") or fallback.get("workspaceId") or "").strip(),
        product_name=str(
            identity.get("productName")
            or fallback.get("productName")
            or fallback.get("productKey")
            or "상품명_미지정"
        ).strip(),
        product_key=str(
            identity.get("productKey")
            or fallback.get("productKey")
            or fallback.get("productName")
            or ""
        ).strip(),
        input_image_fingerprint=str(
            identity.get("inputImageFingerprint")
            or fallback.get("inputImageFingerprint")
            or ""
        ).strip(),
    )


def _local_asset_library_snapshot_for_workspace(workspace_id):
    normalized = str(workspace_id or "").strip()
    if not normalized:
        return {}
    candidates = [normalized]
    if not normalized.startswith("project:"):
        candidates.insert(0, f"project:{normalized}")
    for candidate in candidates:
        snapshot_path, _ = _last_work_paths(candidate)
        snapshot = _load_json_file(snapshot_path)
        if isinstance(snapshot, dict):
            return snapshot
    return {}


def _organize_local_asset_library(snapshot, fallback=None, download_remote=False):
    identity = _local_asset_library_identity(snapshot, fallback)
    if not identity.workspace_id:
        return None
    records = tuple(
        record
        for record in _local_archive_load_index().get("assets", [])
        if isinstance(record, dict)
    )
    if not download_remote:
        return build_workfile_library(LibraryBuildRequest(
            archive_root=Path(Config.LOCAL_ARCHIVE_FOLDER),
            identity=identity,
            snapshot=snapshot if isinstance(snapshot, dict) else {},
            archive_records=records,
            fetch_image=lambda url: _local_asset_fetch_local_reference(url, records),
        ))
    with _local_asset_http_client() as client:
        return build_workfile_library(LibraryBuildRequest(
            archive_root=Path(Config.LOCAL_ARCHIVE_FOLDER),
            identity=identity,
            snapshot=snapshot if isinstance(snapshot, dict) else {},
            archive_records=records,
            fetch_image=lambda url: (
                _local_asset_fetch_local_reference(url, records)
                or _local_asset_fetch_remote_image(client, url)
            ),
        ))


def _last_work_archive_image_candidates(snapshot):
    if not isinstance(snapshot, dict):
        return []
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), dict) else snapshot
    candidates = []

    def add(stage_id, title, image_value, metadata=None, content=None, source_map=None):
        if not isinstance(image_value, str) or not image_value.startswith("data:image/"):
            return
        candidates.append({
            "stageId": str(stage_id or "last_work"),
            "title": str(title or stage_id or "image"),
            "image": image_value,
            "metadata": metadata if isinstance(metadata, dict) else {},
            "sourceMap": source_map if isinstance(source_map, dict) else {},
            "content": content if isinstance(content, dict) else None,
        })

    section_images = assets.get("sectionImages") if isinstance(assets.get("sectionImages"), dict) else {}
    section_contents = assets.get("sectionContents") if isinstance(assets.get("sectionContents"), dict) else {}
    for section_id, image_value in section_images.items():
        add(
            f"section_{section_id}",
            f"섹션 이미지 {section_id}",
            image_value,
            {"sectionId": section_id, "source": "last-work.sectionImages"},
            section_contents.get(section_id) if isinstance(section_contents.get(section_id), dict) else None,
        )

    detail_blocks = assets.get("detailImageBlocks") if isinstance(assets.get("detailImageBlocks"), list) else []
    for idx, block in enumerate(detail_blocks):
        if not isinstance(block, dict):
            continue
        add(
            f"detail_after_{block.get('afterSectionId') or 'section'}",
            block.get("label") or f"상세 추가 이미지 {idx + 1}",
            block.get("dataUrl"),
            {"blockId": block.get("id"), "afterSectionId": block.get("afterSectionId"), "source": "last-work.detailImageBlocks"},
            None,
        )

    cuts = assets.get("cuts") if isinstance(assets.get("cuts"), dict) else {}
    for group_name in ("prompts", "sizePrompts", "results"):
        group = cuts.get(group_name) if isinstance(cuts.get(group_name), list) else []
        for idx, item in enumerate(group):
            if not isinstance(item, dict):
                continue
            add(
                f"cuts_{group_name}",
                item.get("title") or item.get("label") or f"이미지컷 {idx + 1}",
                item.get("result") or item.get("image") or item.get("dataUrl"),
                {"itemId": item.get("id"), "source": f"last-work.cuts.{group_name}"},
                None,
            )

    factory = assets.get("factory") if isinstance(assets.get("factory"), dict) else {}
    factory_assets = factory.get("assets") if isinstance(factory.get("assets"), list) else []
    for idx, item in enumerate(factory_assets):
        if not isinstance(item, dict):
            continue
        item_metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        item_source_map = item.get("sourceMap") if isinstance(item.get("sourceMap"), dict) else {}
        add(
            item.get("stageId") or "factory_asset",
            item.get("title") or item.get("label") or f"조립공장 자산 {idx + 1}",
            item.get("image") or item.get("dataUrl") or item.get("result"),
            {
                **item_metadata,
                "assetId": item.get("id"),
                "source": "last-work.factory.assets",
                "productName": item.get("productName") or item_metadata.get("productName"),
                "productKey": item.get("productKey") or item_metadata.get("productKey"),
                "currentRunId": item.get("currentRunId") or item.get("generationRunId") or item_metadata.get("currentRunId") or item_metadata.get("generationRunId"),
                "generationRunId": item.get("generationRunId") or item.get("currentRunId") or item_metadata.get("generationRunId") or item_metadata.get("currentRunId"),
                "inputImageFingerprint": item.get("inputImageFingerprint") or item_metadata.get("inputImageFingerprint"),
                "stageId": item.get("stageId") or item_metadata.get("stageId"),
            },
            None,
            {
                **item_source_map,
                "productName": item.get("productName") or item_source_map.get("productName"),
                "productKey": item.get("productKey") or item_source_map.get("productKey"),
                "currentRunId": item.get("currentRunId") or item.get("generationRunId") or item_source_map.get("currentRunId") or item_source_map.get("generationRunId"),
                "generationRunId": item.get("generationRunId") or item.get("currentRunId") or item_source_map.get("generationRunId") or item_source_map.get("currentRunId"),
                "inputImageFingerprint": item.get("inputImageFingerprint") or item_source_map.get("inputImageFingerprint"),
                "stageId": item.get("stageId") or item_source_map.get("stageId"),
            },
        )

    return candidates


def _archive_last_work_images(snapshot):
    identity = _last_work_archive_identity(snapshot)
    candidates = _last_work_archive_image_candidates(snapshot)
    if not candidates:
        return {"count": 0, "skipped": 0, "records": []}

    saved_records = []
    skipped = 0
    now_ms = int(time.time() * 1000)
    with _LOCAL_ARCHIVE_LOCK:
        index = _local_archive_load_index()
        for idx, candidate in enumerate(candidates):
            decoded = None
            try:
                decoded = _local_archive_decode_data_url(candidate["image"])
            except Exception:
                decoded = None
            if not decoded:
                skipped += 1
                continue
            mime, raw = decoded
            content_hash = hashlib.sha1(raw).hexdigest()
            stage_id = candidate["stageId"]

            candidate_metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), dict) else {}
            candidate_source_map = candidate.get("sourceMap") if isinstance(candidate.get("sourceMap"), dict) else {}
            def pick_text(*values):
                for value in values:
                    text = str(value or "").strip()
                    if text:
                        return text
                return ""
            candidate_identity = {
                "workspaceId": pick_text(
                    candidate.get("workspaceId"),
                    candidate.get("currentProjectId"),
                    candidate_metadata.get("workspaceId"),
                    candidate_metadata.get("currentProjectId"),
                    candidate_source_map.get("workspaceId"),
                    candidate_source_map.get("currentProjectId"),
                    identity["workspaceId"],
                ),
                "productName": pick_text(
                    candidate.get("productName"),
                    candidate_metadata.get("productName"),
                    candidate_source_map.get("productName"),
                    identity["productName"],
                ),
                "productKey": pick_text(
                    candidate.get("productKey"),
                    candidate_metadata.get("productKey"),
                    candidate_metadata.get("productIdentityKey"),
                    candidate_source_map.get("productKey"),
                    candidate_source_map.get("productIdentityKey"),
                    identity["productKey"],
                ),
                "currentRunId": pick_text(
                    candidate.get("currentRunId"),
                    candidate.get("generationRunId"),
                    candidate_metadata.get("currentRunId"),
                    candidate_metadata.get("generationRunId"),
                    candidate_source_map.get("currentRunId"),
                    candidate_source_map.get("generationRunId"),
                    identity["currentRunId"],
                ),
                "inputImageFingerprint": pick_text(
                    candidate.get("inputImageFingerprint"),
                    candidate_metadata.get("inputImageFingerprint"),
                    candidate_metadata.get("inputImageKey"),
                    candidate_metadata.get("sourceImageKey"),
                    candidate_metadata.get("productImageKey"),
                    candidate_source_map.get("inputImageFingerprint"),
                    candidate_source_map.get("inputImageKey"),
                    candidate_source_map.get("sourceImageKey"),
                    candidate_source_map.get("productImageKey"),
                    identity["inputImageFingerprint"],
                ),
                "stageId": stage_id,
            }
            duplicate = next((
                item for item in index.get("assets", [])
                if _local_archive_same_asset_record(item, candidate_identity, stage_id, content_hash)
            ), None)
            if duplicate:
                skipped += 1
                continue

            identity_scope = "|".join([
                candidate_identity["workspaceId"],
                candidate_identity["productKey"],
                candidate_identity["currentRunId"],
                candidate_identity["inputImageFingerprint"],
                stage_id,
                content_hash,
            ])
            identity_hash = hashlib.sha1(identity_scope.encode("utf-8", errors="ignore")).hexdigest()[:10]
            title = candidate["title"]
            kind = _local_archive_kind_for_stage(stage_id, candidate_metadata, candidate_source_map, title)
            item_name = f"{datetime.now().strftime('%H%M%S')}_{_local_archive_safe_name(title, 'image', 52)}_{content_hash[:10]}_{identity_hash}"
            item_dir = _local_archive_item_directory(
                candidate_identity,
                datetime.fromtimestamp(now_ms / 1000),
                kind["category"],
                stage_id,
                item_name,
            )
            item_dir.mkdir(parents=True, exist_ok=True)
            ext = _local_archive_ext_for_mime(mime, "bin")
            image_path = item_dir / f"image.{ext}"
            image_path.write_bytes(raw)

            metadata_path = item_dir / "metadata.json"
            metadata_path.write_text(json.dumps({
                "identity": candidate_identity,
                "stageId": stage_id,
                "title": title,
                "metadata": candidate_metadata,
                "sourceMap": candidate_source_map,
                "content": candidate.get("content"),
                "contentHash": content_hash,
                "source": "last-work-auto-archive",
                "assetKind": kind["assetKind"],
                "category": kind["category"],
                "categoryLabel": kind["categoryLabel"],
                "sectionId": kind["sectionId"],
            }, ensure_ascii=False, indent=2), encoding="utf-8")

            asset_path = item_dir / "asset.json"
            asset_id = f"last_work_{stage_id}_{content_hash[:10]}_{identity_hash}"
            asset_path.write_text(json.dumps({
                "id": asset_id,
                "title": title,
                "type": "image",
                "stageId": stage_id,
                "workspaceId": candidate_identity["workspaceId"],
                "productName": candidate_identity["productName"],
                "productKey": candidate_identity["productKey"],
                "currentRunId": candidate_identity["currentRunId"],
                "inputImageFingerprint": candidate_identity["inputImageFingerprint"],
                "contentHash": content_hash,
                "assetKind": kind["assetKind"],
                "category": kind["category"],
                "categoryLabel": kind["categoryLabel"],
                "sectionId": kind["sectionId"],
                "localFiles": {
                    "imagePath": str(image_path),
                    "imageMime": mime,
                    "imageBytes": len(raw),
                    "metadataPath": str(metadata_path),
                },
            }, ensure_ascii=False, indent=2), encoding="utf-8")

            archive_id_source = "|".join([
                candidate_identity["workspaceId"],
                candidate_identity["productKey"],
                candidate_identity["currentRunId"],
                candidate_identity["inputImageFingerprint"],
                stage_id,
                content_hash,
            ])
            archive_id = hashlib.sha1(archive_id_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
            record = {
                "archiveId": archive_id,
                "assetId": asset_id,
                "title": title,
                "type": "image",
                "stageId": stage_id,
                "workspaceId": candidate_identity["workspaceId"],
                "productName": candidate_identity["productName"],
                "productKey": candidate_identity["productKey"],
                "currentRunId": candidate_identity["currentRunId"],
                "inputImageFingerprint": candidate_identity["inputImageFingerprint"],
                "contentHash": content_hash,
                "assetKind": kind["assetKind"],
                "category": kind["category"],
                "categoryLabel": kind["categoryLabel"],
                "sectionId": kind["sectionId"],
                "folder": str(item_dir),
                "files": {
                    "imagePath": str(image_path),
                    "imageMime": mime,
                    "imageBytes": len(raw),
                    "metadataPath": str(metadata_path),
                    "assetPath": str(asset_path),
                },
                "savedAt": datetime.now().isoformat(timespec="seconds"),
                "createdAt": datetime.fromtimestamp(now_ms / 1000).isoformat(timespec="seconds"),
                "reason": "last-work-auto-archive",
                "origin": "last-work",
                "sourceLabel": (candidate.get("metadata") or {}).get("source") or "last-work",
            }
            saved_records.append(record)

        if saved_records:
            for record in saved_records:
                _local_archive_append_workfile_manifest(record)
            index["assets"] = [*saved_records, *index.get("assets", [])][:5000]
            _local_archive_write_index(index)

    library = _organize_local_asset_library(snapshot)
    return {
        "count": len(saved_records),
        "skipped": skipped,
        "records": saved_records[:20],
        "libraryRoot": str(library.root) if library else "",
        "libraryFileCount": library.file_count if library else 0,
        "libraryPendingRemoteCount": library.pending_remote_count if library else 0,
    }


def _local_archive_normalize_path_text(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("\\\\"):
        prefix = "\\\\"
        rest = text[2:]
    elif re.match(r"^[A-Za-z]:[\\/]", text):
        prefix = text[:2]
        rest = text[2:]
    else:
        prefix = ""
        rest = text
    rest = re.sub(r"[\\/]+", lambda _match: os.sep, rest)
    if prefix:
        return prefix + os.sep + rest.lstrip("\\/")
    return rest


def _local_archive_static_generated_path(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    path = parsed.path if parsed.scheme else raw
    marker = "/static/generated/"
    if marker not in path.replace("\\", "/"):
        return None
    filename = os.path.basename(path.replace("\\", "/"))
    if not filename:
        return None
    candidate = Path(Config.GENERATED_FOLDER) / filename
    return candidate if candidate.exists() else None


def _local_archive_safe_existing_file(path_value):
    raw = _local_archive_normalize_path_text(path_value)
    if not raw:
        return None
    try:
        root = Path(_local_archive_normalize_path_text(Config.LOCAL_ARCHIVE_FOLDER)).resolve()
        path = Path(raw).resolve()
        if os.path.commonpath([str(root), str(path)]) != str(root):
            return None
        if not path.is_file():
            return None
        return path
    except Exception:
        return None


def _local_archive_safe_existing_folder(path_value):
    raw = _local_archive_normalize_path_text(path_value)
    if not raw:
        return None
    try:
        root = Path(_local_archive_normalize_path_text(Config.LOCAL_ARCHIVE_FOLDER)).resolve()
        folder = Path(raw).resolve()
        if os.path.commonpath([str(root), str(folder)]) != str(root):
            return None
        if not folder.is_dir():
            return None
        return folder
    except Exception:
        return None


def _local_archive_record_folder(record):
    if not isinstance(record, dict):
        return None
    folder = _local_archive_safe_existing_folder(record.get("folder"))
    if folder:
        return folder
    files = record.get("files") if isinstance(record.get("files"), dict) else {}
    for field in ("imagePath", "htmlPath", "contentPath", "assetPath", "metadataPath"):
        path = _local_archive_safe_existing_file(files.get(field))
        if path:
            return path.parent
    return None


def _local_asset_library_category_for_stage(stage_id):
    stage = str(stage_id or "").strip().lower()
    if stage == "hero":
        return "09_OUTPUT_대표이미지"
    if stage == "size":
        return "11_OUTPUT_사이즈컷"
    if stage == "options":
        return "12_OUTPUT_색상옵션컷"
    if stage == "cuts" or stage.startswith("cuts_"):
        return "10_OUTPUT_이미지컷"
    if stage.startswith("section_") or stage.startswith("detail"):
        return "13_OUTPUT_섹션이미지"
    if stage in {"competitors", "competition"}:
        return "03_OUTPUT_경쟁사후보"
    if stage in {"cafe24", "cafe24_candidates"}:
        return "05_OUTPUT_Cafe24후보"
    if stage in {"db", "sinhwa", "sinhwa_db"}:
        return "07_OUTPUT_신화사DB후보"
    if stage in {"input", "start"}:
        return "01_INPUT_기본이미지"
    return ""


def _local_archive_folder_for_scope(identity, stage_id, scope):
    root = Path(Config.LOCAL_ARCHIVE_FOLDER).resolve()
    requested_scope = str(scope or "").strip().lower()
    if requested_scope not in {"work", "category", "stage"}:
        requested_scope = "work"
    if not _local_archive_scope_is_complete(identity):
        root.mkdir(parents=True, exist_ok=True)
        return root, "root"
    library_identity = LibraryIdentity(
        workspace_id=identity["workspaceId"],
        product_name=str(
            identity.get("productName")
            or identity.get("productKey")
            or "상품명_미지정"
        ).strip(),
        product_key=identity["productKey"],
        input_image_fingerprint=identity["inputImageFingerprint"],
    )
    assets_dir = workfile_library_root(root, library_identity)
    if requested_scope == "work":
        folder = assets_dir
    else:
        category = _local_asset_library_category_for_stage(stage_id)
        folder = assets_dir / category if category else assets_dir
    folder.mkdir(parents=True, exist_ok=True)
    return folder, requested_scope


def _local_archive_open_folder(folder):
    opener = getattr(os, "startfile", None)
    if not callable(opener):
        raise RuntimeError("이 환경에서는 로컬 폴더 열기를 지원하지 않습니다.")
    opener(str(folder))


def _local_archive_image_to_data_url(path_value, mime_value=""):
    path = _local_archive_safe_existing_file(path_value)
    if not path:
        return ""
    mime = str(mime_value or mimetypes.guess_type(str(path))[0] or "image/png")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _local_archive_record_for_response(record):
    if not isinstance(record, dict):
        return {}
    out = dict(record)
    files = out.get("files") if isinstance(out.get("files"), dict) else {}
    archive_id = str(out.get("archiveId") or "").strip()
    image_path = _local_archive_safe_existing_file(files.get("imagePath"))
    if archive_id and image_path:
        out["imageUrl"] = f"/api/local-archive/assets/{quote(archive_id)}/image"
    if str(out.get("stageId") or "").strip() == "options":
        source_map = out.get("sourceMap") if isinstance(out.get("sourceMap"), dict) else {}
        option_result_id = str(source_map.get("optionResultId") or "").strip()
        prompt = ""
        prompt_path = _local_archive_safe_existing_file(files.get("promptPath"))
        if prompt_path:
            prompt = prompt_path.read_text(encoding="utf-8", errors="replace")
        if not option_result_id:
            asset_path = _local_archive_safe_existing_file(files.get("assetPath"))
            asset_manifest = _load_json_file(asset_path) if asset_path else {}
            manifest_source_map = asset_manifest.get("sourceMap") if isinstance(asset_manifest, dict) and isinstance(asset_manifest.get("sourceMap"), dict) else {}
            option_result_id = str(manifest_source_map.get("optionResultId") or "").strip()
            if not prompt and isinstance(asset_manifest, dict):
                prompt = str(asset_manifest.get("prompt") or "")
        if option_result_id:
            out["optionResultId"] = option_result_id
        if prompt:
            out["prompt"] = prompt
    if "assetKind" not in out or "categoryLabel" not in out:
        kind = _local_archive_kind_for_stage(
            out.get("stageId") or "",
            out.get("metadata") if isinstance(out.get("metadata"), dict) else {},
            out.get("sourceMap") if isinstance(out.get("sourceMap"), dict) else {},
            out.get("title") or "",
        )
        out.setdefault("assetKind", kind["assetKind"])
        out.setdefault("category", kind["category"])
        out.setdefault("categoryLabel", kind["categoryLabel"])
        out.setdefault("sectionId", kind["sectionId"])
    return out


def _local_archive_same_asset_record(record, identity, stage_id, content_hash):
    if not content_hash or not isinstance(record, dict):
        return False
    return all([
        str(record.get("contentHash") or "") == str(content_hash),
        str(record.get("stageId") or "") == str(stage_id or ""),
        str(record.get("currentRunId") or "") == str(identity.get("currentRunId") or ""),
        str(record.get("productKey") or "") == str(identity.get("productKey") or ""),
        str(record.get("inputImageFingerprint") or "") == str(identity.get("inputImageFingerprint") or ""),
        str(record.get("workspaceId") or "") == str(identity.get("workspaceId") or ""),
    ])


def _local_archive_asset_identity(asset, body):
    metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
    source_map = asset.get("sourceMap") if isinstance(asset.get("sourceMap"), dict) else {}
    if not source_map and isinstance(asset.get("source_map"), dict):
        source_map = asset.get("source_map")
    product_name = (
        body.get("productName") or asset.get("productName") or
        metadata.get("productName") or source_map.get("productName") or ""
    )
    stage_id = (
        body.get("stageId") or asset.get("stageId") or
        metadata.get("stageId") or source_map.get("stageId") or "asset"
    )
    current_run_id = (
        body.get("currentRunId") or asset.get("currentRunId") or asset.get("generationRunId") or
        metadata.get("currentRunId") or metadata.get("generationRunId") or
        source_map.get("currentRunId") or source_map.get("generationRunId") or ""
    )
    product_key = (
        body.get("productKey") or asset.get("productKey") or
        metadata.get("productKey") or metadata.get("productIdentityKey") or
        source_map.get("productKey") or source_map.get("productIdentityKey") or ""
    )
    input_fingerprint = (
        body.get("inputImageFingerprint") or asset.get("inputImageFingerprint") or
        metadata.get("inputImageFingerprint") or metadata.get("inputImageKey") or metadata.get("sourceImageKey") or
        source_map.get("inputImageFingerprint") or source_map.get("inputImageKey") or source_map.get("sourceImageKey") or ""
    )
    workspace_id = (
        body.get("workspaceId") or asset.get("workspaceId") or asset.get("currentProjectId") or
        metadata.get("workspaceId") or metadata.get("currentProjectId") or
        source_map.get("workspaceId") or source_map.get("currentProjectId") or ""
    )
    return {
        "productName": str(product_name or "").strip(),
        "stageId": str(stage_id or "asset").strip(),
        "currentRunId": str(current_run_id or "").strip(),
        "productKey": str(product_key or "").strip(),
        "inputImageFingerprint": str(input_fingerprint or "").strip(),
        "workspaceId": str(workspace_id or "").strip(),
    }


def _local_archive_competitor_identity_error(asset, body, identity):
    metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
    source_map = asset.get("sourceMap") if isinstance(asset.get("sourceMap"), dict) else {}
    marker_values = [
        body.get("archiveKind"),
        body.get("assetKind"),
        body.get("source"),
        body.get("sourceLabel"),
        asset.get("archiveKind"),
        asset.get("assetKind"),
        asset.get("source"),
        asset.get("sourceLabel"),
        metadata.get("archiveKind"),
        metadata.get("assetKind"),
        metadata.get("source"),
        metadata.get("sourceLabel"),
        source_map.get("archiveKind"),
        source_map.get("assetKind"),
        source_map.get("source"),
        source_map.get("sourceLabel"),
    ]
    declarations = {
        "currentRunId": [
            body.get("currentRunId"),
            asset.get("currentRunId"),
            metadata.get("currentRunId"),
            source_map.get("currentRunId"),
        ],
        "productKey": [
            body.get("productKey"),
            asset.get("productKey"),
            metadata.get("productKey"),
            source_map.get("productKey"),
        ],
        "inputImageFingerprint": [
            body.get("inputImageFingerprint"),
            asset.get("inputImageFingerprint"),
            metadata.get("inputImageFingerprint"),
            source_map.get("inputImageFingerprint"),
        ],
        "stageId": [
            body.get("stageId"),
            asset.get("stageId"),
            metadata.get("stageId"),
            source_map.get("stageId"),
        ],
    }
    stage_values = [str(value or "").strip() for value in declarations["stageId"] if str(value or "").strip()]
    has_competitor_stage = any(value.lower() == "competitors" for value in stage_values)
    has_competitor_marker = any(
        any(token in str(value or "").strip().lower() for token in ("competitor", "경쟁사"))
        for value in marker_values
    )
    has_non_stage_identity = all(
        any(str(value or "").strip() for value in declarations[field])
        for field in ("currentRunId", "productKey", "inputImageFingerprint")
    )
    if not has_competitor_stage and not has_competitor_marker and not (not stage_values and has_non_stage_identity):
        return ""

    missing = []
    for field, values in declarations.items():
        normalized_values = [str(value or "").strip() for value in values if str(value or "").strip()]
        if not normalized_values:
            missing.append(field)
            continue
        if any(value != normalized_values[0] for value in normalized_values[1:]):
            return f"competitor archive identity mismatch: {field}"
        if field == "stageId" and normalized_values[0] != "competitors":
            return "competitor archive identity mismatch: stageId must be competitors"

    if missing:
        return f"competitor archive identity required: {', '.join(missing)}"
    if str(identity.get("stageId") or "").strip() != "competitors":
        return "competitor archive identity mismatch: stageId must be competitors"
    return ""


@api.route("/local-archive/assets", methods=["GET"])
def list_local_archive_assets():
    index = _local_archive_load_index()
    assets = index.get("assets", [])
    product_name = str(request.args.get("productName") or "").strip().lower()
    product_key = str(request.args.get("productKey") or "").strip().lower()
    current_run_id = str(request.args.get("currentRunId") or "").strip().lower()
    input_image_fingerprint = str(request.args.get("inputImageFingerprint") or "").strip().lower()
    workspace_id = str(request.args.get("workspaceId") or "").strip().lower()
    stage_id = str(request.args.get("stageId") or "").strip().lower()
    stage_prefix = str(request.args.get("stagePrefix") or "").strip().lower()
    exclude_stage_ids = {
        item.strip().lower()
        for item in str(request.args.get("excludeStageId") or "").split(",")
        if item.strip()
    }
    if product_name:
        assets = [a for a in assets if product_name in str(a.get("productName") or "").lower()]
    if product_key:
        assets = [a for a in assets if product_key == str(a.get("productKey") or "").lower()]
    if current_run_id:
        assets = [a for a in assets if current_run_id == str(a.get("currentRunId") or "").lower()]
    if input_image_fingerprint:
        assets = [a for a in assets if input_image_fingerprint == str(a.get("inputImageFingerprint") or "").lower()]
    if workspace_id:
        assets = [a for a in assets if workspace_id == str(a.get("workspaceId") or "").lower()]
    if stage_id:
        assets = [a for a in assets if stage_id == str(a.get("stageId") or "").lower()]
    if stage_prefix:
        assets = [a for a in assets if str(a.get("stageId") or "").lower().startswith(stage_prefix)]
    if exclude_stage_ids:
        assets = [a for a in assets if str(a.get("stageId") or "").lower() not in exclude_stage_ids]
    try:
        limit = max(1, min(500, int(request.args.get("limit") or 100)))
    except Exception:
        limit = 100
    assets = sorted(assets, key=lambda item: str(item.get("savedAt") or ""), reverse=True)[:limit]
    return jsonify({
        "ok": True,
        "root": Config.LOCAL_ARCHIVE_FOLDER,
        "indexPath": _LOCAL_ARCHIVE_INDEX_PATH,
        "count": len(assets),
        "assets": [_local_archive_record_for_response(item) for item in assets],
    })


def _local_archive_authority_scope(workspace_id):
    value = re.sub(r"\s+", "", str(workspace_id or "")).strip()
    if not value or value.lower().startswith("draft:"):
        return ""
    while value.lower().startswith("project:"):
        value = value[len("project:"):].strip()
    return f"project:{value}" if value else ""


def _local_archive_authority_error(error):
    if isinstance(error, PreconditionRequired):
        return jsonify({
            "ok": False,
            "code": "PRECONDITION_REQUIRED",
            "error": str(error),
        }), 428
    payload = error.snapshot.as_dict()
    payload.update({"ok": False, "accepted": False, "code": error.code})
    return jsonify(payload), 409


@api.route("/local-archive/workfiles/<workspace_id>/recover-latest", methods=["POST"])
def recover_local_archive_workfile_latest(workspace_id):
    workspace_id = str(workspace_id or "").strip()
    body = request.get_json(silent=True) or {}
    product_key = str(body.get("productKey") or "").strip()
    input_image_fingerprint = str(body.get("inputImageFingerprint") or "").strip()
    missing = [
        field
        for field, value in (
            ("workspaceId", workspace_id),
            ("productKey", product_key),
            ("inputImageFingerprint", input_image_fingerprint),
        )
        if not value
    ]
    if missing:
        return jsonify({
            "ok": False,
            "error": f"작업파일 복원 식별자가 부족합니다: {', '.join(missing)}",
        }), 400

    def mutate_recovery_manifest():
        preferred = body.get("stageRunIds") if isinstance(body.get("stageRunIds"), dict) else {}
        recovered, scopes = _local_archive_latest_stage_records(
            workspace_id,
            product_key,
            input_image_fingerprint,
            preferred,
        )
        for record in recovered:
            _local_archive_append_workfile_manifest(record)
        paths = _local_archive_workfile_paths(workspace_id)
        return recovered, scopes, paths

    authority_scope = _local_archive_authority_scope(
        body.get("authorityWorkspaceId") or workspace_id
    )
    try:
        if authority_scope:
            _, recovery = commit_workspace_replica(
                authority_scope, body, mutate_recovery_manifest
            )
        else:
            recovery = mutate_recovery_manifest()
    except (PreconditionRequired, WorkspaceConflict) as error:
        return _local_archive_authority_error(error)
    records, stage_scopes, (workfile_dir, manifest_path) = recovery
    return jsonify({
        "ok": True,
        "workspaceId": workspace_id,
        "productKey": product_key,
        "inputImageFingerprint": input_image_fingerprint,
        "workfileFolder": str(workfile_dir) if workfile_dir else "",
        "manifestPath": str(manifest_path) if manifest_path else "",
        "root": Config.LOCAL_ARCHIVE_FOLDER,
        "count": len(records),
        "stageScopes": stage_scopes,
        "assets": [_local_archive_record_for_response(record) for record in records],
    })


@api.route("/local-archive/workfiles/<workspace_id>/manifest", methods=["GET"])
def get_local_archive_workfile_manifest(workspace_id):
    workspace_id = str(workspace_id or "").strip()
    scope = {
        "workspaceId": workspace_id,
        "productKey": str(request.args.get("productKey") or "").strip(),
        "currentRunId": str(request.args.get("currentRunId") or "").strip(),
        "inputImageFingerprint": str(request.args.get("inputImageFingerprint") or "").strip(),
    }
    missing = [field for field, value in scope.items() if not value]
    if missing:
        return jsonify({
            "ok": False,
            "error": f"작업파일 원본 복원 식별자가 부족합니다: {', '.join(missing)}",
        }), 400

    workfile_dir, manifest_path = _local_archive_workfile_paths(workspace_id)
    if not workfile_dir or not manifest_path:
        return jsonify({"ok": False, "error": "작업파일 폴더를 계산하지 못했습니다."}), 400

    manifest = _load_json_file(str(manifest_path))
    if not isinstance(manifest, dict):
        return jsonify({
            "ok": True,
            "hasManifest": False,
            "workspaceId": workspace_id,
            "workfileFolder": str(workfile_dir),
            "manifestPath": str(manifest_path),
            "count": 0,
            "assets": [],
        })
    if str(manifest.get("workspaceId") or "").strip() != workspace_id:
        return jsonify({"ok": False, "error": "작업파일 매니페스트 workspaceId가 일치하지 않습니다."}), 409

    requested_stage_id = str(request.args.get("stageId") or "").strip()
    records = manifest.get("assets") if isinstance(manifest.get("assets"), list) else []
    assets = [
        record for record in records
        if isinstance(record, dict)
        and _local_archive_manifest_matches_scope(record, scope)
        and (not requested_stage_id or str(record.get("stageId") or "").strip() == requested_stage_id)
    ]
    assets = sorted(assets, key=lambda item: str(item.get("savedAt") or ""), reverse=True)
    return jsonify({
        "ok": True,
        "hasManifest": True,
        "workspaceId": workspace_id,
        "workfileFolder": str(workfile_dir),
        "manifestPath": str(manifest_path),
        "updatedAt": manifest.get("updatedAt") or "",
        "count": len(assets),
        "assets": [_local_archive_record_for_response(item) for item in assets],
    })


@api.route("/local-archive/assets/<archive_id>/image", methods=["GET"])
def get_local_archive_asset_image(archive_id):
    archive_id = str(archive_id or "").strip()
    if not archive_id:
        return jsonify({"ok": False, "error": "archive_id가 필요합니다."}), 400
    index = _local_archive_load_index()
    record = next((item for item in index.get("assets", []) if str(item.get("archiveId") or "") == archive_id), None)
    if not record:
        return jsonify({"ok": False, "error": "로컬 보관 자산을 찾지 못했습니다."}), 404
    files = record.get("files") if isinstance(record.get("files"), dict) else {}
    image_path = _local_archive_safe_existing_file(files.get("imagePath"))
    if not image_path:
        return jsonify({"ok": False, "error": "이미지 파일을 찾지 못했습니다."}), 404
    mime = str(files.get("imageMime") or mimetypes.guess_type(str(image_path))[0] or "image/png")
    return send_file(str(image_path), mimetype=mime, conditional=True, max_age=3600)


@api.route("/local-archive/source-image", methods=["GET"])
def get_local_archive_source_image():
    source = str(request.args.get("source") or "").strip()
    if not source:
        return jsonify({"ok": False, "error": "source가 필요합니다."}), 422
    index = _local_archive_load_index()
    records = index.get("assets") if isinstance(index.get("assets"), list) else []
    content = _local_asset_fetch_sync_reference(source, records)
    if content is None:
        return jsonify({"ok": False, "error": "허용된 로컬 이미지를 찾지 못했습니다."}), 404
    mime, raw = content
    response = Response(raw, mimetype=mime)
    response.headers["Cache-Control"] = "private, max-age=60"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@api.route("/local-archive/assets/<archive_id>", methods=["GET"])
def get_local_archive_asset(archive_id):
    archive_id = str(archive_id or "").strip()
    if not archive_id:
        return jsonify({"ok": False, "error": "archive_id가 필요합니다."}), 400
    index = _local_archive_load_index()
    record = next((item for item in index.get("assets", []) if str(item.get("archiveId") or "") == archive_id), None)
    if not record:
        return jsonify({"ok": False, "error": "로컬 보관 자산을 찾지 못했습니다."}), 404
    files = record.get("files") if isinstance(record.get("files"), dict) else {}
    asset = {}
    asset_path = _local_archive_safe_existing_file(files.get("assetPath"))
    if asset_path:
        asset = _load_json_file(str(asset_path)) or {}
    image_data_url = _local_archive_image_to_data_url(files.get("imagePath"), files.get("imageMime"))
    html = ""
    html_path = _local_archive_safe_existing_file(files.get("htmlPath"))
    if html_path:
        html = html_path.read_text(encoding="utf-8", errors="replace")
    metadata = {}
    metadata_path = _local_archive_safe_existing_file(files.get("metadataPath"))
    if metadata_path:
        metadata = _load_json_file(str(metadata_path)) or {}
    return jsonify({
        "ok": True,
        "record": _local_archive_record_for_response(record),
        "asset": asset,
        "imageDataUrl": image_data_url,
        "html": html,
        "metadata": metadata,
        "root": Config.LOCAL_ARCHIVE_FOLDER,
        "indexPath": _LOCAL_ARCHIVE_INDEX_PATH,
    })


@api.route("/local-archive/folders/open", methods=["POST"])
def open_local_archive_folder():
    body = request.get_json(silent=True) or {}
    archive_id = str(body.get("archiveId") or "").strip()
    root = Path(Config.LOCAL_ARCHIVE_FOLDER).resolve()
    if archive_id:
        index = _local_archive_load_index()
        record = next((item for item in index.get("assets", []) if str(item.get("archiveId") or "") == archive_id), None)
        if not record:
            return jsonify({"ok": False, "error": "로컬 보관 자산을 찾지 못했습니다."}), 404
        folder = _local_archive_record_folder(record)
        if not folder:
            return jsonify({"ok": False, "error": "로컬 보관 자산 폴더를 찾지 못했습니다."}), 404
        resolved_scope = "asset"
    else:
        identity = _local_archive_asset_identity({}, body)
        stage_id = str(body.get("stageId") or identity.get("stageId") or "").strip()
        snapshot = _local_asset_library_snapshot_for_workspace(identity.get("workspaceId"))
        try:
            _organize_local_asset_library(snapshot, identity, download_remote=True)
        except OSError as error:
            return jsonify({
                "ok": False,
                "error": f"작업파일 이미지 자료함을 정리하지 못했습니다: {error}",
            }), 500
        folder, resolved_scope = _local_archive_folder_for_scope(
            identity,
            stage_id,
            body.get("scope"),
        )
    try:
        _local_archive_open_folder(folder)
    except Exception as error:
        return jsonify({"ok": False, "error": f"로컬 저장 폴더를 열지 못했습니다: {error}"}), 503
    try:
        relative_path = folder.resolve().relative_to(root).as_posix() or "."
    except ValueError:
        return jsonify({"ok": False, "error": "로컬 보관 폴더 범위를 확인하지 못했습니다."}), 500
    return jsonify({
        "ok": True,
        "archiveId": archive_id,
        "scope": resolved_scope,
        "relativePath": relative_path,
    })


@api.route("/local-archive/assets", methods=["POST"])
def save_local_archive_asset():
    body = request.get_json(silent=True) or {}
    asset = body.get("asset") if isinstance(body.get("asset"), dict) else body
    workspace_id = str(
        body.get("workspaceId")
        or asset.get("workspaceId")
        or asset.get("currentProjectId")
        or ""
    ).strip()
    authority_scope = _local_archive_authority_scope(
        body.get("authorityWorkspaceId") or workspace_id
    )

    def mutate_archive():
        with _LOCAL_ARCHIVE_LOCK:
            return _save_local_archive_asset_locked()

    try:
        if authority_scope:
            _, response = commit_workspace_replica(authority_scope, body, mutate_archive)
            return response
        return mutate_archive()
    except (PreconditionRequired, WorkspaceConflict) as error:
        return _local_archive_authority_error(error)


def _save_local_archive_asset_locked():
    body = request.get_json(silent=True) or {}
    asset = body.get("asset") if isinstance(body.get("asset"), dict) else body
    if not isinstance(asset, dict):
        return jsonify({"ok": False, "error": "asset must be an object"}), 400

    identity = _local_archive_asset_identity(asset, body)
    identity_error = _local_archive_competitor_identity_error(asset, body, identity)
    if identity_error:
        return jsonify({"ok": False, "error": identity_error}), 400
    product_name = identity["productName"] or identity["productKey"] or "상품명_미지정"
    stage_id = identity["stageId"] or "asset"
    asset_id = str(asset.get("id") or body.get("assetId") or uuid.uuid4().hex[:12])
    title = str(asset.get("title") or body.get("title") or stage_id or asset_id)
    created_at_ms = asset.get("createdAt") or body.get("createdAt") or int(time.time() * 1000)
    try:
        created_dt = datetime.fromtimestamp(float(created_at_ms) / 1000)
    except Exception:
        created_dt = datetime.now()
    metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
    source_map = asset.get("sourceMap") if isinstance(asset.get("sourceMap"), dict) else {}
    content = asset.get("content") if isinstance(asset.get("content"), dict) else body.get("content")
    kind = _local_archive_kind_for_stage(stage_id, metadata, source_map, title)

    item_name = f"{created_dt.strftime('%H%M%S')}_{_local_archive_safe_name(title, 'asset', 52)}_{_local_archive_safe_name(asset_id, 'id', 18)}"
    item_dir = _local_archive_item_directory(identity, created_dt, kind["category"], stage_id, item_name)

    files = {}
    content_hash = ""
    image_value = asset.get("image") or asset.get("dataUrl") or asset.get("result") or body.get("image")
    decoded = None
    generated_path = None
    if isinstance(image_value, str) and image_value.strip():
        try:
            decoded = _local_archive_decode_data_url(image_value)
        except Exception:
            decoded = None
        if decoded:
            mime, raw = decoded
            content_hash = hashlib.sha1(raw).hexdigest()
        else:
            generated_path = _local_archive_static_generated_path(image_value)
            if generated_path:
                try:
                    content_hash = hashlib.sha1(generated_path.read_bytes()).hexdigest()
                except Exception:
                    content_hash = ""

    html_value = asset.get("html") or body.get("html")
    if not content_hash and isinstance(html_value, str) and html_value.strip():
        content_hash = hashlib.sha1(html_value.encode("utf-8", errors="ignore")).hexdigest()

    index = _local_archive_load_index()
    duplicate = next((
        item for item in index.get("assets", [])
        if _local_archive_same_asset_record(item, identity, stage_id, content_hash)
    ), None)
    if duplicate:
        _local_archive_append_workfile_manifest(duplicate)
        _local_archive_write_index(index)
        return jsonify({
            "ok": True,
            "deduped": True,
            "archive": _local_archive_record_for_response(duplicate),
            "root": Config.LOCAL_ARCHIVE_FOLDER,
            "indexPath": _LOCAL_ARCHIVE_INDEX_PATH,
        })

    if item_dir.exists():
        item_dir = Path(f"{item_dir}_{uuid.uuid4().hex[:6]}")
    item_dir.mkdir(parents=True, exist_ok=True)

    if isinstance(image_value, str) and image_value.strip():
        if decoded:
            mime, raw = decoded
            ext = _local_archive_ext_for_mime(mime, "bin")
            image_path = item_dir / f"image.{ext}"
            image_path.write_bytes(raw)
            files["imagePath"] = str(image_path)
            files["imageMime"] = mime
            files["imageBytes"] = len(raw)
        elif generated_path:
            ext = generated_path.suffix.lstrip(".") or "img"
            image_path = item_dir / f"image.{ext}"
            shutil.copyfile(generated_path, image_path)
            files["imagePath"] = str(image_path)
            files["imageMime"] = mimetypes.guess_type(str(image_path))[0] or "image/*"
            files["imageBytes"] = image_path.stat().st_size
        else:
            ref_path = item_dir / "image-ref.txt"
            ref_path.write_text(image_value, encoding="utf-8")
            files["imageRefPath"] = str(ref_path)

    if isinstance(html_value, str) and html_value.strip():
        html_path = item_dir / "detail.html"
        html_path.write_text(html_value, encoding="utf-8")
        files["htmlPath"] = str(html_path)
        files["htmlBytes"] = html_path.stat().st_size

    prompt_value = asset.get("prompt") or body.get("prompt") or ""
    prompt_path = item_dir / "prompt.txt"
    prompt_path.write_text(str(prompt_value or ""), encoding="utf-8")
    files["promptPath"] = str(prompt_path)

    metadata_path = item_dir / "metadata.json"
    metadata_path.write_text(json.dumps({
        "identity": identity,
        "assetKind": kind["assetKind"],
        "category": kind["category"],
        "categoryLabel": kind["categoryLabel"],
        "sectionId": kind["sectionId"],
        "metadata": metadata,
        "sourceMap": source_map,
        "content": content if isinstance(content, dict) else None,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    files["metadataPath"] = str(metadata_path)

    stored_asset = {
        key: value for key, value in asset.items()
        if key not in {"image", "dataUrl", "result", "html"}
    }
    stored_asset["localFiles"] = files
    stored_asset["assetKind"] = kind["assetKind"]
    stored_asset["category"] = kind["category"]
    stored_asset["categoryLabel"] = kind["categoryLabel"]
    stored_asset["sectionId"] = kind["sectionId"]
    stored_asset["contentHash"] = content_hash
    asset_path = item_dir / "asset.json"
    asset_path.write_text(json.dumps(stored_asset, ensure_ascii=False, indent=2), encoding="utf-8")
    files["assetPath"] = str(asset_path)

    archive_id_source = "|".join([
        asset_id,
        identity["workspaceId"],
        identity["currentRunId"],
        identity["productKey"],
        identity["inputImageFingerprint"],
        stage_id,
        str(time.time_ns()),
    ])
    archive_id = hashlib.sha1(archive_id_source.encode("utf-8", errors="ignore")).hexdigest()[:16]
    record = {
        "archiveId": archive_id,
        "assetId": asset_id,
        "title": title,
        "type": asset.get("type") or ("image" if files.get("imagePath") else "record"),
        "stageId": stage_id,
        "workspaceId": identity["workspaceId"],
        "productName": product_name,
        "productKey": identity["productKey"],
        "currentRunId": identity["currentRunId"],
        "inputImageFingerprint": identity["inputImageFingerprint"],
        "contentHash": content_hash,
        "assetKind": kind["assetKind"],
        "category": kind["category"],
        "categoryLabel": kind["categoryLabel"],
        "sectionId": kind["sectionId"],
        "folder": str(item_dir),
        "files": files,
        "savedAt": datetime.now().isoformat(timespec="seconds"),
        "createdAt": created_dt.isoformat(timespec="seconds"),
        "reason": body.get("reason") or asset.get("reason") or "",
        "origin": body.get("origin") or "",
        "sourceLabel": source_map.get("source") or metadata.get("source") or body.get("reason") or asset.get("source") or "",
        "sourceArchiveId": source_map.get("sourceArchiveId") or metadata.get("sourceArchiveId") or "",
        "sourceFiles": source_map.get("sourceFiles") or metadata.get("sourceFiles") or body.get("sourceFiles") or {},
        "parentAssetIds": asset.get("parentAssetIds") if isinstance(asset.get("parentAssetIds"), list) else [],
    }
    _local_archive_append_workfile_manifest(record)
    index["assets"] = [record, *index.get("assets", [])][:5000]
    _local_archive_write_index(index)

    return jsonify({
        "ok": True,
        "archive": record,
        "root": Config.LOCAL_ARCHIVE_FOLDER,
        "indexPath": _LOCAL_ARCHIVE_INDEX_PATH,
    })


# ── MarketPlus / Browser Automation Diagnostics ────────────────

def _safe_browser_tab_url(raw_url):
    """Return a browser tab URL without query/fragment tokens."""
    text = str(raw_url or "").strip()
    if not text:
        return ""
    try:
        parsed = urlparse(text)
        if not parsed.scheme or not parsed.netloc:
            return text[:300]
        path = parsed.path or ""
        return f"{parsed.scheme}://{parsed.netloc}{path}"[:300]
    except Exception:
        return text[:300]


def _marketplus_allowed_open_url(raw_url):
    text = str(raw_url or "").strip()
    if not text:
        text = "https://eclogin.cafe24.com/Shop/"
    try:
        parsed = urlparse(text)
    except Exception:
        raise ValueError("Cafe24 관리자 URL 형식이 올바르지 않습니다.")
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Cafe24 관리자 URL은 http/https만 열 수 있습니다.")
    host = (parsed.hostname or "").lower()
    allowed_hosts = (
        host == "eclogin.cafe24.com"
        or host.endswith(".cafe24.com")
        or host.endswith(".cafe24api.com")
        or host.endswith(".echosting.cafe24.com")
        or "marketplus" in host
    )
    allowed_path = any(keyword in text.lower() for keyword in [
        "cafe24",
        "eclogin",
        "echosting",
        "marketplus",
    ])
    if not (allowed_hosts and allowed_path):
        raise ValueError("Cafe24/마켓플러스 관리자 URL만 열 수 있습니다.")
    return text


def _tab_url_parts(tab):
    try:
        parsed = urlparse(str((tab or {}).get("url") or ""))
        return (parsed.hostname or "").lower(), (parsed.path or "").lower()
    except Exception:
        return "", ""


def _is_cafe24_tab(tab):
    host, path = _tab_url_parts(tab)
    if not host:
        return False
    return (
        host == "eclogin.cafe24.com"
        or host.endswith(".cafe24.com")
        or host.endswith(".cafe24api.com")
        or host.endswith(".echosting.cafe24.com")
        or "cafe24" in host
        or "echosting" in host
    )


def _is_google_account_tab(tab):
    host, path = _tab_url_parts(tab)
    title = str((tab or {}).get("title") or "").lower()
    haystack = f"{title} {host} {path}"
    return (
        host == "accounts.google.com"
        or host.endswith(".google.com")
    ) and any(keyword in haystack for keyword in [
        "signin",
        "accountchooser",
        "oauth",
        "로그인",
        "계정",
    ])


def _is_marketplus_tab(tab):
    title = str(tab.get("title") or "").lower()
    host, path = _tab_url_parts(tab)
    if not _is_cafe24_tab(tab):
        return False
    haystack = f"{title} {host} {path}"
    if host == "mp.cafe24.com" or path.startswith("/mp/"):
        return True
    if any(keyword in haystack for keyword in [
        "marketplus",
        "market plus",
        "마켓플러스",
    ]):
        return True
    return any(keyword in haystack for keyword in [
        "상품보내기",
        "상품 보내기",
        "판매채널",
        "판매 채널",
        "오픈마켓",
        "외부마켓",
        "마켓상품",
        "마켓 상품",
    ])


def _is_cafe24_login_tab(tab):
    title = str((tab or {}).get("title") or "").lower()
    host, path = _tab_url_parts(tab)
    if not _is_cafe24_tab(tab):
        return False
    if host == "eclogin.cafe24.com":
        return True
    haystack = f"{title} {host} {path}"
    return any(keyword in haystack for keyword in [
        "login",
        "로그인",
        "auth",
        "signin",
    ])


def _is_cafe24_admin_tab(tab):
    return _is_cafe24_tab(tab) and not _is_cafe24_login_tab(tab)


def _marketplus_tab_stage(tab):
    if _is_google_account_tab(tab):
        return "google_account_login"
    if _is_marketplus_tab(tab):
        return "marketplus"
    if _is_cafe24_login_tab(tab):
        return "cafe24_login"
    if _is_cafe24_admin_tab(tab):
        return "cafe24_admin"
    if _is_cafe24_tab(tab):
        return "cafe24"
    return "other"


def _safe_chrome_tab(tab):
    return {
        "id": str(tab.get("id") or "")[:80],
        "type": str(tab.get("type") or "")[:40],
        "title": str(tab.get("title") or "")[:180],
        "url": _safe_browser_tab_url(tab.get("url")),
        "isCafe24": _is_cafe24_tab(tab),
        "isCafe24Login": _is_cafe24_login_tab(tab),
        "isCafe24Admin": _is_cafe24_admin_tab(tab),
        "isMarketPlus": _is_marketplus_tab(tab),
        "isGoogleAccountLogin": _is_google_account_tab(tab),
        "stage": _marketplus_tab_stage(tab),
    }


def _load_chrome_debug_tabs(port=9224):
    port = max(1, min(65535, int(port or 9224)))
    bases = [f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"]
    last_error = ""
    for base in bases:
        try:
            tabs_res = requests.get(f"{base}/json/list", timeout=2.5)
            tabs_res.raise_for_status()
            raw_tabs = tabs_res.json()
            if not isinstance(raw_tabs, list):
                raw_tabs = []
            version = {}
            try:
                version_res = requests.get(f"{base}/json/version", timeout=2)
                if version_res.ok:
                    version = version_res.json()
            except Exception:
                version = {}
            safe_tabs = []
            for tab in raw_tabs:
                if not isinstance(tab, dict):
                    continue
                safe_tabs.append(_safe_chrome_tab(tab))
            return {
                "ok": True,
                "port": port,
                "base": base,
                "version": version,
                "rawTabs": raw_tabs,
                "safeTabs": safe_tabs,
            }
        except Exception as e:
            last_error = str(e)
    raise RuntimeError(last_error or "Chrome debug port is not reachable")


def _chrome_debug_open_tab(port=9224, target_url="https://eclogin.cafe24.com/Shop/"):
    port = max(1, min(65535, int(port or 9224)))
    target_url = _marketplus_allowed_open_url(target_url)
    encoded_url = quote(target_url, safe="")
    bases = [f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"]
    last_error = ""
    for base in bases:
        for method in ("put", "get"):
            try:
                req = getattr(requests, method)
                res = req(f"{base}/json/new?{encoded_url}", timeout=3)
                if res.status_code == 405:
                    last_error = "Chrome /json/new method not allowed"
                    continue
                res.raise_for_status()
                tab = res.json() if res.text.strip() else {}
                return {
                    "ok": True,
                    "base": base,
                    "port": port,
                    "targetUrl": _safe_browser_tab_url(target_url),
                    "tab": tab if isinstance(tab, dict) else {},
                }
            except Exception as e:
                last_error = str(e)
    raise RuntimeError(last_error or "Chrome debug tab open failed")


def _chrome_debug_close_tab(base, target_id):
    target_id = str(target_id or "").strip()
    if not base or not target_id:
        raise RuntimeError("Chrome tab id is missing")
    encoded_id = quote(target_id, safe="")
    last_error = ""
    for method in ("get", "put"):
        try:
            req = getattr(requests, method)
            res = req(f"{base}/json/close/{encoded_id}", timeout=2)
            if res.status_code == 405:
                last_error = "Chrome /json/close method not allowed"
                continue
            res.raise_for_status()
            return True
        except Exception as e:
            last_error = str(e)
    raise RuntimeError(last_error or "Chrome debug tab close failed")


def _close_google_account_tabs(loaded):
    base = loaded.get("base") or ""
    closed = []
    failed = []
    for tab in loaded.get("rawTabs") or []:
        if not isinstance(tab, dict) or not _is_google_account_tab(tab):
            continue
        target_id = str(tab.get("id") or "").strip()
        safe_tab = _safe_chrome_tab(tab)
        if not target_id:
            failed.append({
                "tab": safe_tab,
                "error": "Chrome tab id is missing",
            })
            continue
        try:
            _chrome_debug_close_tab(base, target_id)
            closed.append(safe_tab)
        except Exception as e:
            failed.append({
                "tab": safe_tab,
                "error": str(e),
            })
    if closed:
        time.sleep(0.25)
    return {
        "closed": closed,
        "failed": failed,
    }


def _find_chrome_executable():
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LocalAppData", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return "chrome.exe"


def _launch_chrome_debug(port=9224, target_url="https://eclogin.cafe24.com/Shop/"):
    port = max(1, min(65535, int(port or 9224)))
    target_url = _marketplus_allowed_open_url(target_url)
    user_data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".local", "chrome-marketplus-debug"))
    os.makedirs(user_data_dir, exist_ok=True)
    chrome_path = _find_chrome_executable()
    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        target_url,
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    last_error = ""
    for _ in range(20):
        try:
            loaded = _load_chrome_debug_tabs(port)
            return {
                "ok": True,
                "port": port,
                "pid": proc.pid,
                "chromePath": chrome_path,
                "userDataDir": user_data_dir,
                "targetUrl": _safe_browser_tab_url(target_url),
                "loaded": loaded,
            }
        except Exception as e:
            last_error = str(e)
            time.sleep(0.25)
    return {
        "ok": False,
        "port": port,
        "pid": proc.pid,
        "chromePath": chrome_path,
        "userDataDir": user_data_dir,
        "targetUrl": _safe_browser_tab_url(target_url),
        "error": last_error or "Chrome debug port did not become ready",
    }


def _open_url_in_normal_browser(target_url="https://eclogin.cafe24.com/Shop/"):
    target_url = _marketplus_allowed_open_url(target_url)
    if os.name == "nt":
        os.startfile(target_url)  # noqa: S606 - user-approved local browser handoff
    else:
        subprocess.Popen(["xdg-open", target_url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {
        "ok": True,
        "targetUrl": _safe_browser_tab_url(target_url),
    }


def _marketplus_pick_tab(raw_tabs, target="auto"):
    tabs = [tab for tab in (raw_tabs or []) if isinstance(tab, dict) and tab.get("webSocketDebuggerUrl")]
    if target == "marketplus":
        preferred = [tab for tab in tabs if _is_marketplus_tab(tab)]
    elif target == "cafe24":
        preferred = [tab for tab in tabs if _is_cafe24_admin_tab(tab)]
        if not preferred:
            preferred = [tab for tab in tabs if _is_cafe24_login_tab(tab)]
        if not preferred:
            preferred = [tab for tab in tabs if _is_cafe24_tab(tab)]
    else:
        preferred = [tab for tab in tabs if _is_marketplus_tab(tab)]
        if not preferred:
            preferred = [tab for tab in tabs if _is_cafe24_admin_tab(tab)]
        if not preferred:
            preferred = [tab for tab in tabs if _is_cafe24_login_tab(tab)]
        if not preferred:
            preferred = [tab for tab in tabs if _is_cafe24_tab(tab)]
    return preferred[0] if preferred else None


def _marketplus_pick_product_detail_tab(raw_tabs, fallback_target="marketplus"):
    tabs = [tab for tab in (raw_tabs or []) if isinstance(tab, dict) and tab.get("webSocketDebuggerUrl")]
    candidates = [tab for tab in tabs if _is_marketplus_tab(tab)]
    detail_tabs = [
        tab for tab in candidates
        if "/mp/product/front/detail" in str(tab.get("url") or "").lower()
    ]
    return detail_tabs[0] if detail_tabs else _marketplus_pick_tab(raw_tabs, fallback_target)


def _chrome_tab_timeout_response(port, tab, surface_label, action_label):
    safe_tab = _safe_chrome_tab(tab) if isinstance(tab, dict) else {}
    return jsonify({
        "ok": False,
        "connected": True,
        "debugPort": port,
        "reason": "browser_tab_unresponsive",
        "stage": "browser_tab_unresponsive",
        "tab": safe_tab,
        "note": f"{surface_label} {action_label} 탭이 열려 있지만 Chrome DevTools 평가에 응답하지 않습니다. 해당 탭을 새로고침하거나 닫고 필요한 화면을 다시 연 뒤 재시도하세요.",
        "requiredNextSteps": [
            f"현재 {surface_label} {action_label} 탭을 새로고침합니다.",
            "그래도 멈추면 해당 탭을 닫고 Cafe24 상품목록 또는 마켓플러스 상품관리에서 대상 상품을 다시 엽니다.",
            "방울수저집test 행에 5개 마켓 아이콘이 뜨는지는 Cafe24 상품목록 연동상태로 확인합니다.",
        ],
    })


def _chrome_debug_timeout_response(port, surface_label):
    return jsonify({
        "ok": False,
        "connected": False,
        "debugPort": port,
        "reason": "chrome_debug_unresponsive",
        "stage": "chrome_debug_unresponsive",
        "note": f"{surface_label} 확인 중 Chrome 디버그 포트가 응답하지 않습니다. 브라우저가 멈춘 상태일 수 있으니 Cafe24/마켓플러스 탭을 새로고침하거나 Chrome 디버그 브라우저를 다시 열어주세요.",
        "requiredNextSteps": [
            "현재 Cafe24/마켓플러스 탭을 새로고침합니다.",
            "그래도 응답이 없으면 멈춘 탭을 닫고 필요한 화면을 다시 엽니다.",
            "그 다음 방울수저집test 행의 5개 마켓 연동 표시를 다시 확인합니다.",
        ],
    })


def _marketplus_tab_timeout_response(port, tab, action_label):
    return _chrome_tab_timeout_response(port, tab, "마켓플러스", action_label)


def _marketplus_pick_cafe24_product_list_tab(raw_tabs):
    tabs = [tab for tab in (raw_tabs or []) if isinstance(tab, dict) and tab.get("webSocketDebuggerUrl")]
    product_list_tabs = [
        tab for tab in tabs
        if _is_cafe24_admin_tab(tab)
        and "ProductBatchManage" in str(tab.get("url") or "")
    ]
    if product_list_tabs:
        return product_list_tabs[0]
    product_admin_tabs = [
        tab for tab in tabs
        if _is_cafe24_admin_tab(tab)
        and re.search(r"product|상품", " ".join([str(tab.get("title") or ""), str(tab.get("url") or "")]), re.I)
    ]
    return product_admin_tabs[0] if product_admin_tabs else None


def _activate_chrome_debug_tab(port, tab):
    try:
        tab_id = str((tab or {}).get("id") or "").strip()
        if not tab_id:
            return False
        for base in [f"http://127.0.0.1:{int(port)}", f"http://localhost:{int(port)}", f"http://[::1]:{int(port)}"]:
            try:
                response = requests.get(f"{base}/json/activate/{quote(tab_id, safe='')}", timeout=2)
                if response.ok:
                    return True
            except Exception:
                continue
        return False
    except Exception:
        return False


def _cdp_ws_parts(ws_url):
    parsed = urlparse(str(ws_url or "").strip())
    if parsed.scheme != "ws":
        raise ValueError("Chrome DevTools ws URL만 지원합니다.")
    host = parsed.hostname or ""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("로컬 Chrome 디버그 포트만 읽을 수 있습니다.")
    port = int(parsed.port or 80)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    return host, port, path


def _cdp_local_host_candidates(host):
    raw = str(host or "").strip().strip("[]").lower()
    if raw not in {"127.0.0.1", "localhost", "::1"}:
        return []
    if raw == "localhost":
        candidates = ["::1", "127.0.0.1", "localhost"]
    elif raw == "127.0.0.1":
        candidates = ["127.0.0.1", "::1", "localhost"]
    else:
        candidates = ["::1", "127.0.0.1", "localhost"]
    seen = set()
    ordered = []
    for item in candidates:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def _cdp_ws_host_header(host, port):
    raw = str(host or "").strip().strip("[]")
    if ":" in raw:
        return f"[{raw}]:{int(port)}"
    return f"{raw}:{int(port)}"


def _cdp_open_local_socket(host, port, timeout):
    candidates = _cdp_local_host_candidates(host)
    if not candidates:
        raise ValueError("로컬 Chrome 디버그 포트만 읽을 수 있습니다.")
    per_attempt = max(0.5, min(float(timeout or 5), 1.5))
    errors = []
    for candidate in candidates:
        try:
            sock = socket.create_connection((candidate, int(port)), timeout=per_attempt)
            return sock, candidate
        except Exception as e:
            errors.append(f"{candidate}:{int(port)} {type(e).__name__}: {e}")
    raise RuntimeError("Chrome DevTools WebSocket 연결 실패: " + " / ".join(errors[-3:]))


def _ws_recv_exact(sock, size):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("Chrome DevTools WebSocket 연결이 끊겼습니다.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _ws_send_text(sock, payload):
    body = payload.encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])
    length = len(body)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.extend([0x80 | 126])
        header.extend(struct.pack("!H", length))
    else:
        header.extend([0x80 | 127])
        header.extend(struct.pack("!Q", length))
    masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(body))
    sock.sendall(bytes(header) + mask + masked)


def _ws_read_text(sock):
    fragments = []
    while True:
        first_two = _ws_recv_exact(sock, 2)
        first, second = first_two[0], first_two[1]
        fin = bool(first & 0x80)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", _ws_recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", _ws_recv_exact(sock, 8))[0]
        mask = _ws_recv_exact(sock, 4) if masked else b""
        payload = _ws_recv_exact(sock, length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        if opcode == 0x8:
            raise RuntimeError("Chrome DevTools WebSocket이 종료되었습니다.")
        if opcode in (0x1, 0x0):
            fragments.append(payload)
            if fin:
                return b"".join(fragments).decode("utf-8", errors="replace")


def _cdp_runtime_evaluate(ws_url, expression, timeout=5):
    host, port, path = _cdp_ws_parts(ws_url)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    sock, connected_host = _cdp_open_local_socket(host, port, timeout)
    try:
        sock.settimeout(timeout)
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {_cdp_ws_host_header(connected_host, port)}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(req.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            response += sock.recv(4096)
            if len(response) > 32768:
                break
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("Chrome DevTools WebSocket 핸드셰이크 실패")
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest())
        if expected not in response:
            raise RuntimeError("Chrome DevTools WebSocket 검증 실패")
        message_id = 1
        _ws_send_text(sock, json.dumps({
            "id": message_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": False,
                "timeout": int(timeout * 1000),
            },
        }, ensure_ascii=False))
        for _ in range(40):
            msg = json.loads(_ws_read_text(sock))
            if msg.get("id") == message_id:
                if msg.get("error"):
                    raise RuntimeError(str(msg["error"]))
                result = msg.get("result", {}).get("result", {})
                if result.get("subtype") == "error":
                    raise RuntimeError(str(result.get("description") or "Runtime.evaluate error"))
                return result.get("value")
        raise RuntimeError("Chrome DevTools 응답 대기 시간이 초과되었습니다.")
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _redact_marketplus_debug_text(value, limit=1800):
    text = str(value or "")
    if not text:
        return ""
    text = re.sub(r"(?i)(access_token|refresh_token|token|auth|authorization|password|passwd|client_secret|secret|key)=([^&\s]+)", r"\1=[redacted]", text)
    text = re.sub(r"(?i)(access_token|refresh_token|token|auth|authorization|password|passwd|client_secret|secret|key)([\"']?\s*[:=]\s*[\"']?)([^\"'&\s,}]+)", r"\1\2[redacted]", text)
    if len(text) > limit:
        return text[:limit] + "..."
    return text


def _marketplus_debug_url(value):
    text = _redact_marketplus_debug_text(value, 2200)
    if not text:
        return ""
    try:
        parsed = urlparse(text)
        if parsed.scheme and parsed.netloc:
            return parsed._replace(fragment="").geturl()
    except Exception:
        pass
    return text


def _cdp_runtime_evaluate_with_network(ws_url, expression, timeout=10, event_window=5):
    """Evaluate JS and collect sanitized network events from the same tab.

    This is a probe helper for reverse-engineering the MarketPlus UI flow. It
    intentionally returns request/response metadata only and redacts token-like
    values before anything reaches the app log.
    """
    host, port, path = _cdp_ws_parts(ws_url)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    sock, connected_host = _cdp_open_local_socket(host, port, timeout)
    try:
        sock.settimeout(timeout)
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {_cdp_ws_host_header(connected_host, port)}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(req.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            response += sock.recv(4096)
            if len(response) > 32768:
                break
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("Chrome DevTools WebSocket 핸드셰이크 실패")
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest())
        if expected not in response:
            raise RuntimeError("Chrome DevTools WebSocket 검증 실패")

        next_id = 1

        def send(method, params=None):
            nonlocal next_id
            msg_id = next_id
            next_id += 1
            _ws_send_text(sock, json.dumps({
                "id": msg_id,
                "method": method,
                "params": params or {},
            }, ensure_ascii=False))
            return msg_id

        send("Network.enable")
        send("Page.enable")
        eval_id = send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": False,
            "timeout": int(timeout * 1000),
        })
        deadline = time.time() + max(1.0, float(event_window or 5))
        eval_value = None
        eval_error = None
        requests_seen = {}
        requests_out = []
        responses_out = []
        page_events = []
        old_timeout = sock.gettimeout()
        sock.settimeout(0.8)
        while time.time() < deadline:
            try:
                msg = json.loads(_ws_read_text(sock))
            except socket.timeout:
                continue
            except TimeoutError:
                continue
            except Exception:
                break
            if msg.get("id") == eval_id:
                if msg.get("error"):
                    eval_error = str(msg.get("error"))
                    continue
                result = msg.get("result", {}).get("result", {})
                if result.get("subtype") == "error":
                    eval_error = str(result.get("description") or "Runtime.evaluate error")
                else:
                    eval_value = result.get("value")
                continue
            method = msg.get("method")
            params = msg.get("params") or {}
            if method == "Network.requestWillBeSent":
                request = params.get("request") or {}
                url = str(request.get("url") or "")
                if "cafe24" not in url.lower() and "mp." not in url.lower():
                    continue
                item = {
                    "requestId": str(params.get("requestId") or "")[:80],
                    "type": str(params.get("type") or "")[:40],
                    "method": str(request.get("method") or "")[:16],
                    "url": _marketplus_debug_url(url),
                    "postData": _redact_marketplus_debug_text(request.get("postData"), 1600),
                    "initiatorType": str((params.get("initiator") or {}).get("type") or "")[:40],
                }
                requests_seen[item["requestId"]] = item
                requests_out.append(item)
            elif method == "Network.responseReceived":
                response_obj = params.get("response") or {}
                url = str(response_obj.get("url") or "")
                if "cafe24" not in url.lower() and "mp." not in url.lower():
                    continue
                responses_out.append({
                    "requestId": str(params.get("requestId") or "")[:80],
                    "type": str(params.get("type") or "")[:40],
                    "status": response_obj.get("status"),
                    "mimeType": str(response_obj.get("mimeType") or "")[:80],
                    "url": _marketplus_debug_url(url),
                })
            elif method in {"Page.javascriptDialogOpening", "Page.windowOpen"}:
                page_events.append({
                    "method": method,
                    "url": _marketplus_debug_url(params.get("url")),
                    "message": _redact_marketplus_debug_text(params.get("message"), 500),
                })
        sock.settimeout(old_timeout)
        return {
            "value": eval_value,
            "error": eval_error,
            "network": {
                "requests": requests_out[-80:],
                "responses": responses_out[-80:],
                "pageEvents": page_events[-20:],
                "requestCount": len(requests_out),
                "responseCount": len(responses_out),
            },
        }
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _marketplus_recipe_now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _marketplus_recipe_load():
    try:
        with open(_MARKETPLUS_RECIPE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("recipes"), list):
            return data
    except Exception:
        pass
    return {
        "version": 1,
        "updatedAt": "",
        "note": "MarketPlus internal API recipes store URL/method/body structure only. No cookie, CSRF, authorization header, or raw body values are persisted.",
        "recipes": [],
    }


def _marketplus_recipe_save(data):
    os.makedirs(os.path.dirname(_MARKETPLUS_RECIPE_PATH), exist_ok=True)
    data["version"] = 1
    data["updatedAt"] = _marketplus_recipe_now()
    data["note"] = "MarketPlus internal API recipes store URL/method/body structure only. No cookie, CSRF, authorization header, or raw body values are persisted."
    with open(_MARKETPLUS_RECIPE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _marketplus_recipe_channel(text):
    lowered = str(text or "").lower()
    if any(token in lowered for token in ["gmarket", "g마켓", "지마켓", "esm"]):
        return "gmarket"
    if "auction" in lowered or "옥션" in lowered:
        return "auction"
    if any(token in lowered for token in ["11st", "eleven", "11번가", "십일번가", "sk11st"]):
        return "elevenst"
    if any(token in lowered for token in ["smartstore", "shopn", "스마트스토어", "네이버"]):
        return "smartstore"
    if "coupang" in lowered or "쿠팡" in lowered:
        return "coupang"
    if "kakao" in lowered or "카카오" in lowered:
        return "kakao"
    return "unknown"


def _marketplus_recipe_query_keys(query):
    keys = []
    for key, _ in parse_qsl(str(query or ""), keep_blank_values=True):
        key_text = str(key or "").strip()
        if not key_text:
            continue
        if re.search(r"(?i)(token|auth|authorization|password|passwd|secret|csrf|key|session|cookie)", key_text):
            continue
        keys.append(key_text[:80])
    return sorted(set(keys))


def _marketplus_recipe_url_shape(url):
    text = str(url or "").strip()
    try:
        parsed = urlparse(text)
        query_keys = _marketplus_recipe_query_keys(parsed.query)
        pattern = f"{parsed.scheme}://{parsed.netloc}{parsed.path}" if parsed.scheme and parsed.netloc else parsed.path
        if query_keys:
            pattern += "?" + "&".join(f"{key}=<value>" for key in query_keys)
        return {
            "host": parsed.netloc[:160],
            "path": parsed.path[:300],
            "queryKeys": query_keys,
            "pattern": pattern[:600],
        }
    except Exception:
        return {
            "host": "",
            "path": "",
            "queryKeys": [],
            "pattern": _redact_marketplus_debug_text(text, 600),
        }


def _marketplus_recipe_value_shape(value, depth=0):
    if depth > 4:
        return "nested"
    if isinstance(value, dict):
        shaped = {}
        for key in sorted(value.keys(), key=lambda item: str(item))[:80]:
            key_text = str(key or "").strip()[:120]
            if not key_text:
                continue
            if re.search(r"(?i)(token|auth|authorization|password|passwd|secret|csrf|key|session|cookie)", key_text):
                shaped[key_text] = "redacted-field"
            else:
                shaped[key_text] = _marketplus_recipe_value_shape(value.get(key), depth + 1)
        return shaped
    if isinstance(value, list):
        first = _marketplus_recipe_value_shape(value[0], depth + 1) if value else "empty"
        return {"type": "array", "item": first}
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    if value is None:
        return "null"
    return "string"


def _marketplus_recipe_body_shape(post_data):
    text = str(post_data or "")
    if not text.strip():
        return {"type": "empty", "keys": []}
    try:
        parsed = json.loads(text)
        shape = _marketplus_recipe_value_shape(parsed)
        keys = sorted(shape.keys()) if isinstance(shape, dict) else []
        return {"type": "json", "keys": keys[:120], "shape": shape}
    except Exception:
        pass
    try:
        pairs = parse_qsl(text, keep_blank_values=True)
        if pairs:
            grouped = {}
            for key, value in pairs:
                key_text = str(key or "").strip()[:160]
                if not key_text:
                    continue
                grouped[key_text] = "redacted-field" if re.search(r"(?i)(token|auth|authorization|password|passwd|secret|csrf|key|session|cookie)", key_text) else _marketplus_recipe_value_shape(value)
            return {"type": "form", "keys": sorted(grouped.keys())[:160], "shape": grouped}
    except Exception:
        pass
    return {"type": "text", "keys": [], "shape": "opaque-string"}


def _marketplus_recipe_signature(recipe):
    material = json.dumps({
        "channel": recipe.get("channel"),
        "method": recipe.get("method"),
        "urlPattern": (recipe.get("url") or {}).get("pattern"),
        "bodyType": (recipe.get("body") or {}).get("type"),
        "bodyKeys": (recipe.get("body") or {}).get("keys"),
    }, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(material.encode("utf-8")).hexdigest()[:18]


def _marketplus_recipe_capture(network, context=None):
    context = context or {}
    if not isinstance(network, dict):
        return {"ok": False, "saved": 0, "reason": "missing_network_probe"}
    responses = {}
    for response in network.get("responses") or []:
        if isinstance(response, dict):
            responses[str(response.get("requestId") or "")] = response
    recipes = []
    for request_item in network.get("requests") or []:
        if not isinstance(request_item, dict):
            continue
        method = str(request_item.get("method") or "").upper()[:16]
        url = str(request_item.get("url") or "")
        post_data = str(request_item.get("postData") or "")
        if not method or not url:
            continue
        if method == "GET" and not post_data:
            continue
        lowered_url = url.lower()
        if "cafe24" not in lowered_url and "/mp/" not in lowered_url and "mp." not in lowered_url:
            continue
        body = _marketplus_recipe_body_shape(post_data)
        url_shape = _marketplus_recipe_url_shape(url)
        channel = _marketplus_recipe_channel(" ".join([
            url,
            post_data[:2000],
            " ".join(context.get("channelLabels") or []),
        ]))
        response_item = responses.get(str(request_item.get("requestId") or "")) or {}
        recipe = {
            "version": 1,
            "createdAt": _marketplus_recipe_now(),
            "updatedAt": _marketplus_recipe_now(),
            "source": "marketplus-ui-capture",
            "channel": channel,
            "method": method,
            "url": url_shape,
            "body": body,
            "responseStatus": response_item.get("status"),
            "responseMimeType": str(response_item.get("mimeType") or "")[:80],
            "sample": {
                "productNoPresent": bool(context.get("productNo")),
                "productCodePresent": bool(context.get("productCode")),
                "channelLabels": [str(item)[:80] for item in (context.get("channelLabels") or [])][:12],
            },
            "security": {
                "storedHeaders": False,
                "storedCookies": False,
                "storedCsrf": False,
                "storedAuthorization": False,
                "storedRawBodyValues": False,
            },
        }
        recipe["id"] = _marketplus_recipe_signature(recipe)
        recipes.append(recipe)
    if not recipes:
        return {"ok": False, "saved": 0, "reason": "no_mutating_marketplus_requests"}
    data = _marketplus_recipe_load()
    existing = {str(item.get("id") or ""): item for item in data.get("recipes") or [] if isinstance(item, dict)}
    saved = 0
    updated = 0
    for recipe in recipes:
        recipe_id = recipe["id"]
        if recipe_id in existing:
            old = existing[recipe_id]
            recipe["createdAt"] = old.get("createdAt") or recipe["createdAt"]
            existing[recipe_id] = {**old, **recipe, "updatedAt": _marketplus_recipe_now()}
            updated += 1
        else:
            existing[recipe_id] = recipe
            saved += 1
    ordered = sorted(existing.values(), key=lambda item: str(item.get("updatedAt") or ""), reverse=True)[:240]
    data["recipes"] = ordered
    _marketplus_recipe_save(data)
    summaries = [{
        "id": item.get("id"),
        "channel": item.get("channel"),
        "method": item.get("method"),
        "urlPattern": (item.get("url") or {}).get("pattern"),
        "bodyType": (item.get("body") or {}).get("type"),
        "bodyKeys": (item.get("body") or {}).get("keys", [])[:20],
    } for item in recipes[:20]]
    return {
        "ok": True,
        "saved": saved,
        "updated": updated,
        "total": len(ordered),
        "recipes": summaries,
        "note": "요청 URL, method, body 구조만 저장했습니다. 쿠키/CSRF/인증 헤더/원문 body 값은 저장하지 않았습니다.",
    }


def _marketplus_recipe_dry_run(context=None):
    context = context or {}
    data = _marketplus_recipe_load()
    recipes = [item for item in (data.get("recipes") or []) if isinstance(item, dict)]
    if not recipes:
        return {
            "enabled": True,
            "ok": False,
            "mode": "dry-run",
            "reason": "no_recipe",
            "recipeCount": 0,
            "note": "저장된 마켓플러스 내부 API 레시피가 없어 기존 화면 클릭 루트로 진행합니다.",
        }
    requested_channels = [
        _marketplus_recipe_channel(label)
        for label in (context.get("channelLabels") or [])
        if str(label or "").strip()
    ]
    requested = {channel for channel in requested_channels if channel != "unknown"}
    matched = [
        item for item in recipes
        if not requested or item.get("channel") in requested or item.get("channel") == "unknown"
    ]
    summaries = [{
        "id": item.get("id"),
        "channel": item.get("channel"),
        "method": item.get("method"),
        "urlPattern": (item.get("url") or {}).get("pattern"),
        "bodyType": (item.get("body") or {}).get("type"),
        "bodyKeyCount": len((item.get("body") or {}).get("keys") or []),
        "updatedAt": item.get("updatedAt"),
    } for item in matched[:10]]
    return {
        "enabled": True,
        "ok": bool(matched),
        "mode": "dry-run",
        "reason": "matched_recipe" if matched else "no_matching_recipe",
        "recipeCount": len(recipes),
        "matchedCount": len(matched),
        "requestedChannels": sorted(requested),
        "recipes": summaries,
        "note": "저장된 내부 API 레시피 구조를 확인했습니다. dry-run이라 요청은 보내지 않고 기존 화면 클릭 루트로 이어갑니다." if matched else "요청 채널에 맞는 레시피가 없어 기존 화면 클릭 루트로 진행합니다.",
    }


