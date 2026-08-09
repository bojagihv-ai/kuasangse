from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Protocol
from urllib.parse import urlencode

import requests

from .runtime_cache import JsonObject, JsonValue


class PdpHttpResponse(Protocol):
    status_code: int

    def json(self) -> JsonValue: ...


class PdpHttpError(Exception):
    def __init__(self, code: str, status: int | None = None) -> None:
        self.code = code
        self.status = status
        super().__init__(code)


class PdpControlHttpApi:
    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        request_fn: Callable[..., PdpHttpResponse] = requests.request,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key
        self._request = request_fn

    def _call(self, method: str, endpoint: str, payload: JsonObject | None = None) -> JsonObject:
        if not self.service_key:
            raise PdpHttpError("pdp_auth_missing")
        headers = {"Accept": "application/json", "X-PDP-Control-Service-Key": self.service_key}
        try:
            response = self._request(
                method,
                f"{self.base_url}{endpoint}",
                headers=headers,
                json=payload,
                timeout=(3, 15),
            )
        except requests.RequestException as error:
            raise PdpHttpError("pdp_unavailable") from error
        try:
            raw = response.json()
        except (TypeError, ValueError) as error:
            raise PdpHttpError("pdp_response_invalid", response.status_code) from error
        if response.status_code >= 400:
            code = "pdp_request_failed"
            if isinstance(raw, dict):
                error = raw.get("error")
                if isinstance(error, dict) and isinstance(error.get("code"), str):
                    code = error["code"]
            if response.status_code in {401, 403}:
                code = "pdp_auth_failed"
            elif response.status_code >= 500:
                code = "pdp_unavailable"
            raise PdpHttpError(code, response.status_code)
        if not isinstance(raw, dict):
            raise PdpHttpError("pdp_response_invalid", response.status_code)
        return {key: value for key, value in raw.items()}

    def get_capabilities(self) -> JsonObject:
        return self._call("GET", "/capabilities")

    def list_sources(self, query: Mapping[str, JsonValue]) -> JsonObject:
        query_string = urlencode(
            {
                key: value
                for key, value in query.items()
                if isinstance(value, (str, int)) and value != ""
            },
        )
        return self._call(
            "GET",
            f"/sources?{query_string}" if query_string else "/sources",
        )

    def get_readiness(self, jcode: int) -> JsonObject:
        return self._call("GET", f"/readiness?{urlencode({'jcode': jcode})}")

    def create_input_snapshot(self, payload: JsonObject) -> JsonObject:
        return self._call("POST", "/input-snapshots", payload)

    def create_job(self, payload: JsonObject) -> JsonObject:
        return self._call("POST", "/jobs", payload)

    def list_jobs(self, query: Mapping[str, JsonValue]) -> JsonObject:
        query_string = "&".join(f"{key}={value}" for key, value in query.items() if value not in {None, ""})
        return self._call("GET", f"/jobs?{query_string}" if query_string else "/jobs")

    def get_job(self, job_id: str) -> JsonObject:
        return self._call("GET", f"/jobs/{job_id}")

    def list_reviews(self, query: Mapping[str, JsonValue]) -> JsonObject:
        query_string = "&".join(f"{key}={value}" for key, value in query.items() if value not in {None, ""})
        return self._call("GET", f"/reviews?{query_string}" if query_string else "/reviews")

    def get_requirements(self, job_id: str) -> JsonObject:
        return self._call("GET", f"/jobs/{job_id}/requirements")

    def create_decision(self, job_id: str, payload: JsonObject) -> JsonObject:
        return self._call("POST", f"/jobs/{job_id}/decisions", payload)

    def create_publication_receipt(self, job_id: str, payload: JsonObject) -> JsonObject:
        return self._call("POST", f"/jobs/{job_id}/publication-receipts", payload)

    def get_publication_receipt(
        self,
        job_id: str,
        idempotency_key: str,
    ) -> JsonObject:
        query = urlencode({"idempotencyKey": idempotency_key})
        return self._call("GET", f"/jobs/{job_id}/publication-receipts?{query}")

    def get_publication_events(self, job_id: str) -> JsonObject:
        return self._call("GET", f"/jobs/{job_id}/publication-events")

    def worker_claim(self, payload: JsonObject) -> JsonObject:
        return self._call("POST", "/workers/claim", payload)

    def worker_lifecycle(self, order_id: str, action: str, payload: JsonObject) -> JsonObject:
        if action not in {"ack", "heartbeat", "events", "complete", "fail"}:
            raise PdpHttpError("worker_action_invalid")
        return self._call("POST", f"/workers/{order_id}/{action}", payload)
