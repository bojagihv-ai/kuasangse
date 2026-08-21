from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Final

from .runtime_cache import JsonObject


class PolicyError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


COMPETITOR_MARKETS: Final = ("coupang", "smartstore", "gmarket", "auction", "elevenst")
DECISION_POINT_IDS: Final = (
    "sinhwa_db_product",
    "cafe24_product",
    "competitor_product",
    *(f"competitor_{market}" for market in COMPETITOR_MARKETS),
    "required_field_candidate",
    "representative_image",
    "size_image",
    "option_image",
    "general_image",
    "section_variant",
    "final_detail",
)
POLICY_MODES: Final = frozenset({"auto", "manual"})
POLICY_PRESETS: Final = {
    "full_auto": {decision: "auto" for decision in DECISION_POINT_IDS},
    "representative_manual": {decision: "auto" for decision in DECISION_POINT_IDS} | {"representative_image": "manual"},
    "representative_and_size_manual": {decision: "auto" for decision in DECISION_POINT_IDS} | {"representative_image": "manual", "size_image": "manual"},
    "all_images_manual": {decision: "auto" for decision in DECISION_POINT_IDS}
    | {"representative_image": "manual", "size_image": "manual", "option_image": "manual", "general_image": "manual"},
}


def _validate_override(source: Mapping[str, str]) -> None:
    for decision, mode in source.items():
        if decision not in DECISION_POINT_IDS:
            raise PolicyError("policy_decision_unknown")
        if mode not in POLICY_MODES:
            raise PolicyError("policy_mode_invalid")


def _snapshot_digest(value: JsonObject) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_policy_snapshot(snapshot: Mapping[str, object]) -> None:
    if set(snapshot) != {
        "snapshotVersion",
        "batchId",
        "productId",
        "preset",
        "resolved",
        "effectiveSources",
        "precedence",
        "locked",
        "snapshotId",
    }:
        raise PolicyError("policy_snapshot_invalid")
    snapshot_id = snapshot.get("snapshotId")
    if snapshot.get("locked") is not True or not isinstance(snapshot_id, str):
        raise PolicyError("policy_snapshot_unlocked")
    resolved = snapshot.get("resolved")
    effective_sources = snapshot.get("effectiveSources")
    if (
        snapshot.get("snapshotVersion") != 2
        or not isinstance(snapshot.get("batchId"), str)
        or not str(snapshot["batchId"]).strip()
        or not isinstance(snapshot.get("productId"), str)
        or not str(snapshot["productId"]).strip()
        or snapshot.get("preset") not in {*POLICY_PRESETS, "custom"}
        or not isinstance(resolved, dict)
        or set(resolved) != set(DECISION_POINT_IDS)
        or any(mode not in POLICY_MODES for mode in resolved.values())
        or not isinstance(effective_sources, dict)
        or set(effective_sources) != set(DECISION_POINT_IDS)
        or any(
            source not in {"stage", "product", "batch", "batch_preset", "auto_default"}
            for source in effective_sources.values()
        )
        or snapshot.get("precedence") != ["stage", "product", "batch", "batch_preset", "auto_default"]
    ):
        raise PolicyError("policy_snapshot_invalid")
    unsigned = dict(snapshot)
    del unsigned["snapshotId"]
    if snapshot_id != f"policy:{_snapshot_digest(unsigned)}":
        raise PolicyError("policy_snapshot_tampered")


def build_policy_snapshot(
    batch_id: str,
    product_id: str,
    preset: str,
    batch_override: Mapping[str, str],
    product_override: Mapping[str, str],
    stage_override: Mapping[str, str],
) -> JsonObject:
    _validate_override(batch_override)
    _validate_override(product_override)
    _validate_override(stage_override)
    if preset not in POLICY_PRESETS:
        if preset != "custom":
            raise PolicyError("policy_preset_invalid")
        base = dict(POLICY_PRESETS["full_auto"])
    else:
        base = dict(POLICY_PRESETS[preset])
    resolved: dict[str, str] = {}
    effective_sources: dict[str, str] = {}
    for decision in DECISION_POINT_IDS:
        if decision in stage_override:
            resolved[decision] = stage_override[decision]
            effective_sources[decision] = "stage"
        elif decision in product_override:
            resolved[decision] = product_override[decision]
            effective_sources[decision] = "product"
        elif decision in batch_override:
            resolved[decision] = batch_override[decision]
            effective_sources[decision] = "batch"
        else:
            resolved[decision] = base[decision]
            effective_sources[decision] = (
                "batch_preset" if preset in POLICY_PRESETS else "auto_default"
            )
    snapshot: JsonObject = {
        "snapshotVersion": 2,
        "batchId": batch_id,
        "productId": product_id,
        "preset": preset,
        "resolved": resolved,
        "effectiveSources": effective_sources,
        "precedence": ["stage", "product", "batch", "batch_preset", "auto_default"],
        "locked": True,
    }
    return {
        **snapshot,
        "snapshotId": f"policy:{_snapshot_digest(snapshot)}",
    }
