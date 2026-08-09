from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from types import MappingProxyType
from typing import Final

from .field_resolver import FieldResolutionConflict
from .runtime_cache import JsonObject, JsonValue


CATEGORY_DEPENDENCY: Final = "category"
CATEGORY_OPTION_CONSUMER: Final = "options:category-requirements"
CATEGORY_PREFLIGHT_CONSUMER: Final = "preflight:category-requirements"
DEPENDENCY_REGISTRY: Final = MappingProxyType(
    {
        CATEGORY_DEPENDENCY: (
            CATEGORY_OPTION_CONSUMER,
            CATEGORY_PREFLIGHT_CONSUMER,
        ),
    },
)


def invalidate_category_dependencies(
    snapshot: Mapping[str, JsonValue],
    category: Mapping[str, JsonValue],
    *,
    expected_version: int,
) -> JsonObject:
    if snapshot.get("version") != expected_version:
        raise FieldResolutionConflict("stale_version")
    result = deepcopy(dict(snapshot))
    if snapshot.get("category") == dict(category):
        return result
    raw_fields = result.get("fields")
    fields = raw_fields if isinstance(raw_fields, dict) else {}
    invalidated: list[JsonValue] = []
    for field_id, raw_record in fields.items():
        if not isinstance(raw_record, dict):
            continue
        dependencies = raw_record.get("dependencies")
        if not isinstance(dependencies, list) or CATEGORY_DEPENDENCY not in dependencies:
            continue
        fields[field_id] = {
            **raw_record,
            "state": "unresolved",
            "value": None,
            "source": None,
            "confidence": 0.0,
            "evidenceRefs": [],
        }
        invalidated.append(f"field:{field_id}")
    raw_options = result.get("options")
    options = raw_options if isinstance(raw_options, dict) else {}
    result["options"] = {**options, "schemaState": "unresolved"}
    invalidated.append(DEPENDENCY_REGISTRY[CATEGORY_DEPENDENCY][0])
    raw_preflight = result.get("preflight")
    preflight = raw_preflight if isinstance(raw_preflight, dict) else {}
    result["preflight"] = {**preflight, "state": "unresolved"}
    invalidated.append(DEPENDENCY_REGISTRY[CATEGORY_DEPENDENCY][1])
    result["category"] = dict(category)
    result["version"] = expected_version + 1
    result["invalidatedConsumers"] = invalidated
    return result
