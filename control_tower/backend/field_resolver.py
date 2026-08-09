from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Final

from .runtime_cache import JsonObject, JsonValue


_COMMAND_FIELDS: Final = (
    "contractVersion",
    "capabilityVersion",
    "commandId",
    "batchId",
    "productId",
    "productKey",
    "stageId",
    "attempt",
    "issuedAt",
    "deadlineAt",
    "workspaceId",
    "currentRunId",
    "inputImageFingerprint",
    "expectedWorkfileRevision",
    "operationToken",
    "idempotencyKey",
)
_IDENTITY_FIELDS: Final = (
    "batchId",
    "productId",
    "productKey",
    "workspaceId",
    "currentRunId",
    "inputImageFingerprint",
    "expectedWorkfileRevision",
    "operationToken",
)
_AUTHORITATIVE_SOURCES: Final = frozenset({"sinhwa-db", "cafe24"})


class FieldResolutionConflict(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _mapping(value: JsonValue | Mapping[str, JsonValue], code: str) -> Mapping[str, JsonValue]:
    if not isinstance(value, Mapping):
        raise FieldResolutionConflict(code)
    return value


def _list(value: JsonValue | None, code: str) -> list[JsonValue]:
    if not isinstance(value, list):
        raise FieldResolutionConflict(code)
    return value


def _text(value: JsonValue | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _evidence(candidate: Mapping[str, JsonValue]) -> list[str]:
    raw = candidate.get("evidenceRefs")
    return [item.strip() for item in raw if isinstance(item, str) and item.strip()] if isinstance(raw, list) else []


def _priority(candidate: Mapping[str, JsonValue]) -> int | None:
    source = _text(candidate.get("source"))
    lock_source = _text(candidate.get("lockSource"))
    if candidate.get("locked") is True and (source == "user-manual" or lock_source == "user-manual"):
        return 0
    if source in _AUTHORITATIVE_SOURCES and candidate.get("confirmed") is True:
        return 1
    if source == "deterministic-normalization":
        return 2
    if source == "llm-evidence":
        return 3
    return None


def _field_record(
    *,
    state: str,
    value: JsonValue,
    source: str | None,
    confidence: float,
    evidence_refs: list[str],
    dependencies: list[str],
    hints: list[JsonObject],
    unit: str | None = None,
    lock_source: str | None = None,
) -> JsonObject:
    return {
        "state": state,
        "value": value,
        "source": source,
        "confidence": confidence,
        "evidenceRefs": evidence_refs,
        "dependencies": dependencies,
        "hints": hints,
        **({} if unit is None else {"unit": unit}),
        **({} if lock_source is None else {"lockSource": lock_source}),
    }


def _invalid(
    reason: str,
    *,
    value: JsonValue = None,
    source: str | None = None,
    evidence_refs: list[str] | None = None,
    dependencies: list[str],
    hints: list[JsonObject],
) -> tuple[JsonObject, JsonObject]:
    return (
        _field_record(
            state="invalid",
            value=value,
            source=source,
            confidence=0.0,
            evidence_refs=evidence_refs or [],
            dependencies=dependencies,
            hints=hints,
        ),
        {"reason": reason},
    )


def _resolve_field(spec: Mapping[str, JsonValue], candidates: list[JsonValue]) -> tuple[JsonObject, str | None]:
    required = spec.get("required") is True
    dependencies = [
        item.strip()
        for item in spec.get("dependencies", [])
        if isinstance(item, str) and item.strip()
    ] if isinstance(spec.get("dependencies"), list) else []
    parsed = [_mapping(item, "candidate_invalid") for item in candidates]
    hints = [
        {
            "value": item.get("value"),
            "source": _text(item.get("source")),
            "confidence": item.get("confidence") if isinstance(item.get("confidence"), (int, float)) else 0.0,
            "evidenceRefs": _evidence(item),
        }
        for item in parsed
        if _text(item.get("source")) == "image-analysis"
    ]
    eligible = [(priority, item) for item in parsed if (priority := _priority(item)) is not None]
    if not eligible:
        state = "unresolved" if required else "candidate"
        record = _field_record(
            state=state,
            value=None,
            source=None,
            confidence=0.0,
            evidence_refs=[],
            dependencies=dependencies,
            hints=hints,
        )
        return record, "missing_required" if required else None
    selected_priority = min(priority for priority, _item in eligible)
    selected = [item for priority, item in eligible if priority == selected_priority]
    sources = [_text(item.get("source")) for item in selected]
    if any(not _evidence(item) and source != "user-manual" for item, source in zip(selected, sources, strict=True)):
        record, review = _invalid("evidence_required", dependencies=dependencies, hints=hints)
        return record, str(review["reason"])
    units = {_text(item.get("unit")) for item in selected if _text(item.get("unit"))}
    if len(units) > 1:
        record, review = _invalid("unit_conflict", dependencies=dependencies, hints=hints)
        return record, str(review["reason"])
    values = {(type(item.get("value")).__name__, repr(item.get("value"))) for item in selected}
    if len(values) > 1:
        record, review = _invalid("source_conflict", dependencies=dependencies, hints=hints)
        return record, str(review["reason"])
    winner = selected[0]
    value = winner.get("value")
    source = sources[0]
    evidence_refs = _evidence(winner)
    if required and (value is None or value == ""):
        record, review = _invalid(
            "required_value_empty",
            value=value,
            source=source,
            evidence_refs=evidence_refs,
            dependencies=dependencies,
            hints=hints,
        )
        return record, str(review["reason"])
    state = ("locked", "confirmed", "candidate", "candidate")[selected_priority]
    confidence = winner.get("confidence")
    record = _field_record(
        state=state,
        value=value,
        source=source,
        confidence=float(confidence) if isinstance(confidence, (int, float)) else 0.0,
        evidence_refs=evidence_refs,
        dependencies=dependencies,
        hints=hints,
        unit=next(iter(units), None),
        lock_source=_text(winner.get("lockSource")) or None,
    )
    return record, "manual_confirmation_required" if required and state == "candidate" else None


def _validated_parameters(
    snapshot: Mapping[str, JsonValue],
    command: Mapping[str, JsonValue],
) -> Mapping[str, JsonValue]:
    if any(key not in command or command[key] is None or command[key] == "" for key in _COMMAND_FIELDS):
        raise FieldResolutionConflict("command_identity_missing")
    if command.get("contractType") != "work-order":
        raise FieldResolutionConflict("command_contract_invalid")
    identity = _mapping(snapshot.get("identity"), "snapshot_identity_invalid")
    if command.get("expectedWorkfileRevision") != snapshot.get("workfileRevision"):
        raise FieldResolutionConflict("stale_version")
    if any(command.get(key) != identity.get(key) for key in _IDENTITY_FIELDS):
        raise FieldResolutionConflict("stale_identity")
    operation = _mapping(command.get("operation"), "operation_invalid")
    if operation.get("capability") != "required-fields:resolve:v1":
        raise FieldResolutionConflict("capability_invalid")
    parameters = _mapping(operation.get("parameters"), "operation_invalid")
    if parameters.get("expectedVersion") != snapshot.get("version"):
        raise FieldResolutionConflict("stale_version")
    return parameters


def resolve_required_fields(
    snapshot: Mapping[str, JsonValue],
    command: Mapping[str, JsonValue],
) -> JsonObject:
    parameters = _validated_parameters(snapshot, command)
    specs = _list(parameters.get("fields"), "fields_invalid")
    candidate_map = _mapping(parameters.get("candidates"), "candidates_invalid")
    fields: JsonObject = {}
    reviews: list[JsonValue] = []
    blocked = False
    for raw_spec in specs:
        spec = _mapping(raw_spec, "field_spec_invalid")
        field_id = _text(spec.get("fieldId"))
        if not field_id:
            raise FieldResolutionConflict("field_spec_invalid")
        raw_candidates = candidate_map.get(field_id, [])
        candidates = _list(raw_candidates, "candidates_invalid")
        record, reason = _resolve_field(spec, candidates)
        fields[field_id] = record
        if reason is not None:
            reviews.append({"fieldId": field_id, "reason": reason})
            blocked = blocked or spec.get("required") is True
    result = deepcopy(dict(snapshot))
    result["version"] = int(snapshot.get("version", 0)) + 1
    result["fields"] = fields
    result["manualReviews"] = reviews
    result["blocked"] = blocked
    return result
