from __future__ import annotations

import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass

from .runtime_cache import JsonObject, JsonValue


class HandoffError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class Handoff:
    token: str
    product_id: str
    job_id: str
    workspace_id: str
    expected_revision: int
    factory_url: str
    expires_at: float


class HandoffStore:
    def __init__(self, *, ttl_seconds: int = 300, clock=time.time) -> None:
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._items: dict[str, Handoff] = {}

    def issue(self, payload: Mapping[str, JsonValue], *, factory_url: str) -> JsonObject:
        product_id = str(payload.get("productId", "")).strip()
        job_id = str(payload.get("jobId", "")).strip()
        workspace_id = str(payload.get("workspaceId", "")).strip()
        expected_revision = payload.get("expectedRevision")
        if not product_id or not job_id or not workspace_id or type(expected_revision) is not int or expected_revision < 0:
            raise HandoffError("handoff_payload_invalid")
        if not factory_url.startswith("http://127.0.0.1:"):
            raise HandoffError("handoff_factory_origin_invalid")
        token = secrets.token_urlsafe(32)
        item = Handoff(token, product_id, job_id, workspace_id, expected_revision, factory_url.rstrip("/"), self._clock() + self.ttl_seconds)
        self._items[token] = item
        return {
            "handoffToken": token,
            "expiresAt": item.expires_at,
            "openUrl": f"{item.factory_url}/app.html?batchHandoff={token}",
            "productId": item.product_id,
            "jobId": item.job_id,
            "workspaceId": item.workspace_id,
            "expectedRevision": item.expected_revision,
        }

    def consume(self, token: str, *, expected_revision: int) -> JsonObject:
        item = self._items.get(token)
        if item is None or item.expires_at <= self._clock():
            raise HandoffError("handoff_expired")
        if expected_revision != item.expected_revision:
            raise HandoffError("stale_workfile_revision")
        self._items.pop(token, None)
        return {
            "productId": item.product_id,
            "jobId": item.job_id,
            "workspaceId": item.workspace_id,
            "expectedRevision": item.expected_revision,
            "factoryUrl": item.factory_url,
        }
