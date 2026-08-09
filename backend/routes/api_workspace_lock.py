from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from config import Config
from routes.api_shared import api, jsonify, request
from services.workspace_lock_service import LeaseSnapshot, WorkspaceConflict, WorkspaceLockService
from services.workspace_mutation import StagedFilesystemMutation


ResultT = TypeVar("ResultT")
_DEFAULT_STATE_PATH = Path(Config.LOCAL_STATE_FOLDER) / "workspace-authority.json"
_SERVICE = WorkspaceLockService(_DEFAULT_STATE_PATH.resolve())


@dataclass(frozen=True, slots=True)
class MutationPreconditions:
    lease_id: str
    fencing_token: int
    expected_revision: int
    next_revision: int


class PreconditionRequired(RuntimeError):
    pass

def _body() -> dict:
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else {}


def _scope(body: dict | None = None) -> str:
    source = body or {}
    return str(
        request.args.get("workspaceId")
        or request.headers.get("X-Kuasangse-Workspace-Id")
        or source.get("workspaceId")
        or ""
    ).strip()


def _error(error: WorkspaceConflict):
    payload = error.snapshot.as_dict()
    payload.update({"ok": False, "granted": False, "state": "readonly", "code": error.code})
    return jsonify(payload), 409


def parse_mutation_preconditions(body: dict) -> MutationPreconditions:
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    revision = metadata.get("revision") if isinstance(metadata.get("revision"), dict) else {}
    lease_id = str(body.get("leaseId") or metadata.get("leaseId") or "").strip()
    token_value = body.get("fencingToken", metadata.get("fencingToken"))
    expected_value = body.get("expectedRevision")
    next_value = body.get("revision", revision.get("counter"))
    if not lease_id or token_value is None or expected_value is None or next_value is None:
        raise PreconditionRequired("leaseId, fencingToken, expectedRevision, revision are required")
    try:
        return MutationPreconditions(
            lease_id=lease_id,
            fencing_token=int(token_value),
            expected_revision=int(expected_value),
            next_revision=int(next_value),
        )
    except (TypeError, ValueError) as error:
        raise PreconditionRequired("authority preconditions must be integers") from error


def commit_workspace_mutation(
    scope_id: str, body: dict, mutation: StagedFilesystemMutation[ResultT]
) -> tuple[LeaseSnapshot, ResultT]:
    preconditions = parse_mutation_preconditions(body)
    return _SERVICE.commit_mutation(
        scope_id,
        preconditions.lease_id,
        preconditions.fencing_token,
        expected_revision=preconditions.expected_revision,
        next_revision=preconditions.next_revision,
        mutation=mutation,
    )


def commit_workspace_replica(
    scope_id: str, body: dict, mutation: Callable[[], ResultT]
) -> tuple[LeaseSnapshot, ResultT]:
    preconditions = parse_mutation_preconditions(body)
    return _SERVICE.commit_replica(
        scope_id,
        preconditions.lease_id,
        preconditions.fencing_token,
        expected_revision=preconditions.expected_revision,
        mutation=mutation,
    )


def validate_workspace_mutation(scope_id: str, body: dict) -> LeaseSnapshot:
    preconditions = parse_mutation_preconditions(body)
    return _SERVICE.validate_mutation(
        scope_id,
        preconditions.lease_id,
        preconditions.fencing_token,
        expected_revision=preconditions.expected_revision,
        next_revision=preconditions.next_revision,
    )


def get_workspace_status(scope_id: str) -> LeaseSnapshot:
    return _SERVICE.status(scope_id)


@api.route("/workspace-lock/status", methods=["GET"])
def workspace_lock_status():
    try:
        return jsonify(_SERVICE.status(_scope()).as_dict())
    except TypeError as error:
        return jsonify({"ok": False, "code": "INVALID_SCOPE", "error": str(error)}), 400


@api.route("/workspace-lock/acquire", methods=["POST"])
def workspace_lock_acquire():
    body = _body()
    try:
        outcome = _SERVICE.acquire(
            _scope(body),
            str(body.get("ownerId") or ""),
            str(body.get("sessionId") or ""),
            ttl_ms=int(body.get("ttlMs") or 30_000),
            confirmed_takeover=body.get("confirmedTakeover") is True,
        )
    except (TypeError, ValueError) as error:
        return jsonify({"ok": False, "code": "INVALID_REQUEST", "error": str(error)}), 400
    status = 200 if outcome.granted else 409
    return jsonify(outcome.as_dict()), status


@api.route("/workspace-lock/takeover", methods=["POST"])
def workspace_lock_takeover():
    body = _body()
    if body.get("confirmed") is not True:
        return jsonify({"ok": False, "code": "TAKEOVER_CONFIRMATION_REQUIRED"}), 428
    body["confirmedTakeover"] = True
    try:
        outcome = _SERVICE.acquire(
            _scope(body),
            str(body.get("ownerId") or ""),
            str(body.get("sessionId") or ""),
            ttl_ms=int(body.get("ttlMs") or 30_000),
            confirmed_takeover=True,
        )
    except (TypeError, ValueError) as error:
        return jsonify({"ok": False, "code": "INVALID_REQUEST", "error": str(error)}), 400
    return jsonify(outcome.as_dict())


@api.route("/workspace-lock/heartbeat", methods=["POST"])
def workspace_lock_heartbeat():
    body = _body()
    try:
        outcome = _SERVICE.heartbeat(
            _scope(body),
            str(body.get("leaseId") or ""),
            int(body.get("fencingToken") or 0),
            ttl_ms=int(body.get("ttlMs") or 30_000),
        )
        return jsonify(outcome.as_dict())
    except WorkspaceConflict as error:
        return _error(error)
    except (TypeError, ValueError) as error:
        return jsonify({"ok": False, "code": "INVALID_REQUEST", "error": str(error)}), 400


@api.route("/workspace-lock/release", methods=["POST"])
def workspace_lock_release():
    body = _body()
    try:
        return jsonify(
            _SERVICE.release(
                _scope(body), str(body.get("leaseId") or ""), int(body.get("fencingToken") or 0)
            ).as_dict()
        )
    except WorkspaceConflict as error:
        return _error(error)
    except (TypeError, ValueError) as error:
        return jsonify({"ok": False, "code": "INVALID_REQUEST", "error": str(error)}), 400
