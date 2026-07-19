from __future__ import annotations

import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path

from control_tower.backend.contracts import (
    ContractEnvironment,
    ValidationContext,
    validate_contract,
)


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_digest(value) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _schema_registry(contracts_root: Path):
    return {
        path.name: _read_json(path)
        for path in sorted(contracts_root.glob("*.schema.json"))
    }


def _validation_context(case) -> ValidationContext:
    context = case.get("context") or {}
    return ValidationContext(
        reference_envelope=context.get("referenceEnvelope"),
        previous_event_sequence=context.get("previousEventSequence"),
        expected_input_image_fingerprint=context.get("expectedInputImageFingerprint"),
    )


def _evaluate_case(case, catalog, schemas):
    state = deepcopy(case.get("stateBefore"))
    before = _canonical_digest(state) if state is not None else None
    environment = ContractEnvironment(
        catalog=catalog,
        schemas=schemas,
        context=_validation_context(case),
    )
    result = validate_contract(case.get("payload"), environment)
    if result.ok and state is not None:
        state.update(deepcopy(case.get("mutationIfAccepted") or {}))
    after = _canonical_digest(state) if state is not None else None
    expected = case["expected"]
    matched = (
        result.ok == expected["ok"]
        and result.code == expected["code"]
        and result.path == expected["path"]
    )
    return {
        "name": case["name"],
        "ok": result.ok,
        "code": result.code,
        "path": result.path,
        "matched": matched,
        "stateDigestBefore": before,
        "stateDigestAfter": after,
    }


def main() -> int:
    fixtures_root = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).parent / "fixtures"
    repository_root = Path(__file__).resolve().parents[3]
    contracts_root = repository_root / "control_tower" / "contracts" / "v1"
    catalog = _read_json(contracts_root / "version-catalog.json")
    schemas = _schema_registry(contracts_root)
    cases = [
        case
        for fixture_path in sorted(fixtures_root.glob("*.fixture.json"))
        for case in _read_json(fixture_path)["cases"]
    ]
    results = [_evaluate_case(case, catalog, schemas) for case in cases]
    batch_case = next(case for case in cases if case["name"] == "valid_two_product_batch")
    stale = next(result for result in results if result["name"] == "stale_event_fingerprint")
    report = {
        "validator": "python",
        "allMatched": all(result["matched"] for result in results),
        "validProductCount": len(batch_case["payload"]["products"]),
        "staleReplayRejected": (
            stale["ok"] is False
            and stale["stateDigestBefore"] == stale["stateDigestAfter"]
        ),
        "results": results,
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0 if report["allMatched"] and report["staleReplayRejected"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
