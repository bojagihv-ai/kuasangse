from dataclasses import dataclass
from threading import RLock
from time import monotonic
from typing import Callable, Final, Mapping

from .runtime_cache import JsonObject, JsonValue


PRESENCE_EXPIRY_MS: Final = 45_000
_PRESENCE_FIELDS: Final = frozenset({
    "presenceId",
    "role",
    "productName",
    "workspaceId",
    "stageKey",
    "stageLabel",
    "message",
    "buildId",
    "sentAt",
})


class HumanPresenceError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class _HumanPresence:
    presence_id: str
    product_name: str
    workspace_id: str
    stage_key: str
    stage_label: str
    message: str
    build_id: str
    sent_at: int
    observed_at: float

    def public_value(self) -> JsonObject:
        return {
            "presenceId": self.presence_id,
            "role": "human",
            "productName": self.product_name,
            "workspaceId": self.workspace_id,
            "stageKey": self.stage_key,
            "stageLabel": self.stage_label,
            "message": self.message,
            "buildId": self.build_id,
            "sentAt": self.sent_at,
        }


class HumanPresenceStore:
    def __init__(self, *, clock: Callable[[], float] = monotonic) -> None:
        self._clock = clock
        self._lock = RLock()
        self._records: dict[str, _HumanPresence] = {}

    def upsert(self, payload: Mapping[str, JsonValue]) -> None:
        if set(payload) != _PRESENCE_FIELDS:
            raise HumanPresenceError()
        role = _required_text(payload, "role")
        if role != "human":
            raise HumanPresenceError()
        sent_at = payload.get("sentAt")
        if type(sent_at) is not int or sent_at < 0:
            raise HumanPresenceError()
        record = _HumanPresence(
            presence_id=_required_text(payload, "presenceId"),
            product_name=_required_text(payload, "productName"),
            workspace_id=_required_text(payload, "workspaceId"),
            stage_key=_required_text(payload, "stageKey"),
            stage_label=_required_text(payload, "stageLabel"),
            message=_required_text(payload, "message"),
            build_id=_required_text(payload, "buildId"),
            sent_at=sent_at,
            observed_at=self._clock(),
        )
        with self._lock:
            self._expire_locked(record.observed_at)
            self._records[record.presence_id] = record

    def dismiss(self, presence_id: str) -> None:
        with self._lock:
            self._records.pop(presence_id, None)

    def active(self) -> list[JsonObject]:
        with self._lock:
            self._expire_locked(self._clock())
            return [record.public_value() for record in self._records.values()]

    def _expire_locked(self, now: float) -> None:
        expired_ids = [
            presence_id
            for presence_id, record in self._records.items()
            if (now - record.observed_at) * 1000 >= PRESENCE_EXPIRY_MS
        ]
        for presence_id in expired_ids:
            del self._records[presence_id]


def _required_text(payload: Mapping[str, JsonValue], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise HumanPresenceError()
    return value.strip()
