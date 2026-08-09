from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock
from typing import Final, Protocol
from uuid import uuid4

from flask import Flask, Response, jsonify, request

from .factory_sync import FactorySyncError
from .pdp_client import PdpHttpError
from .publication_receipt_binding import (
    ReceiptRecoveryError,
    RecoveryBinding,
    parse_recovery,
)
from .publication_receipt_verification import verified_terminal_receipt
from .runtime_cache import JsonObject

RECOVERY_PATH: Final = "/api/cafe24/publication-receipts/recover"


class PublicationReceiptApi(Protocol):
    def get_publication_receipt(
        self,
        job_id: str,
        idempotency_key: str,
    ) -> JsonObject: ...

    def create_publication_receipt(
        self, job_id: str, payload: JsonObject
    ) -> JsonObject: ...

    def get_publication_events(self, job_id: str) -> JsonObject: ...


class FactoryPublicationState(Protocol):
    def current_state(self) -> JsonObject: ...

    def record_publication_receipt(
        self,
        receipt: JsonObject,
    ) -> JsonObject: ...


@dataclass(frozen=True, slots=True)
class RecoveryDependencies:
    api: PublicationReceiptApi
    factory: FactoryPublicationState
    csrf_guard: Callable[[], tuple[Response, int] | None]


def _error(code: str, status: int, *, retryable: bool) -> tuple[Response, int]:
    return (
        jsonify(
            {
                "error": {
                    "code": code,
                    "message": "요청을 처리할 수 없습니다.",
                    "retryable": retryable,
                    "correlationId": f"ct-{uuid4().hex}",
                },
            },
        ),
        status,
    )


def _conflict(error: ReceiptRecoveryError) -> tuple[Response, int]:
    conflict = error.code.startswith("stale_") or error.code in {
        "factory_receipt_tampered",
        "factory_receipt_target_mismatch",
        "idempotency_conflict",
        "publication_receipt_mismatch",
    }
    return _error(error.code, 409 if conflict else 422, retryable=False)


def _upstream_error(error: PdpHttpError) -> tuple[Response, int]:
    if error.status == 422:
        return _error("receipt_payload_rejected", 422, retryable=False)
    if error.status == 409:
        return _error(error.code, 409, retryable=False)
    return _error("blocked_external", 503, retryable=True)


def _lookup_error(error: PdpHttpError) -> tuple[Response, int]:
    if error.status in {409, 422}:
        return _error(error.code, error.status, retryable=False)
    return _error("blocked_external", 503, retryable=True)


def register_publication_recovery_route(
    app: Flask,
    dependencies: RecoveryDependencies,
) -> None:
    completed: dict[str, tuple[str, JsonObject]] = {}
    pending: dict[str, tuple[str, JsonObject]] = {}
    staging_bindings: dict[str, tuple[str, str]] = {}
    recovery_lock = RLock()

    @app.post(RECOVERY_PATH)
    def recover_publication_receipt() -> Response | tuple[Response, int]:
        csrf_error = dependencies.csrf_guard()
        if csrf_error is not None:
            return csrf_error
        raw = request.get_json(silent=True)
        if not isinstance(raw, dict):
            return _error("factory_receipt_invalid", 422, retryable=False)
        try:
            binding = parse_recovery(raw, dependencies.factory.current_state())
        except ReceiptRecoveryError as error:
            return _conflict(error)
        with recovery_lock:
            staging_binding = staging_bindings.get(binding.staging_idempotency_key)
            if staging_binding is not None and staging_binding != (
                binding.publication_idempotency_key,
                binding.fingerprint,
            ):
                return _error("idempotency_conflict", 409, retryable=False)
            previous = completed.get(binding.publication_idempotency_key)
            if previous is not None:
                previous_fingerprint, previous_response = previous
                if previous_fingerprint != binding.fingerprint:
                    return _error("idempotency_conflict", 409, retryable=False)
                return jsonify(
                    {**previous_response, "replayed": True, "receiptOnly": True}
                )
            try:
                receipt_response = _pending_response(pending, binding)
            except ReceiptRecoveryError as error:
                return _conflict(error)
            if receipt_response is None:
                try:
                    receipt_response = dependencies.api.get_publication_receipt(
                        binding.job_id,
                        binding.publication_idempotency_key,
                    )
                except PdpHttpError as error:
                    if error.status != 404:
                        return _lookup_error(error)
                    try:
                        receipt_response = dependencies.api.create_publication_receipt(
                            binding.job_id,
                            binding.publication_payload,
                        )
                    except PdpHttpError as post_error:
                        return _upstream_error(post_error)
                pending[binding.publication_idempotency_key] = (
                    binding.fingerprint,
                    receipt_response,
                )
                staging_bindings[binding.staging_idempotency_key] = (
                    binding.publication_idempotency_key,
                    binding.fingerprint,
                )
            try:
                events = dependencies.api.get_publication_events(binding.job_id)
            except PdpHttpError:
                return _error("receipt_readback_pending", 503, retryable=True)
            try:
                terminal = verified_terminal_receipt(binding, receipt_response, events)
            except ReceiptRecoveryError as error:
                return _conflict(error)
            if terminal is None:
                return _error("receipt_readback_pending", 503, retryable=True)
            try:
                dependencies.factory.record_publication_receipt(
                    terminal,
                )
            except FactorySyncError as error:
                return _error(error.code, 409, retryable=False)
            completed[binding.publication_idempotency_key] = (
                binding.fingerprint,
                terminal,
            )
            pending.pop(binding.publication_idempotency_key, None)
        return jsonify({**terminal, "receiptOnly": True})


def _pending_response(
    pending: dict[str, tuple[str, JsonObject]],
    binding: RecoveryBinding,
) -> JsonObject | None:
    previous = pending.get(binding.publication_idempotency_key)
    if previous is None:
        return None
    fingerprint, response = previous
    if fingerprint != binding.fingerprint:
        raise ReceiptRecoveryError("idempotency_conflict")
    return response
