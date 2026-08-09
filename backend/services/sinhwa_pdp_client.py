from __future__ import annotations

import os
from typing import Any, BinaryIO, Callable
from urllib.parse import urlencode

import requests


class SinhwaPdpApiError(RuntimeError):
    def __init__(
        self,
        code: str,
        *,
        status: int | None = None,
        details: object | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.details = details


RequestCallable = Callable[..., Any]


def _base_url() -> str:
    return (
        os.getenv("SINHWA_PDP_ASSETS_API_BASE", "http://127.0.0.1:8200/api/pdp-assets/v1")
        .strip()
        .rstrip("/")
    )


def _service_key() -> str:
    return os.getenv("SINHWA_PDP_SERVICE_KEY", "").strip()


def _require_jcode(jcode: int) -> int:
    if isinstance(jcode, bool) or not isinstance(jcode, int) or jcode <= 0:
        raise SinhwaPdpApiError("invalid_jcode")
    return jcode


def _json_object(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SinhwaPdpApiError("invalid_response")
    return value


class SinhwaPdpClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        service_key: str | None = None,
        timeout: float = 15.0,
        requester: RequestCallable | None = None,
    ) -> None:
        self._base_url = (base_url or _base_url()).strip().rstrip("/")
        self._service_key = _service_key() if service_key is None else service_key.strip()
        self._timeout = timeout
        self._requester = requester or requests.request

    @property
    def configured(self) -> bool:
        return bool(self._service_key and self._base_url)

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        raw_body: BinaryIO | bytes | None = None,
        params: dict[str, str | int] | None = None,
        idempotency_key: str | None = None,
        expected_version: int | None = None,
        content_type: str | None = None,
        filename: str | None = None,
        content_length: int | None = None,
    ) -> dict[str, Any]:
        if not self._service_key:
            raise SinhwaPdpApiError("service_key_missing")
        headers = {
            "Accept": "application/json",
            "X-PDP-Control-Service-Key": self._service_key,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        elif raw_body is not None and content_type:
            headers["Content-Type"] = content_type
        if filename:
            headers["X-Asset-Filename"] = filename
        if content_length is not None and content_length >= 0:
            headers["Content-Length"] = str(content_length)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if expected_version is not None:
            headers["If-Match"] = str(expected_version)
        try:
            request_options: dict[str, Any] = {
                "headers": headers,
                "timeout": self._timeout,
            }
            if body is not None:
                request_options["json"] = body
            elif raw_body is not None:
                request_options["data"] = raw_body
            response = self._requester(
                method,
                f"{self._base_url}/{path.lstrip('/')}{f'?{urlencode(params)}' if params else ''}",
                **request_options,
            )
        except requests.RequestException as error:
            raise SinhwaPdpApiError("network_error") from error
        try:
            payload = response.json()
        except ValueError as error:
            raise SinhwaPdpApiError("invalid_response", status=response.status_code) from error
        if response.status_code >= 400:
            envelope = _json_object(payload)
            details = envelope.get("error")
            details_object = details if isinstance(details, dict) else {}
            code = str(details_object.get("code") or "request_failed")
            raise SinhwaPdpApiError(code, status=response.status_code, details=details_object)
        return _json_object(payload)

    def get_product(self, jcode: int) -> dict[str, Any]:
        return self._request("GET", f"products/{_require_jcode(jcode)}")

    def get_fields(self, jcode: int) -> dict[str, Any]:
        return self._request("GET", f"products/{_require_jcode(jcode)}/fields")

    def get_assets(self, jcode: int) -> dict[str, Any]:
        return self._request("GET", f"products/{_require_jcode(jcode)}/assets")

    def _get_collection(self, jcode: int, collection: str) -> dict[str, Any]:
        return self._request("GET", f"products/{_require_jcode(jcode)}/{collection}")

    def get_product_context(self, jcode: int) -> dict[str, dict[str, Any]]:
        checked = _require_jcode(jcode)
        return {
            "product": self.get_product(checked),
            "fields": self.get_fields(checked),
            "assets": self.get_assets(checked),
            "sections": self._get_collection(checked, "sections"),
            "compositions": self._get_collection(checked, "compositions"),
            "runs": self._get_collection(checked, "runs"),
            "events": self._get_collection(checked, "events"),
        }

    def search_products(self, query: str, limit: int = 8) -> dict[str, Any]:
        text = str(query or "").strip()
        if not text:
            raise SinhwaPdpApiError("query_required")
        bounded_limit = max(1, min(int(limit), 100))
        return self._request("GET", "products", params={"q": text, "limit": bounded_limit})

    def save_field(
        self,
        jcode: int,
        payload: dict[str, Any],
        idempotency_key: str,
        expected_version: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "PATCH",
            f"products/{_require_jcode(jcode)}/fields",
            body=payload,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
        )

    def save_section(
        self,
        jcode: int,
        payload: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"products/{_require_jcode(jcode)}/sections",
            body=payload,
            idempotency_key=idempotency_key,
        )

    def save_composition(
        self,
        jcode: int,
        payload: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"products/{_require_jcode(jcode)}/compositions",
            body=payload,
            idempotency_key=idempotency_key,
        )

    def list_work_bundles(
        self,
        query: str,
        limit: int = 50,
    ) -> dict[str, Any]:
        bounded_limit = max(1, min(int(limit), 100))
        params: dict[str, str | int] = {"limit": bounded_limit}
        normalized = str(query or "").strip()
        if normalized:
            params["q"] = normalized
        return self._request("GET", "work-bundles", params=params)

    def get_work_bundle(self, bundle_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"work-bundles/{_path_identifier(bundle_id)}",
        )

    def create_work_bundle(
        self,
        manifest: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "work-bundles",
            body=manifest,
            idempotency_key=idempotency_key,
        )

    def mark_work_bundle_activity(self, bundle_key: str, client_id: str) -> dict[str, Any]:
        body = {"bundleKey": bundle_key, "clientId": client_id}
        return self._request("POST", "work-bundles/activity", body=body)

    def update_work_bundle(
        self,
        bundle_id: str,
        manifest: dict[str, Any],
        idempotency_key: str,
        expected_version: int,
    ) -> dict[str, Any]:
        return self._request(
            "PUT",
            f"work-bundles/{_path_identifier(bundle_id)}",
            body=manifest,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
        )

    def upload_work_bundle_asset(
        self,
        bundle_id: str,
        asset_id: str,
        stream: BinaryIO,
        mime_type: str,
        filename: str,
        idempotency_key: str,
        expected_version: int,
        content_length: int | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "PUT",
            (
                f"work-bundles/{_path_identifier(bundle_id)}"
                f"/assets/{_path_identifier(asset_id)}/content"
            ),
            raw_body=stream,
            idempotency_key=idempotency_key,
            expected_version=expected_version,
            content_type=mime_type,
            filename=filename,
            content_length=content_length,
        )


def _path_identifier(value: str) -> str:
    normalized = str(value or "").strip()
    if (
        not normalized
        or len(normalized) > 100
        or "/" in normalized
        or "\\" in normalized
    ):
        raise SinhwaPdpApiError("identifier_invalid")
    return normalized
