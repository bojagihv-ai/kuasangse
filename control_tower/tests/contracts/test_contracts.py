from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import assert_never


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACTS_ROOT = REPOSITORY_ROOT / "control_tower" / "contracts" / "v1"
PYTHON_VALIDATOR = REPOSITORY_ROOT / "control_tower" / "backend" / "contracts.py"
NODE_VALIDATOR = REPOSITORY_ROOT / "control_tower" / "frontend" / "src" / "contracts.mjs"
PYTHON = REPOSITORY_ROOT / "backend" / "venv311" / "Scripts" / "python.exe"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
FACTORY_SOURCE = REPOSITORY_ROOT / "src" / "app-core-03.js"

REQUIRED_SCHEMAS = {
    "artifact-manifest.schema.json",
    "batch-manifest.schema.json",
    "cafe24-category-requirements.schema.json",
    "cafe24-staging-receipt.schema.json",
    "common.schema.json",
    "decision-point-registry.schema.json",
    "field-record.schema.json",
    "product-manifest.schema.json",
    "result-manifest.schema.json",
    "review-task.schema.json",
    "stage-policy-snapshot.schema.json",
    "state-transition-record.schema.json",
    "state-transition-table.schema.json",
    "work-order.schema.json",
    "worker-ack.schema.json",
    "worker-event.schema.json",
    "worker-result.schema.json",
}
REQUIRED_ENVELOPE_KEYS = {
    "attempt",
    "batchId",
    "capabilityVersion",
    "commandId",
    "contractVersion",
    "currentRunId",
    "deadlineAt",
    "expectedWorkfileRevision",
    "idempotencyKey",
    "inputImageFingerprint",
    "issuedAt",
    "operationToken",
    "productId",
    "productKey",
    "stageId",
    "workspaceId",
}
REQUIRED_ERROR_CODES = {
    "capability_version_unsupported",
    "contract_version_unsupported",
    "decision_rule_missing",
    "event_sequence_not_monotonic",
    "field_status_invalid",
    "fingerprint_mismatch",
    "identifier_mismatch",
    "identifier_missing",
    "schema_invalid",
    "secret_key_forbidden",
}
TRANSITION_FIELDS = {
    "attempt",
    "cancellation",
    "casPrerequisite",
    "from",
    "occurredAt",
    "owner",
    "reason",
    "restartBehavior",
    "terminal",
    "to",
}


def _run_python_fixture_cli() -> dict[str, int | bool | str | list[dict[str, int | bool | str | None]]]:
    completed = subprocess.run(
        [
            str(PYTHON),
            "-m",
            "control_tower.tests.contracts.run_python_fixtures",
            str(FIXTURES),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    return json.loads(completed.stdout)


def _assert_closed_objects(node: dict | list | str | int | float | bool | None, path: str = "$") -> None:
    match node:
        case dict() as mapping:
            if mapping.get("type") == "object":
                assert mapping.get("additionalProperties") is False, path
            for key, value in mapping.items():
                _assert_closed_objects(value, f"{path}.{key}")
        case list() as values:
            for index, value in enumerate(values):
                _assert_closed_objects(value, f"{path}[{index}]")
        case str() | int() | float() | bool() | None:
            return
        case unreachable:
            assert_never(unreachable)


def test_contract_schemas_are_closed_draft_2020_12_documents() -> None:
    # Given: Task 2 requires one catalog and a named schema for every contract surface.
    assert PYTHON_VALIDATOR.exists(), f"implementation missing: {PYTHON_VALIDATOR}"
    assert NODE_VALIDATOR.exists(), f"implementation missing: {NODE_VALIDATOR}"

    # When: the version catalog and schema directory are inspected as shipped artifacts.
    actual_names = {path.name for path in CONTRACTS_ROOT.glob("*.schema.json")}
    catalog = json.loads((CONTRACTS_ROOT / "version-catalog.json").read_text(encoding="utf-8"))
    common = json.loads((CONTRACTS_ROOT / "common.schema.json").read_text(encoding="utf-8"))

    # Then: every required schema is Draft 2020-12, closed, and cataloged.
    assert actual_names == REQUIRED_SCHEMAS
    assert set(catalog["contractSchemas"].values()) == REQUIRED_SCHEMAS - {"common.schema.json"}
    assert set(catalog["identifierFields"]) == REQUIRED_ENVELOPE_KEYS
    assert set(common["$defs"]["workOrderEnvelope"]["required"]) == REQUIRED_ENVELOPE_KEYS
    for schema_path in CONTRACTS_ROOT.glob("*.schema.json"):
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
        _assert_closed_objects(schema, schema_path.name)


def test_python_validator_matches_every_shared_fixture() -> None:
    # Given: both implementation files exist and the shared fixtures carry expected triples.
    assert PYTHON_VALIDATOR.exists(), f"implementation missing: {PYTHON_VALIDATOR}"
    assert NODE_VALIDATOR.exists(), f"implementation missing: {NODE_VALIDATOR}"

    # When: a user runs the Python validator over the fixture directory.
    report = _run_python_fixture_cli()

    # Then: all cases match, two normal products pass, and every stable error is exercised.
    assert report["allMatched"] is True
    assert report["validProductCount"] == 2
    assert report["staleReplayRejected"] is True
    results = report["results"]
    assert isinstance(results, list)
    assert REQUIRED_ERROR_CODES <= {str(result["code"]) for result in results}


def test_stale_event_replay_is_rejected_without_state_mutation() -> None:
    # Given: the shared suite includes a stale event and a candidate state mutation.
    assert PYTHON_VALIDATOR.exists(), f"implementation missing: {PYTHON_VALIDATOR}"

    # When: the stale event is replayed through the real fixture runner.
    report = _run_python_fixture_cli()
    stale = next(result for result in report["results"] if result["name"] == "stale_event_fingerprint")

    # Then: the validator rejects it and the canonical state digest is byte-identical.
    assert stale["ok"] is False
    assert stale["code"] == "fingerprint_mismatch"
    assert stale["stateDigestBefore"] == stale["stateDigestAfter"]


def test_capability_catalog_and_boundary_fixtures_are_explicit() -> None:
    # Given: the gate requires named capabilities and both identifier length boundaries.
    catalog = json.loads((CONTRACTS_ROOT / "version-catalog.json").read_text(encoding="utf-8"))
    cases = [
        case
        for fixture_path in FIXTURES.glob("*.fixture.json")
        for case in json.loads(fixture_path.read_text(encoding="utf-8"))["cases"]
    ]
    cases_by_name = {case["name"]: case for case in cases}

    # When: catalog membership and independent fixture oracles are inspected.
    boundary_256 = cases_by_name["identifier_exactly_256_characters"]
    boundary_257 = cases_by_name["identifier_257_characters"]

    # Then: the capability/version pair and exact failure paths are explicit.
    assert catalog["capabilityCatalog"] == {"1.0.0": ["image-generate"]}
    assert cases_by_name["unknown_contract_type"]["expected"] == {
        "ok": False, "code": "schema_invalid", "path": "$.contractType",
    }
    assert cases_by_name["unknown_operation_capability"]["expected"] == {
        "ok": False, "code": "capability_version_unsupported", "path": "$.operation.capability",
    }
    assert len(boundary_256["payload"]["fieldId"]) == 256
    assert boundary_256["expected"] == {"ok": True, "code": "ok", "path": "$"}
    assert len(boundary_257["payload"]["fieldId"]) == 257
    assert boundary_257["expected"] == {"ok": False, "code": "schema_invalid", "path": "$.fieldId"}


def test_all_five_state_transition_tables_have_complete_records() -> None:
    # Given: every state kind needs a real table, not only a catalog string.
    cases = [
        case
        for fixture_path in FIXTURES.glob("*.fixture.json")
        for case in json.loads(fixture_path.read_text(encoding="utf-8"))["cases"]
    ]

    # When: all valid state-transition-table fixtures are collected.
    tables = [
        case["payload"]
        for case in cases
        if case["name"].startswith("valid_") and case["payload"].get("contractType") == "state-transition-table"
    ]

    # Then: all five kinds have owned, fully modeled transition records.
    assert {table["stateKind"] for table in tables} == {"batch", "product", "stage", "review", "registration"}
    for table in tables:
        assert table["owner"]
        assert table["allowedTransitions"]
        for transition in table["allowedTransitions"]:
            assert set(transition) == TRANSITION_FIELDS


def test_current_factory_fields_are_registered_in_compatibility_fixture() -> None:
    # Given: app-core-03 is the protected source of the current factory field IDs.
    source = FACTORY_SOURCE.read_text(encoding="utf-8")
    factory_section = source.split("const FACTORY_SINHWA_FIELD_SECTIONS = [", 1)[1].split("const FACTORY_STAGE_STATUS_LABELS", 1)[0]
    current_field_ids = set(re.findall(r"\bid: '([^']+)'", factory_section))
    compatibility = json.loads((FIXTURES / "compatibility.fixture.json").read_text(encoding="utf-8"))["cases"][0]["payload"]

    # When: compatibility field entries are compared with that source.
    registered_field_ids = {entry["entryId"] for entry in compatibility["entries"] if entry["kind"] == "field"}

    # Then: the concurrent category, purchase-price, and option-count fields are covered.
    assert {"category", "purchase_price", "option_count"} <= registered_field_ids
    assert current_field_ids <= registered_field_ids
