from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, assert_never

from .policy import PolicyError, validate_policy_snapshot

class RetryClass(StrEnum):
    RETRYABLE = "retryable"
    MANUAL = "manual"
    FATAL = "fatal"


class SchedulerConflict(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class ConveyorConflict(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class StageSpec:
    stage_id: str
    weight: int
    factory_bound: bool


@dataclass(frozen=True, slots=True)
class WorkDecision:
    product_id: str
    stage_id: str


class ProductState:
    __slots__ = ("product_id", "current_stage", "status", "completed", "terminal")

    def __init__(self, product_id: str, current_stage: str, status: str) -> None:
        self.product_id = product_id
        self.current_stage = current_stage
        self.status = status
        self.completed: set[str] = set()
        self.terminal = False


STAGES: Final = (
    StageSpec("validation", 5, False),
    StageSpec("candidate_collect", 8, False),
    StageSpec("required_fields", 8, False),
    StageSpec("competitor_collect", 8, False),
    StageSpec("detail_collect", 8, False),
    StageSpec("representative", 10, True),
    StageSpec("size", 8, True),
    StageSpec("option_images", 8, True),
    StageSpec("general_images", 8, True),
    StageSpec("section_select", 8, True),
    StageSpec("final_detail", 8, True),
    StageSpec("preflight", 6, False),
    StageSpec("cafe24_staging", 7, True),
)
STAGE_BY_ID: Final = {stage.stage_id: stage for stage in STAGES}
DEFAULT_POLICY: Final = {
    "representative": "auto",
    "size": "auto",
    "option_images": "auto",
    "general_images": "auto",
    "section_select": "auto",
    "final_detail": "auto",
}
DECISIONS_BY_STAGE: Final = {
    "candidate_collect": ("sinhwa_db_product", "cafe24_product"),
    "required_fields": ("required_field_candidate",),
    "competitor_collect": (
        "competitor_coupang",
        "competitor_smartstore",
        "competitor_gmarket",
        "competitor_auction",
        "competitor_elevenst",
    ),
    "representative": ("representative_image",),
    "size": ("size_image",),
    "option_images": ("option_image",),
    "general_images": ("general_image",),
    "section_select": ("section_variant",),
    "final_detail": ("final_detail",),
}


def resolve_policy(
    stage: Mapping[str, str],
    product: Mapping[str, str],
    batch: Mapping[str, str],
    default: Mapping[str, str],
) -> dict[str, str]:
    keys = set(default) | set(batch) | set(product) | set(stage)
    return {
        key: stage[key] if key in stage else product[key] if key in product else batch[key] if key in batch else default[key]
        for key in keys
    }


def classify_failure(reason: str) -> RetryClass:
    match reason:
        case "timeout" | "network" | "rate_limit" | "server_error":
            return RetryClass.RETRYABLE
        case "authentication" | "captcha" | "manual_required" | "blocked_external":
            return RetryClass.MANUAL
        case "validation" | "fingerprint_mismatch" | "stale_version":
            return RetryClass.FATAL
        case str():
            return RetryClass.MANUAL
        case unreachable:
            assert_never(unreachable)


class Scheduler:
    def __init__(self) -> None:
        self._products: dict[str, ProductState] = {}
        self._active_factory_product: str | None = None

    def add_product(self, product_id: str, *, current_stage: str, status: str) -> None:
        if product_id in self._products or current_stage not in STAGE_BY_ID:
            raise SchedulerConflict("product_or_stage_invalid")
        self._products[product_id] = ProductState(product_id, current_stage, status)

    def next_work(self) -> WorkDecision | None:
        for state in self._products.values():
            if state.status not in {"queued", "running"} or state.terminal:
                continue
            stage = STAGE_BY_ID[state.current_stage]
            if stage.factory_bound and self._active_factory_product not in {None, state.product_id}:
                continue
            return WorkDecision(state.product_id, stage.stage_id)
        return None

    def claim(self, product_id: str) -> WorkDecision | None:
        state = self._products.get(product_id)
        if state is None or state.status not in {"queued", "running"} or state.terminal:
            return None
        stage = STAGE_BY_ID[state.current_stage]
        if stage.factory_bound and self._active_factory_product not in {None, product_id}:
            return None
        state.status = "running"
        if stage.factory_bound:
            self._active_factory_product = product_id
        return WorkDecision(product_id, stage.stage_id)

    def release(self, product_id: str, *, status: str) -> None:
        state = self._products.get(product_id)
        if state is None:
            raise SchedulerConflict("product_missing")
        state.status = status
        if self._active_factory_product == product_id:
            self._active_factory_product = None

    def complete_stage(self, product_id: str, stage_id: str) -> None:
        state = self._products.get(product_id)
        if state is None or stage_id != state.current_stage and stage_id != "staged_verified":
            raise SchedulerConflict("checkpoint_stale")
        if stage_id == "staged_verified":
            state.terminal = True
            state.status = "staged_verified"
            self._active_factory_product = None
            return
        state.completed.add(stage_id)
        index = next(index for index, stage in enumerate(STAGES) if stage.stage_id == stage_id)
        if index + 1 < len(STAGES):
            state.current_stage = STAGES[index + 1].stage_id
            state.status = "queued"
        else:
            state.status = "queued"
        if self._active_factory_product == product_id:
            self._active_factory_product = None

    def progress(self, product_id: str) -> int:
        state = self._products.get(product_id)
        if state is None:
            raise SchedulerConflict("product_missing")
        total = sum(stage.weight for stage in STAGES)
        completed = sum(stage.weight for stage in STAGES if stage.stage_id in state.completed)
        return 100 if state.terminal else min(99, completed * 100 // total)


def _identity_digest(identity: Mapping[str, object]) -> str:
    required = {
        key: identity.get(key)
        for key in ("productId", "productKey", "runId", "inputFingerprint", "revision")
    }
    if any(value in {None, ""} for value in required.values()):
        raise ConveyorConflict("stale_run_fingerprint")
    return hashlib.sha256(
        json.dumps(
            required,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8"),
    ).hexdigest()


def run_full_auto_product(
    *,
    identity: Mapping[str, object],
    policy_snapshot: Mapping[str, object],
    candidates_by_decision: Mapping[str, list[Mapping[str, object]]],
    decide,
    execute_stage,
    approval: Mapping[str, object],
    execute_cafe24,
    checkpoint: Mapping[str, object] | None = None,
) -> dict[str, object]:
    try:
        validate_policy_snapshot(policy_snapshot)
    except PolicyError as error:
        raise ConveyorConflict(error.code) from error
    digest = _identity_digest(identity)
    start_index = 0
    if checkpoint is not None:
        if checkpoint.get("identityDigest") != digest:
            raise ConveyorConflict("stale_run_fingerprint")
        raw_index = checkpoint.get("nextStageIndex", 0)
        if not isinstance(raw_index, int) or not 0 <= raw_index < len(STAGES):
            raise ConveyorConflict("checkpoint_stale")
        start_index = raw_index
    resolved = policy_snapshot.get("resolved")
    policy = resolved if isinstance(resolved, dict) else {}
    events: list[dict[str, object]] = []
    completed_weight = sum(stage.weight for stage in STAGES[:start_index])
    total_weight = sum(stage.weight for stage in STAGES)

    def current_checkpoint(index: int) -> dict[str, object]:
        return {
            "schema": "full-auto-checkpoint:v1",
            "identityDigest": digest,
            "policySnapshotId": policy_snapshot["snapshotId"],
            "nextStageIndex": index,
            "nextStage": STAGES[index].stage_id,
        }

    for index in range(start_index, len(STAGES)):
        stage = STAGES[index]
        if stage.stage_id == "cafe24_staging":
            token = approval.get("approvalToken")
            if not isinstance(token, str) or not token:
                return {
                    "status": "approval_required",
                    "percent": min(99, completed_weight * 100 // total_weight),
                    "released": True,
                    "events": events,
                    "checkpoint": current_checkpoint(index),
                }
            for key in ("productId", "productKey", "runId", "inputFingerprint", "revision"):
                if approval.get(key) != identity.get(key):
                    raise ConveyorConflict("approval_binding_mismatch")
            publication = execute_cafe24(dict(approval))
            if not isinstance(publication, dict) or publication.get("status") != "staged_verified":
                return {
                    "status": "failed",
                    "percent": min(99, completed_weight * 100 // total_weight),
                    "released": True,
                    "events": events,
                    "checkpoint": current_checkpoint(index),
                }
            events.append({"stage": stage.stage_id, "status": "staged_verified", "percent": 100})
            return {
                "status": "staged_verified",
                "percent": 100,
                "released": True,
                "events": events,
                "publicationReceipt": dict(publication),
            }

        stage_result = execute_stage(
            stage.stage_id,
            {
                "identity": dict(identity),
                "policySnapshot": dict(policy_snapshot),
            },
        )
        if not isinstance(stage_result, dict) or stage_result.get("status") != "completed":
            return {
                "status": "failed",
                "percent": min(99, completed_weight * 100 // total_weight),
                "released": True,
                "events": events,
                "checkpoint": current_checkpoint(index),
            }
        for decision in DECISIONS_BY_STAGE.get(stage.stage_id, ()):
            if decision not in policy:
                continue
            if policy[decision] == "manual":
                return {
                    "status": "waiting_manual",
                    "decisionType": decision,
                    "percent": min(99, completed_weight * 100 // total_weight),
                    "released": True,
                    "events": events,
                    "checkpoint": current_checkpoint(index),
                }
            decision_result = decide(
                decision,
                candidates_by_decision.get(decision, []),
            )
            if (
                not isinstance(decision_result, dict)
                or decision_result.get("status") != "selected"
            ):
                return {
                    "status": "waiting_manual",
                    "decisionType": decision,
                    "percent": min(99, completed_weight * 100 // total_weight),
                    "released": True,
                    "events": events,
                    "checkpoint": current_checkpoint(index),
                }
        completed_weight += stage.weight
        events.append(
            {
                "stage": stage.stage_id,
                "status": "completed",
                "percent": min(99, completed_weight * 100 // total_weight),
            },
        )
    raise ConveyorConflict("checkpoint_stale")
