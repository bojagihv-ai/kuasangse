from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypedDict


DEFAULT_TTL_MS: Final = 30_000
MIN_TTL_MS: Final = 5_000
MAX_TTL_MS: Final = 120_000


class LeaseSnapshotPayload(TypedDict):
    ok: bool
    granted: bool
    state: str
    code: str
    scopeId: str
    leaseId: str
    fencingToken: int
    ownerId: str
    sessionId: str
    expiresAt: int
    revision: int


@dataclass(frozen=True, slots=True)
class InvalidWorkspaceRequest(TypeError):
    field: str
    reason: str

    def __str__(self) -> str:
        return f"{self.field}: {self.reason}"


@dataclass(frozen=True, slots=True)
class LeaseSnapshot:
    scope_id: str
    state: str
    code: str
    granted: bool
    lease_id: str = ""
    fencing_token: int = 0
    owner_id: str = ""
    session_id: str = ""
    expires_at: int = 0
    revision: int = 0

    def as_dict(self) -> LeaseSnapshotPayload:
        return {
            "ok": self.granted or self.state == "available",
            "granted": self.granted,
            "state": self.state,
            "code": self.code,
            "scopeId": self.scope_id,
            "leaseId": self.lease_id,
            "fencingToken": self.fencing_token,
            "ownerId": self.owner_id,
            "sessionId": self.session_id,
            "expiresAt": self.expires_at,
            "revision": self.revision,
        }


class WorkspaceConflict(RuntimeError):
    __slots__ = ("code", "snapshot")

    def __init__(self, code: str, snapshot: LeaseSnapshot) -> None:
        self.code = code
        self.snapshot = snapshot
        super().__init__(code)
