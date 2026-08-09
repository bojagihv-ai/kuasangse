from __future__ import annotations

from collections.abc import Mapping
from typing import Final, Protocol, TypeAlias

from .runtime_cache import JsonObject, JsonValue, ReplayableRuntimeCache


class AuthorityConflict(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class RemoteAuthorityTransport(Protocol):
    def append_event(self, event: JsonObject) -> JsonObject: ...

    def claim_worker(self, order: JsonObject) -> JsonObject: ...

    def get_job(self, job_id: str) -> JsonObject: ...


_PRODUCT_ID: Final = "productId"


def _copy_json_object(value: Mapping[str, JsonValue]) -> JsonObject:
    return {key: child for key, child in value.items()}


class PdpControlAuthority:
    def __init__(self, remote: RemoteAuthorityTransport, cache: ReplayableRuntimeCache) -> None:
        self.remote = remote
        self.cache = cache

    def append_event(self, event: Mapping[str, JsonValue]) -> JsonObject:
        request = _copy_json_object(event)
        response = self.remote.append_event(request)
        product_id = request.get(_PRODUCT_ID)
        if isinstance(product_id, str) and product_id:
            self.cache.put(f"checkpoint:{product_id}", response)
        return response

    def claim_worker(self, order: Mapping[str, JsonValue]) -> JsonObject:
        return self.remote.claim_worker(_copy_json_object(order))

    def recover_job(self, job_id: str) -> JsonObject:
        job = self.remote.get_job(job_id)
        self.cache.put(f"job:{job_id}", job)
        return job

