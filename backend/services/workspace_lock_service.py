from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import replace
from typing import TypeVar

from services.workspace_lock_store import WorkspaceLockStore
from services.workspace_lock_types import (
    DEFAULT_TTL_MS,
    MAX_TTL_MS,
    MIN_TTL_MS,
    InvalidWorkspaceRequest,
    LeaseSnapshot,
    WorkspaceConflict,
)
from services.workspace_mutation import StagedFilesystemMutation


ResultT = TypeVar("ResultT")


class WorkspaceLockService(WorkspaceLockStore):
    Conflict = WorkspaceConflict

    @staticmethod
    def _scope(value: str) -> str:
        scope = "".join(str(value or "").split())[:240]
        if not scope.startswith("project:") or len(scope) <= len("project:"):
            raise InvalidWorkspaceRequest("workspaceId", "canonical project scope is required")
        return scope

    @staticmethod
    def _ttl(value: int) -> int:
        return max(MIN_TTL_MS, min(MAX_TTL_MS, int(value or DEFAULT_TTL_MS)))

    @staticmethod
    def _snapshot(scope: str, record: dict, now_ms: int, *, code: str = "") -> LeaseSnapshot:
        lease = record.get("lease") if isinstance(record.get("lease"), dict) else None
        active = lease if lease and int(lease.get("expiresAt") or 0) > now_ms else None
        return LeaseSnapshot(
            scope_id=scope,
            state="editing" if active else "available",
            code=code or ("LEASE_ACTIVE" if active else "AVAILABLE"),
            granted=bool(active),
            lease_id=str((active or {}).get("leaseId") or ""),
            fencing_token=int((active or {}).get("fencingToken") or record.get("nextFencingToken") or 0),
            owner_id=str((active or {}).get("ownerId") or ""),
            session_id=str((active or {}).get("sessionId") or ""),
            expires_at=int((active or {}).get("expiresAt") or 0),
            revision=int(record.get("revision") or 0),
        )

    def status(self, scope_id: str, *, now_ms: int | None = None) -> LeaseSnapshot:
        scope = self._scope(scope_id)
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        with self._locked():
            return self._snapshot(scope, self._record(self._read(), scope), now)

    def acquire(
        self,
        scope_id: str,
        owner_id: str,
        session_id: str,
        *,
        ttl_ms: int = DEFAULT_TTL_MS,
        confirmed_takeover: bool = False,
        now_ms: int | None = None,
    ) -> LeaseSnapshot:
        scope = self._scope(scope_id)
        owner = str(owner_id or "").strip()[:160]
        session = str(session_id or "").strip()[:160]
        if not owner or not session:
            raise InvalidWorkspaceRequest("ownerId/sessionId", "both values are required")
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        with self._locked():
            state = self._read()
            record = self._record(state, scope)
            current = self._snapshot(scope, record, now)
            if current.granted and current.session_id != session and not confirmed_takeover:
                return replace(current, granted=False, code="LEASE_HELD")
            if current.granted and current.session_id == session:
                token = current.fencing_token
                lease_id = current.lease_id
            else:
                token = int(record.get("nextFencingToken") or 0) + 1
                lease_id = uuid.uuid4().hex
                record["nextFencingToken"] = token
            record["lease"] = {
                "leaseId": lease_id,
                "fencingToken": token,
                "ownerId": owner,
                "sessionId": session,
                "expiresAt": now + self._ttl(ttl_ms),
            }
            self._write(state)
            return self._snapshot(scope, record, now, code="LEASE_GRANTED")

    def _require(self, scope: str, record: dict, lease_id: str, token: int, now: int) -> LeaseSnapshot:
        current = self._snapshot(scope, record, now)
        code = "LEASE_EXPIRED" if not current.granted else "STALE_FENCE"
        if (
            not current.granted
            or current.lease_id != str(lease_id or "")
            or current.fencing_token != int(token or 0)
        ):
            raise WorkspaceConflict(code, current)
        return current

    def heartbeat(
        self, scope_id: str, lease_id: str, fencing_token: int, *, ttl_ms: int, now_ms: int | None = None
    ) -> LeaseSnapshot:
        scope = self._scope(scope_id)
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        with self._locked():
            state = self._read()
            record = self._record(state, scope)
            self._require(scope, record, lease_id, fencing_token, now)
            record["lease"]["expiresAt"] = now + self._ttl(ttl_ms)
            self._write(state)
            return self._snapshot(scope, record, now, code="HEARTBEAT_OK")

    def release(
        self,
        scope_id: str,
        lease_id: str,
        fencing_token: int,
        *,
        now_ms: int | None = None,
    ) -> LeaseSnapshot:
        scope = self._scope(scope_id)
        now = int(now_ms if now_ms is not None else time.time() * 1000)
        with self._locked():
            state = self._read()
            record = self._record(state, scope)
            self._require(scope, record, lease_id, fencing_token, now)
            record["lease"] = None
            self._write(state)
            return self._snapshot(scope, record, now, code="RELEASED")

    @staticmethod
    def _require_revision(
        current: LeaseSnapshot, expected_revision: int, next_revision: int
    ) -> None:
        if current.revision != int(expected_revision):
            raise WorkspaceConflict("STALE_REVISION", current)
        if int(next_revision) != current.revision + 1:
            raise WorkspaceConflict("INVALID_NEXT_REVISION", current)

    def validate_mutation(
        self,
        scope_id: str,
        lease_id: str,
        fencing_token: int,
        *,
        expected_revision: int,
        next_revision: int,
    ) -> LeaseSnapshot:
        scope = self._scope(scope_id)
        now = int(time.time() * 1000)
        with self._locked():
            record = self._record(self._read(), scope)
            current = self._require(scope, record, lease_id, fencing_token, now)
            self._require_revision(current, expected_revision, next_revision)
            return current

    def commit_replica(
        self,
        scope_id: str,
        lease_id: str,
        fencing_token: int,
        *,
        expected_revision: int,
        mutation: Callable[[], ResultT],
    ) -> tuple[LeaseSnapshot, ResultT]:
        scope = self._scope(scope_id)
        now = int(time.time() * 1000)
        with self._locked():
            record = self._record(self._read(), scope)
            current = self._require(scope, record, lease_id, fencing_token, now)
            if current.revision != int(expected_revision):
                raise WorkspaceConflict("STALE_REVISION", current)
            return current, mutation()

    def commit_mutation(
        self,
        scope_id: str,
        lease_id: str,
        fencing_token: int,
        *,
        expected_revision: int,
        next_revision: int,
        mutation: StagedFilesystemMutation[ResultT],
    ) -> tuple[LeaseSnapshot, ResultT]:
        scope = self._scope(scope_id)
        now = int(time.time() * 1000)
        with self._locked():
            state = self._read()
            record = self._record(state, scope)
            current = self._require(scope, record, lease_id, fencing_token, now)
            self._require_revision(current, expected_revision, next_revision)
            result = self._commit_staged_mutation(
                state, record, scope, next_revision, mutation
            )
            return self._snapshot(scope, record, now, code="MUTATION_ACCEPTED"), result
