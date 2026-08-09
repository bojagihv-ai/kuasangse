from __future__ import annotations

from copy import deepcopy

import pytest

from control_tower.backend.field_dependencies import DEPENDENCY_REGISTRY, invalidate_category_dependencies
from control_tower.backend.field_resolver import FieldResolutionConflict, resolve_required_fields


IDENTITY = {
    "contractType": "work-order",
    "contractVersion": "1.0.0",
    "capabilityVersion": "1.0.0",
    "commandId": "command-required-fields-001",
    "batchId": "batch-001",
    "productId": "product-001",
    "productKey": "product-key-001",
    "stageId": "required_fields",
    "attempt": 1,
    "issuedAt": "2026-07-31T00:00:00Z",
    "deadlineAt": "2026-07-31T00:05:00Z",
    "workspaceId": "workspace-001",
    "currentRunId": "run-001",
    "inputImageFingerprint": "sha256:" + "a" * 64,
    "expectedWorkfileRevision": 7,
    "operationToken": "operation-001",
    "idempotencyKey": "required-fields-001",
}


def snapshot() -> dict[str, object]:
    return {
        "schema": "required-fields-snapshot:v1",
        "version": 3,
        "workfileRevision": 7,
        "identity": {
            key: IDENTITY[key]
            for key in (
                "batchId",
                "productId",
                "productKey",
                "workspaceId",
                "currentRunId",
                "inputImageFingerprint",
                "expectedWorkfileRevision",
                "operationToken",
            )
        },
        "category": {
            "mallId": "mall-a",
            "categoryNo": "24",
            "schemaVersion": "2026-07-01",
            "digest": "sha256:category-a",
        },
        "fields": {},
        "selectedImages": [{"imageId": "hero-1", "approved": True}],
        "sections": [{"sectionId": "overview", "selectedVariantId": "variant-1"}],
        "options": {"schemaState": "confirmed", "selectedValues": ["red"]},
        "preflight": {"state": "confirmed", "checks": ["images", "detail"]},
    }


def command(
    candidates: dict[str, list[dict[str, object]]],
    *,
    field_id: str = "salePrice",
    required: bool = True,
) -> dict[str, object]:
    return {
        **IDENTITY,
        "operation": {
            "capability": "required-fields:resolve:v1",
            "parameters": {
                "expectedVersion": 3,
                "fields": [{"fieldId": field_id, "required": required, "nullable": False}],
                "candidates": candidates,
            },
        },
        "evidenceRefs": ["manual://task-8"],
    }


def candidate(
    value: object,
    source: str,
    *,
    confirmed: bool = False,
    locked: bool = False,
    unit: str | None = None,
    evidence: list[str] | None = None,
    lock_source: str | None = None,
) -> dict[str, object]:
    return {
        "value": value,
        "source": source,
        "confirmed": confirmed,
        "locked": locked,
        "confidence": 1.0 if confirmed or locked else 0.75,
        "evidenceRefs": [f"{source}://evidence"] if evidence is None else evidence,
        **({} if unit is None else {"unit": unit}),
        **({} if lock_source is None else {"lockSource": lock_source}),
    }


@pytest.mark.parametrize(
    ("candidates", "expected_value", "expected_state", "expected_source"),
    [
        (
            {
                "salePrice": [
                    candidate(9000, "user-manual", locked=True),
                    candidate(7000, "sinhwa-db", confirmed=True),
                    candidate(6000, "deterministic-normalization"),
                    candidate(5000, "llm-evidence"),
                ],
            },
            9000,
            "locked",
            "user-manual",
        ),
        (
            {
                "salePrice": [
                    candidate(7000, "sinhwa-db", confirmed=True),
                    candidate(6000, "deterministic-normalization"),
                    candidate(5000, "llm-evidence"),
                ],
            },
            7000,
            "confirmed",
            "sinhwa-db",
        ),
        (
            {
                "salePrice": [
                    candidate(6000, "deterministic-normalization"),
                    candidate(5000, "llm-evidence"),
                ],
            },
            6000,
            "candidate",
            "deterministic-normalization",
        ),
        (
            {"salePrice": [candidate(5000, "llm-evidence")]},
            5000,
            "candidate",
            "llm-evidence",
        ),
    ],
)
def test_resolver_applies_locked_confirmed_normalized_llm_priority(
    candidates: dict[str, list[dict[str, object]]],
    expected_value: object,
    expected_state: str,
    expected_source: str,
) -> None:
    # Given: every lower-priority value differs from the expected winner.
    original = snapshot()
    operation = command(candidates)
    before_snapshot = deepcopy(original)
    before_command = deepcopy(operation)

    # When: the immutable snapshot command is resolved.
    result = resolve_required_fields(original, operation)

    # Then: the highest eligible tier wins and inputs remain untouched.
    assert result["fields"]["salePrice"]["value"] == expected_value
    assert result["fields"]["salePrice"]["state"] == expected_state
    assert result["fields"]["salePrice"]["source"] == expected_source
    assert original == before_snapshot
    assert operation == before_command


def test_resolver_builds_complete_locked_fields_without_losing_authoritative_sources() -> None:
    operation = command({})
    operation["operation"]["parameters"]["fields"] = [
        {"fieldId": "salePrice", "required": True, "nullable": False},
        {"fieldId": "optionName", "required": True, "nullable": False},
        {"fieldId": "size", "required": True, "nullable": False},
        {"fieldId": "material", "required": True, "nullable": False},
    ]
    operation["operation"]["parameters"]["candidates"] = {
        "salePrice": [candidate(4000, "cafe24", confirmed=True, locked=True, lock_source="user-manual")],
        "optionName": [candidate("color", "cafe24", confirmed=True, locked=True, lock_source="user-manual")],
        "size": [candidate(12, "sinhwa-db", confirmed=True, locked=True, unit="cm", lock_source="user-manual")],
        "material": [candidate("cotton", "sinhwa-db", confirmed=True, locked=True, lock_source="user-manual")],
    }

    result = resolve_required_fields(snapshot(), operation)

    assert result["blocked"] is False
    assert result["manualReviews"] == []
    assert {field_id: record["state"] for field_id, record in result["fields"].items()} == {
        "salePrice": "locked",
        "optionName": "locked",
        "size": "locked",
        "material": "locked",
    }
    assert result["fields"]["salePrice"]["source"] == "cafe24"
    assert result["fields"]["material"]["source"] == "sinhwa-db"
    assert {record["lockSource"] for record in result["fields"].values()} == {"user-manual"}


@pytest.mark.parametrize(
    ("value", "expected_state", "expected_value"),
    [
        (0, "locked", 0),
        ("", "invalid", ""),
    ],
)
def test_resolver_preserves_zero_and_rejects_required_empty(
    value: object,
    expected_state: str,
    expected_value: object,
) -> None:
    result = resolve_required_fields(
        snapshot(),
        command({"salePrice": [candidate(value, "user-manual", locked=True)]}),
    )

    assert result["fields"]["salePrice"]["state"] == expected_state
    assert result["fields"]["salePrice"]["value"] == expected_value
    assert result["blocked"] is (expected_state == "invalid")


@pytest.mark.parametrize(
    ("candidates", "reason"),
    [
        (
            {
                "size": [
                    candidate(10, "sinhwa-db", confirmed=True, unit="cm"),
                    candidate(10, "cafe24", confirmed=True, unit="mm"),
                ],
            },
            "unit_conflict",
        ),
        (
            {
                "size": [
                    candidate(10, "sinhwa-db", confirmed=True, unit="cm"),
                    candidate(12, "cafe24", confirmed=True, unit="cm"),
                ],
            },
            "source_conflict",
        ),
    ],
)
def test_resolver_exposes_authoritative_conflict_for_manual_review(
    candidates: dict[str, list[dict[str, object]]],
    reason: str,
) -> None:
    result = resolve_required_fields(snapshot(), command(candidates, field_id="size"))

    assert result["fields"]["size"]["state"] == "invalid"
    assert result["fields"]["size"]["source"] is None
    assert result["manualReviews"] == [{"fieldId": "size", "reason": reason}]
    assert result["blocked"] is True
    assert result["selectedImages"] == snapshot()["selectedImages"]


def test_resolver_never_promotes_image_analysis_or_evidence_free_fact() -> None:
    result = resolve_required_fields(
        snapshot(),
        command(
            {
                "material": [
                    candidate("silk", "image-analysis"),
                    candidate("cotton", "sinhwa-db", confirmed=True, evidence=[]),
                ],
            },
            field_id="material",
        ),
    )

    assert result["fields"]["material"]["state"] == "invalid"
    assert result["fields"]["material"]["value"] is None
    assert result["fields"]["material"]["hints"][0]["source"] == "image-analysis"
    assert result["manualReviews"] == [{"fieldId": "material", "reason": "evidence_required"}]


def test_resolver_leaves_image_analysis_only_value_unresolved() -> None:
    result = resolve_required_fields(
        snapshot(),
        command(
            {"material": [candidate("silk", "image-analysis")]},
            field_id="material",
        ),
    )

    assert result["fields"]["material"]["state"] == "unresolved"
    assert result["fields"]["material"]["value"] is None
    assert result["fields"]["material"]["source"] is None
    assert result["manualReviews"] == [{"fieldId": "material", "reason": "missing_required"}]


def test_resolver_rejects_stale_version_and_identity() -> None:
    stale_version = command({"salePrice": [candidate(1, "sinhwa-db", confirmed=True)]})
    stale_version["operation"]["parameters"]["expectedVersion"] = 2
    stale_identity = command({"salePrice": [candidate(1, "sinhwa-db", confirmed=True)]})
    stale_identity["currentRunId"] = "run-stale"

    with pytest.raises(FieldResolutionConflict, match="stale_version"):
        resolve_required_fields(snapshot(), stale_version)
    with pytest.raises(FieldResolutionConflict, match="stale_identity"):
        resolve_required_fields(snapshot(), stale_identity)


def test_category_change_invalidates_only_registered_consumers() -> None:
    original = snapshot()
    original["fields"] = {
        "material": {
            "state": "confirmed",
            "value": "cotton",
            "source": "sinhwa-db",
            "confidence": 1.0,
            "evidenceRefs": ["sinhwa-db://material"],
            "dependencies": [],
        },
        "customsCode": {
            "state": "confirmed",
            "value": "6307",
            "source": "cafe24-category-requirements",
            "confidence": 1.0,
            "evidenceRefs": ["cafe24://category/24"],
            "dependencies": ["category"],
        },
    }
    before = deepcopy(original)

    result = invalidate_category_dependencies(
        original,
        {
            "mallId": "mall-a",
            "categoryNo": "99",
            "schemaVersion": "2026-07-01",
            "digest": "sha256:category-b",
        },
        expected_version=3,
    )

    assert result["fields"]["material"] == original["fields"]["material"]
    assert result["fields"]["customsCode"]["state"] == "unresolved"
    assert result["options"]["schemaState"] == "unresolved"
    assert result["preflight"]["state"] == "unresolved"
    assert result["selectedImages"] == original["selectedImages"]
    assert result["sections"] == original["sections"]
    assert result["invalidatedConsumers"] == [
        "field:customsCode",
        "options:category-requirements",
        "preflight:category-requirements",
    ]
    assert DEPENDENCY_REGISTRY["category"] == (
        "options:category-requirements",
        "preflight:category-requirements",
    )
    assert original == before

    with pytest.raises(FieldResolutionConflict, match="stale_version"):
        invalidate_category_dependencies(original, result["category"], expected_version=2)
