from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import unquote, urlencode, urlsplit

import requests

from .pdp_client import PdpHttpError
from .runtime_cache import JsonObject, JsonValue


class WorkbenchHttpResponse(Protocol):
    status_code: int
    content: bytes
    headers: Mapping[str, str]

    def json(self) -> JsonValue: ...


@dataclass(frozen=True, slots=True)
class WorkbenchAssetBytes:
    content: bytes
    content_type: str
    cache_control: str


class PdpWorkbenchApi(Protocol):
    def list_products(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_product(self, jcode: int) -> JsonObject: ...

    def get_product_fields(self, jcode: int) -> JsonObject: ...

    def get_product_assets(self, jcode: int) -> JsonObject: ...

    def list_work_bundles(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_work_bundle(self, bundle_id: str) -> JsonObject: ...

    def get_work_bundle_asset(self, reference: str) -> WorkbenchAssetBytes: ...

    def create_batch(self, payload: JsonObject, idempotency_key: str) -> JsonObject: ...

    def list_batches(self, query: Mapping[str, JsonValue]) -> JsonObject: ...

    def get_batch(self, batch_id: str) -> JsonObject: ...

    def get_batch_items(self, batch_id: str) -> JsonObject: ...

    def command_batch(
        self,
        batch_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject: ...

    def get_batch_events(self, batch_id: str, after: int) -> JsonObject: ...

    def decide_review(
        self,
        review_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject: ...

    def create_publication(
        self,
        jcode: int,
        payload: JsonObject,
        idempotency_key: str,
    ) -> JsonObject: ...


def _error_code(value: JsonValue, fallback: str) -> str:
    if not isinstance(value, dict):
        return fallback
    error = value.get("error")
    if not isinstance(error, dict):
        return fallback
    code = error.get("code")
    return code if isinstance(code, str) and code else fallback


class PdpWorkbenchHttpApi:
    def __init__(
        self,
        assets_base_url: str,
        control_base_url: str,
        service_key: str,
        *,
        request_fn: Callable[..., WorkbenchHttpResponse] = requests.request,
    ) -> None:
        self._assets_base_url = assets_base_url.rstrip("/")
        self._control_base_url = control_base_url.rstrip("/")
        self._service_key = service_key
        self._request = request_fn

    def _call(
        self,
        base_url: str,
        method: str,
        endpoint: str,
        *,
        payload: JsonObject | None = None,
        query: Mapping[str, JsonValue] | None = None,
        idempotency_key: str | None = None,
        expected_version: int | None = None,
    ) -> JsonObject:
        response = self._send(
            base_url,
            method,
            endpoint,
            payload=payload,
            query=query,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
        )
        try:
            raw = response.json()
        except (TypeError, ValueError) as error:
            raise PdpHttpError("pdp_response_invalid", response.status_code) from error
        if response.status_code >= 400:
            raise PdpHttpError(_error_code(raw, "pdp_request_failed"), response.status_code)
        misleading_code = _error_code(raw, "")
        if misleading_code:
            raise PdpHttpError(misleading_code, response.status_code)
        if not isinstance(raw, dict):
            raise PdpHttpError("pdp_response_invalid", response.status_code)
        return {key: value for key, value in raw.items()}

    def _send(
        self,
        base_url: str,
        method: str,
        endpoint: str,
        *,
        payload: JsonObject | None = None,
        query: Mapping[str, JsonValue] | None = None,
        idempotency_key: str | None = None,
        expected_version: int | None = None,
        accept: str = "application/json",
    ) -> WorkbenchHttpResponse:
        if not self._service_key:
            raise PdpHttpError("pdp_auth_missing")
        headers = {
            "Accept": accept,
            "X-PDP-Control-Service-Key": self._service_key,
        }
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        if expected_version is not None:
            headers["If-Match"] = str(expected_version)
        query_string = urlencode(
            {
                key: value
                for key, value in (query or {}).items()
                if isinstance(value, (str, int)) and value != ""
            },
        )
        url = f"{base_url}{endpoint}"
        if query_string:
            url = f"{url}?{query_string}"
        try:
            return self._request(
                method,
                url,
                headers=headers,
                json=payload,
                timeout=(3, 15),
            )
        except requests.RequestException as error:
            raise PdpHttpError("pdp_unavailable") from error

    def list_products(self, query: Mapping[str, JsonValue]) -> JsonObject:
        return self._call(self._assets_base_url, "GET", "/products", query=query)

    def get_product(self, jcode: int) -> JsonObject:
        return self._call(self._assets_base_url, "GET", f"/products/{jcode}")

    def get_product_fields(self, jcode: int) -> JsonObject:
        return self._call(self._assets_base_url, "GET", f"/products/{jcode}/fields")

    def get_product_assets(self, jcode: int) -> JsonObject:
        return self._call(self._assets_base_url, "GET", f"/products/{jcode}/assets")

    def list_work_bundles(self, query: Mapping[str, JsonValue]) -> JsonObject:
        return self._call(self._assets_base_url, "GET", "/work-bundles", query=query)

    def get_work_bundle(self, bundle_id: str) -> JsonObject:
        return self._call(self._assets_base_url, "GET", f"/work-bundles/{bundle_id}")

    def get_work_bundle_asset(self, reference: str) -> WorkbenchAssetBytes:
        parsed = urlsplit(reference)
        decoded_path = unquote(parsed.path)
        if (
            parsed.scheme
            or parsed.netloc
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith("/api/pdp-assets/v1/")
            or ".." in decoded_path.split("/")
            or "\\" in decoded_path
        ):
            raise PdpHttpError("asset_reference_forbidden", 422)
        base = urlsplit(self._assets_base_url)
        response = self._send(
            f"{base.scheme}://{base.netloc}",
            "GET",
            parsed.path,
            accept="image/*",
        )
        if response.status_code >= 400:
            raise PdpHttpError("asset_fetch_failed", response.status_code)
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise PdpHttpError("asset_mime_forbidden", 502)
        return WorkbenchAssetBytes(
            content=response.content,
            content_type=content_type,
            cache_control=response.headers.get("Cache-Control", "private, max-age=300"),
        )

    def create_batch(self, payload: JsonObject, idempotency_key: str) -> JsonObject:
        return self._call(
            self._control_base_url,
            "POST",
            "/production-batches",
            payload=payload,
            idempotency_key=idempotency_key,
        )

    def list_batches(self, query: Mapping[str, JsonValue]) -> JsonObject:
        return self._call(
            self._control_base_url,
            "GET",
            "/production-batches",
            query=query,
        )

    def get_batch(self, batch_id: str) -> JsonObject:
        return self._call(
            self._control_base_url,
            "GET",
            f"/production-batches/{batch_id}",
        )

    def get_batch_items(self, batch_id: str) -> JsonObject:
        return self._call(
            self._control_base_url,
            "GET",
            f"/production-batches/{batch_id}/items",
        )

    def command_batch(
        self,
        batch_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject:
        return self._call(
            self._control_base_url,
            "POST",
            f"/production-batches/{batch_id}/commands",
            payload=payload,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
        )

    def get_batch_events(self, batch_id: str, after: int) -> JsonObject:
        return self._call(
            self._control_base_url,
            "GET",
            f"/production-batches/{batch_id}/events",
            query={"after": after},
        )

    def decide_review(
        self,
        review_id: str,
        payload: JsonObject,
        idempotency_key: str,
        expected_version: int,
    ) -> JsonObject:
        return self._call(
            self._assets_base_url,
            "POST",
            f"/reviews/{review_id}/decision",
            payload=payload,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
        )

    def create_publication(
        self,
        jcode: int,
        payload: JsonObject,
        idempotency_key: str,
    ) -> JsonObject:
        return self._call(
            self._assets_base_url,
            "POST",
            f"/products/{jcode}/publications",
            payload=payload,
            idempotency_key=idempotency_key,
        )


__all__ = ["PdpWorkbenchApi", "PdpWorkbenchHttpApi", "WorkbenchAssetBytes"]
