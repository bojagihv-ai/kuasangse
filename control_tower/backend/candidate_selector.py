from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Callable, Final

from .gpt_oauth import normalize_decision_type
from .policy import PolicyError, validate_policy_snapshot
from .runtime_cache import JsonObject, JsonValue


AUTO_THRESHOLDS: Final = {
    "sameProductLikelihood": 0.80,
    "taskSuitability": 0.70,
    "quality": 0.60,
    "confidence": 0.75,
    "scoreGap": 0.10,
}


class CandidateSelectionError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class SelectionResult:
    status: str
    decision_type: str
    candidate_id: str | None
    reason: str
    exact_one_proof: JsonObject | None
    receipt: JsonObject | None


def _deduplicate(candidates: Sequence[Mapping[str, JsonValue]]) -> list[Mapping[str, JsonValue]]:
    result: list[Mapping[str, JsonValue]] = []
    seen_keys: set[str] = set()
    for candidate in candidates:
        candidate_id = str(candidate.get("candidateId", "")).strip()
        identity_key = str(candidate.get("identityKey", candidate_id)).strip()
        content_digest = str(candidate.get("contentDigest", "")).strip()
        if not candidate_id or not identity_key or not content_digest:
            raise CandidateSelectionError("candidate_identity_invalid")
        key = f"{identity_key}:{content_digest}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        result.append(candidate)
    return result


def select_candidates(
    decision_type: str,
    candidates: Sequence[Mapping[str, JsonValue]],
    *,
    decision_mode: str = "auto",
    judgement: Mapping[str, JsonValue] | None = None,
) -> SelectionResult:
    try:
        decision_type = normalize_decision_type(decision_type)
    except Exception as exc:
        raise CandidateSelectionError("decision_type_invalid") from exc
    if decision_mode not in {"auto", "manual"}:
        raise CandidateSelectionError("decision_mode_invalid")
    unique = _deduplicate(candidates)
    if decision_mode == "manual":
        return SelectionResult("manual_required", decision_type, None, "policy_manual", None, None)
    if not unique:
        return SelectionResult("manual_required", decision_type, None, "candidate_empty", None, None)
    if len(unique) == 1:
        candidate_id = str(unique[0]["candidateId"])
        proof = {"proofType": "validated-candidate-count", "validatedCandidateCount": 1, "evidenceRefs": [candidate_id]}
        return SelectionResult("selected", decision_type, candidate_id, "exactly_one_valid_candidate", proof, None)
    if judgement is None:
        return SelectionResult("manual_required", decision_type, None, "judge_receipt_missing", None, None)
    selected = judgement.get("selectedCandidateId")
    ids = {str(item["candidateId"]) for item in unique}
    if judgement.get("decision") != "selected" or not isinstance(selected, str) or selected not in ids:
        return SelectionResult("manual_required", decision_type, None, "judge_manual_or_unknown_candidate", None, dict(judgement))
    scores = judgement.get("scores")
    if not isinstance(scores, dict):
        return SelectionResult("manual_required", decision_type, None, "judge_scores_missing", None, dict(judgement))
    risk_flags = judgement.get("riskFlags", [])
    score_gap = judgement.get("scoreGap")
    if (
        not isinstance(judgement.get("confidence"), (int, float))
        or float(judgement["confidence"]) < AUTO_THRESHOLDS["confidence"]
        or not isinstance(scores.get("sameProductLikelihood"), (int, float))
        or float(scores["sameProductLikelihood"]) < AUTO_THRESHOLDS["sameProductLikelihood"]
        or not isinstance(scores.get("taskSuitability"), (int, float))
        or float(scores["taskSuitability"]) < AUTO_THRESHOLDS["taskSuitability"]
        or not isinstance(scores.get("quality"), (int, float))
        or float(scores["quality"]) < AUTO_THRESHOLDS["quality"]
        or not isinstance(score_gap, (int, float))
        or float(score_gap) < AUTO_THRESHOLDS["scoreGap"]
        or not isinstance(risk_flags, list)
        or any("conflict" in str(item).casefold() for item in risk_flags)
    ):
        return SelectionResult("manual_required", decision_type, None, "threshold_or_conflict", None, dict(judgement))
    return SelectionResult("selected", decision_type, selected, "judgement_thresholds_passed", None, dict(judgement))


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8"),
    ).hexdigest()


def _identity_value(identity: Mapping[str, JsonValue], key: str) -> JsonValue:
    value = identity.get(key)
    if value in {None, ""}:
        raise CandidateSelectionError(f"decision_identity_{key}_missing")
    return value


def _receipt(
    *,
    decision_type: str,
    candidates: Sequence[Mapping[str, JsonValue]],
    identity: Mapping[str, JsonValue],
    policy_snapshot: Mapping[str, JsonValue],
    selected_candidate_id: str | None,
    decision_method: str,
    rationale: str,
    hold_reason: str,
    judge_receipts: Sequence[Mapping[str, JsonValue]],
) -> JsonObject:
    candidate_digests = {
        str(candidate["candidateId"]): str(candidate["contentDigest"])
        for candidate in candidates
    }
    first = dict(judge_receipts[0]) if judge_receipts else {}
    judgement = first.get("judgement")
    judgement_record = judgement if isinstance(judgement, dict) else {}
    receipt: JsonObject = {
        "schema": "gpt-judgment-receipt:v1",
        "decisionType": decision_type,
        "decisionMethod": decision_method,
        "candidateSetDigest": _digest(candidate_digests),
        "candidateDigests": candidate_digests,
        "selectedCandidateId": selected_candidate_id,
        "rationale": rationale,
        "model": str(first.get("model") or "deterministic"),
        "reasoningEffort": str(first.get("reasoningEffort") or "none"),
        "serviceTier": str(first.get("serviceTier") or "none"),
        "preset": str(first.get("preset") or "exact_one"),
        "confidence": judgement_record.get("confidence", 1.0 if selected_candidate_id else 0.0),
        "threshold": dict(AUTO_THRESHOLDS),
        "holdReason": hold_reason,
        "policySnapshotId": str(policy_snapshot.get("snapshotId") or ""),
        "policySource": str(
            (
                policy_snapshot.get("effectiveSources")
                if isinstance(policy_snapshot.get("effectiveSources"), dict)
                else {}
            ).get(decision_type)
            or ""
        ),
        "productId": _identity_value(identity, "productId"),
        "productKey": _identity_value(identity, "productKey"),
        "runId": _identity_value(identity, "runId"),
        "inputFingerprint": _identity_value(identity, "inputFingerprint"),
        "revision": _identity_value(identity, "revision"),
        "eventId": _identity_value(identity, "eventId"),
        "reviewCount": len(judge_receipts),
        "reviewDigests": [_digest(dict(item)) for item in judge_receipts],
    }
    receipt["receiptId"] = f"judgment:{_digest(receipt)}"
    return receipt


def decide_candidates(
    decision_type: str,
    candidates: Sequence[Mapping[str, JsonValue]],
    *,
    identity: Mapping[str, JsonValue],
    policy_snapshot: Mapping[str, JsonValue],
    judge: Any,
    input_refs: Sequence[Mapping[str, JsonValue]] = (),
    model: str = "latestModel",
    reasoning_effort: str = "medium",
    service_tier: str = "standard",
    preset: str = "fast_single",
    persist: Callable[[str, JsonObject], Mapping[str, JsonValue]] | None = None,
) -> SelectionResult:
    try:
        validate_policy_snapshot(policy_snapshot)
    except PolicyError as error:
        raise CandidateSelectionError(error.code) from error
    normalized_type = normalize_decision_type(decision_type)
    resolved = policy_snapshot.get("resolved")
    source_modes = resolved if isinstance(resolved, dict) else {}
    decision_mode = str(source_modes.get(decision_type, source_modes.get(normalized_type, "auto")))
    unique = _deduplicate(candidates)
    base = select_candidates(normalized_type, unique, decision_mode=decision_mode)
    judge_receipts: list[Mapping[str, JsonValue]] = []
    if base.status == "selected":
        result = base
        method = "deterministic_single_candidate"
        rationale = "Exactly one validated candidate; GPT OAuth call skipped."
        hold_reason = ""
    elif base.reason in {"policy_manual", "candidate_empty"}:
        result = base
        method = "manual_policy"
        rationale = base.reason
        hold_reason = base.reason
    else:
        review_count = 2 if preset == "dual_review" else 1
        for _review_index in range(review_count):
            response = judge.judge(
                decision_type=normalized_type,
                input_refs=input_refs,
                candidates=unique,
                model=model,
                reasoning_effort=reasoning_effort,
                service_tier=service_tier,
                preset=preset,
            )
            raw_receipt = response.get("receipt") if isinstance(response, dict) else None
            if not isinstance(raw_receipt, dict) or not isinstance(raw_receipt.get("judgement"), dict):
                raise CandidateSelectionError("judge_receipt_invalid")
            judge_receipts.append(raw_receipt)
        first_judgement = judge_receipts[0]["judgement"]
        assert isinstance(first_judgement, dict)
        if len(judge_receipts) == 2:
            second_judgement = judge_receipts[1]["judgement"]
            assert isinstance(second_judgement, dict)
            if (
                first_judgement.get("decision") != second_judgement.get("decision")
                or first_judgement.get("selectedCandidateId")
                != second_judgement.get("selectedCandidateId")
            ):
                result = SelectionResult(
                    "manual_required",
                    normalized_type,
                    None,
                    "dual_review_disagreement",
                    None,
                    None,
                )
            else:
                first_result = select_candidates(
                    normalized_type,
                    unique,
                    judgement=first_judgement,
                )
                second_result = select_candidates(
                    normalized_type,
                    unique,
                    judgement=second_judgement,
                )
                result = (
                    first_result
                    if first_result.status != "selected"
                    else second_result
                    if second_result.status != "selected"
                    else first_result
                )
        else:
            result = select_candidates(
                normalized_type,
                unique,
                judgement=first_judgement,
            )
        method = "gpt_oauth_dual_review" if review_count == 2 else "gpt_oauth_single_review"
        rationale = (
            str(first_judgement.get("rationale") or result.reason)
            if result.status == "selected"
            else result.reason
        )
        hold_reason = "" if result.status == "selected" else result.reason
    receipt = _receipt(
        decision_type=decision_type,
        candidates=unique,
        identity=identity,
        policy_snapshot=policy_snapshot,
        selected_candidate_id=result.candidate_id,
        decision_method=method,
        rationale=rationale,
        hold_reason=hold_reason,
        judge_receipts=judge_receipts,
    )
    if persist is not None:
        persistence = persist(str(_identity_value(identity, "jobId")), receipt)
        receipt["persistence"] = dict(persistence)
    return SelectionResult(
        result.status,
        result.decision_type,
        result.candidate_id,
        result.reason,
        result.exact_one_proof,
        receipt,
    )
