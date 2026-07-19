import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, NamedTuple, TypeAlias, assert_never


JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
ValidationCode: TypeAlias = Literal[
    "ok", "identifier_missing", "identifier_mismatch", "contract_version_unsupported", "capability_version_unsupported",
    "secret_key_forbidden", "field_status_invalid", "decision_rule_missing", "event_sequence_not_monotonic", "fingerprint_mismatch", "schema_invalid",
]
SchemaType: TypeAlias = Literal["array", "boolean", "integer", "null", "number", "object", "string"]


@dataclass(frozen=True, slots=True)
class ValidationResult:
    ok: bool
    code: ValidationCode
    path: str


@dataclass(frozen=True, slots=True)
class ValidationContext:
    reference_envelope: Mapping[str, JsonValue] | None = None
    previous_event_sequence: int | None = None
    expected_input_image_fingerprint: str | None = None


@dataclass(frozen=True, slots=True)
class ContractEnvironment:
    catalog: Mapping[str, JsonValue]
    schemas: Mapping[str, dict[str, JsonValue]]
    context: ValidationContext


class SchemaCursor(NamedTuple):
    path: str
    base: str
    environment: ContractEnvironment


def _failure(code: ValidationCode, path: str) -> ValidationResult: return ValidationResult(ok=False, code=code, path=path)


def _strings(value: JsonValue | None) -> tuple[str, ...]:
    match value:
        case list() as values: return tuple(item for item in values if type(item) is str)
        case str() as text: return (text,)
        case int() | float() | bool() | None | dict(): return ()
        case unreachable: assert_never(unreachable)


def _forbidden_key(value: JsonValue, environment: ContractEnvironment, path: str = "$") -> str | None:
    forbidden = {re.sub(r"[^a-z0-9]", "", key.lower()) for key in _strings(environment.catalog.get("forbiddenSecretKeyAliases"))}
    allowed = {re.sub(r"[^a-z0-9]", "", key.lower()) for key in _strings(environment.catalog.get("allowedSecretLikeKeys"))}
    match value:
        case dict() as mapping:
            for key, child in mapping.items():
                child_path = f"{path}.{key}"
                normalized = re.sub(r"[^a-z0-9]", "", key.lower())
                if any(secret in normalized for secret in forbidden) and normalized not in allowed:
                    return child_path
                nested = _forbidden_key(child, environment, child_path)
                if nested is not None:
                    return nested
            return None
        case list() as values:
            for index, child in enumerate(values):
                nested = _forbidden_key(child, environment, f"{path}[{index}]")
                if nested is not None:
                    return nested
            return None
        case str() | int() | float() | bool() | None:
            return None
        case unreachable:
            assert_never(unreachable)


def _schema_types(value: JsonValue | None) -> tuple[SchemaType, ...]:
    match value:
        case ("array" | "boolean" | "integer" | "null" | "number" | "object" | "string") as schema_type:
            return (schema_type,)
        case list() as values:
            return tuple(schema_type for item in values for schema_type in _schema_types(item))
        case str() | int() | float() | bool() | None | dict():
            return ()
        case unreachable:
            assert_never(unreachable)


def _matches_type(value: JsonValue, schema_type: SchemaType) -> bool:
    match schema_type:
        case "array": return type(value) is list
        case "boolean": return type(value) is bool
        case "integer": return type(value) is int
        case "null": return value is None
        case "number": return type(value) in (int, float)
        case "object": return type(value) is dict
        case "string": return type(value) is str
        case unreachable:
            assert_never(unreachable)


def _resolve_ref(reference: str, base: str, environment: ContractEnvironment) -> tuple[dict[str, JsonValue], str] | None:
    file_name, _, fragment = reference.partition("#")
    target_name = file_name or base
    target: JsonValue = environment.schemas.get(target_name)
    if target is None:
        return None
    for raw_part in fragment.removeprefix("/").split("/") if fragment else ():
        part = raw_part.replace("~1", "/").replace("~0", "~")
        match target:
            case dict() as mapping if part in mapping:
                target = mapping[part]
            case str() | int() | float() | bool() | None | list() | dict():
                return None
            case unreachable:
                assert_never(unreachable)
    match target:
        case dict() as schema:
            return schema, target_name
        case str() | int() | float() | bool() | None | list():
            return None
        case unreachable:
            assert_never(unreachable)


def _schema_error(value: JsonValue, schema: dict[str, JsonValue], cursor: SchemaCursor) -> str | None:
    path, base, environment = cursor.path, cursor.base, cursor.environment
    reference = schema.get("$ref")
    if type(reference) is str:
        resolved = _resolve_ref(reference, base, environment)
        return path if resolved is None else _schema_error(value, resolved[0], SchemaCursor(path, resolved[1], environment))
    alternatives = schema.get("anyOf")
    if type(alternatives) is list:
        for alternative in alternatives:
            if type(alternative) is dict and _schema_error(value, alternative, cursor) is None:
                return None
        return path
    types = _schema_types(schema.get("type"))
    if types and not any(_matches_type(value, schema_type) for schema_type in types):
        return path
    if "const" in schema and (value != schema["const"] or (type(value) is bool) != (type(schema["const"]) is bool)):
        return path
    enum_values = schema.get("enum")
    if type(enum_values) is list and not any(value == item and (type(value) is bool) == (type(item) is bool) for item in enum_values):
        return path
    match value:
        case str() as text:
            minimum_length, maximum_length = schema.get("minLength"), schema.get("maxLength")
            if (type(minimum_length) is int and len(text) < minimum_length) or (type(maximum_length) is int and len(text) > maximum_length):
                return path
            pattern = schema.get("pattern")
            return path if type(pattern) is str and re.fullmatch(pattern, text) is None else None
        case (int() | float()) as number if type(value) is not bool:
            minimum, maximum = schema.get("minimum"), schema.get("maximum")
            if type(minimum) in (int, float) and number < minimum:
                return path
            return path if type(maximum) in (int, float) and number > maximum else None
        case list() as values:
            minimum_items = schema.get("minItems")
            if type(minimum_items) is int and len(values) < minimum_items:
                return path
            item_schema = schema.get("items")
            if type(item_schema) is dict:
                for index, item in enumerate(values):
                    invalid = _schema_error(item, item_schema, SchemaCursor(f"{path}[{index}]", base, environment))
                    if invalid is not None:
                        return invalid
            return None
        case dict() as mapping:
            required, properties = schema.get("required"), schema.get("properties")
            if type(required) is list:
                for key in required:
                    if type(key) is str and key not in mapping:
                        return f"{path}.{key}"
            if type(properties) is dict:
                if schema.get("additionalProperties") is False:
                    for key in mapping:
                        if key not in properties:
                            return f"{path}.{key}"
                for key, child_schema in properties.items():
                    if key in mapping and type(child_schema) is dict:
                        invalid = _schema_error(mapping[key], child_schema, SchemaCursor(f"{path}.{key}", base, environment))
                        if invalid is not None:
                            return invalid
            return None
        case bool() | None:
            return None
        case unreachable:
            assert_never(unreachable)


def _proof_is_exact_one(value: JsonValue | None) -> bool:
    match value:
        case {"proofType": "validated-candidate-count", "validatedCandidateCount": int() as count, "evidenceRefs": list() as refs} if type(count) is int: return count == 1 and len(refs) > 0
        case str() | int() | float() | bool() | None | list() | dict(): return False
        case unreachable: assert_never(unreachable)


def _decision_error(document: dict[str, JsonValue], contract_type: str, environment: ContractEnvironment) -> str | None:
    if contract_type == "decision-point-registry":
        registered = set(_strings(document.get("registeredJudgeIds")))
        entries = document.get("entries")
        if type(entries) is list:
            for index, entry in enumerate(entries):
                if type(entry) is dict and entry.get("decisionMode") == "auto":
                    judge = entry.get("judgeId")
                    if not (type(judge) is str and judge in registered) and not _proof_is_exact_one(entry.get("exactOneProof")):
                        return f"$.entries[{index}]"
    if contract_type == "stage-policy-snapshot":
        rule = document.get("decisionRule")
        if type(rule) is dict and rule.get("decisionMode") == "auto":
            registered = set(_strings(environment.catalog.get("registeredJudgeIds")))
            judge = rule.get("judgeId")
            if not (type(judge) is str and judge in registered) and not _proof_is_exact_one(rule.get("exactOneProof")):
                return "$.decisionRule"
    return None


def _echo_error(document: dict[str, JsonValue], environment: ContractEnvironment) -> ValidationResult | None:
    context, reference = environment.context, environment.context.reference_envelope
    if reference is None:
        return _failure("identifier_missing", "$.referenceEnvelope")
    expected_fingerprint = context.expected_input_image_fingerprint
    if expected_fingerprint is None:
        return _failure("identifier_missing", "$.expectedInputImageFingerprint")
    if document.get("inputImageFingerprint") != expected_fingerprint:
        return _failure("fingerprint_mismatch", "$.inputImageFingerprint")
    for key in _strings(environment.catalog.get("identifierFields")):
        if key not in reference:
            return _failure("identifier_missing", f"$.referenceEnvelope.{key}")
        if key != "inputImageFingerprint" and document.get(key) != reference[key]:
            return _failure("identifier_mismatch", f"$.{key}")
    previous, sequence = context.previous_event_sequence, document.get("eventSequence")
    if previous is None:
        return _failure("identifier_missing", "$.previousEventSequence")
    if type(sequence) is not int or sequence <= 0 or sequence <= previous:
        return _failure("event_sequence_not_monotonic", "$.eventSequence")
    return None


def validate_contract(payload: JsonValue, environment: ContractEnvironment) -> ValidationResult:
    match payload:
        case dict() as document: pass
        case str() | int() | float() | bool() | None | list(): return _failure("schema_invalid", "$")
        case unreachable: assert_never(unreachable)
    if (forbidden_path := _forbidden_key(document, environment)) is not None:
        return _failure("secret_key_forbidden", forbidden_path)
    contract_version = document.get("contractVersion")
    if contract_version is None: return _failure("identifier_missing", "$.contractVersion")
    if contract_version not in _strings(environment.catalog.get("supportedContractVersions")):
        return _failure("contract_version_unsupported", "$.contractVersion")
    capability_version, capability_catalog = document.get("capabilityVersion"), environment.catalog.get("capabilityCatalog")
    if capability_version is None: return _failure("identifier_missing", "$.capabilityVersion")
    if type(capability_version) is not str or type(capability_catalog) is not dict or capability_version not in capability_catalog:
        return _failure("capability_version_unsupported", "$.capabilityVersion")
    contract_type = document.get("contractType")
    schemas = environment.catalog.get("contractSchemas")
    if type(contract_type) is not str or type(schemas) is not dict or contract_type not in schemas:
        return _failure("schema_invalid", "$.contractType")
    if contract_type == "work-order" or contract_type in _strings(environment.catalog.get("echoContractTypes")):
        for key in _strings(environment.catalog.get("identifierFields")):
            if key not in document or document[key] is None or document[key] == "":
                return _failure("identifier_missing", f"$.{key}")
    operation = document.get("operation")
    if contract_type == "work-order" and type(operation) is dict and type(operation.get("capability")) is str:
        if operation["capability"] not in _strings(capability_catalog[capability_version]):
            return _failure("capability_version_unsupported", "$.operation.capability")
    if contract_type == "field-record" and document.get("status") not in _strings(environment.catalog.get("fieldStatuses")):
        return _failure("field_status_invalid", "$.status")
    if (decision_path := _decision_error(document, contract_type, environment)) is not None:
        return _failure("decision_rule_missing", decision_path)
    if contract_type in _strings(environment.catalog.get("echoContractTypes")):
        echo_error = _echo_error(document, environment)
        if echo_error is not None:
            return echo_error
    schema_name = schemas[contract_type]
    if type(schema_name) is not str or schema_name not in environment.schemas:
        return _failure("schema_invalid", "$.contractType")
    invalid_path = _schema_error(document, environment.schemas[schema_name], SchemaCursor("$", schema_name, environment))
    return ValidationResult(ok=True, code="ok", path="$") if invalid_path is None else _failure("schema_invalid", invalid_path)
