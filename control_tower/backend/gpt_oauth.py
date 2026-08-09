from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Protocol

import requests

from .runtime_cache import JsonObject, JsonValue


class GptOAuthError(Exception):
    def __init__(self, code: str, *, retryable: bool = False) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(code)


class GptHttpResponse(Protocol):
    status_code: int

    def json(self) -> JsonValue: ...


@dataclass(frozen=True, slots=True)
class EvidenceRef:
    candidate_id: str
    source: str
    thumbnail_ref: str
    content_digest: str
    near_duplicate_key: str = ""


JUDGE_SCHEMA_VERSION = "visual-judgement:v1"
PROMPT_VERSION = "control-tower-visual-judge:v1"
DECISION_TYPES = frozenset(
    {
        "db_product_match",
        "cafe24_product_match",
        "competitor_product_match",
        "required_field_candidate",
        "representative_a_cut",
        "size_a_cut",
        "option_color_a_cut",
        "image_cut_a_cut",
        "section_variant_a_cut",
        "final_detail_candidate",
    },
)
DECISION_TYPE_ALIASES = {
    "sinhwa_db_product": "db_product_match",
    "cafe24_product": "cafe24_product_match",
    "competitor_product": "competitor_product_match",
    "representative_image": "representative_a_cut",
    "size_image": "size_a_cut",
    "option_image": "option_color_a_cut",
    "general_image": "image_cut_a_cut",
    "section_variant": "section_variant_a_cut",
    "final_detail": "final_detail_candidate",
}


def normalize_decision_type(decision_type: str) -> str:
    normalized = DECISION_TYPE_ALIASES.get(decision_type, decision_type)
    if normalized not in DECISION_TYPES:
        raise GptOAuthError("decision_type_invalid")
    return normalized


def _digest(value: JsonValue) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def build_evidence_bundle(input_refs: Iterable[Mapping[str, JsonValue]], candidates: Iterable[Mapping[str, JsonValue]], *, max_candidates: int = 50) -> JsonObject:
    refs: list[JsonObject] = []
    seen_digest: set[str] = set()
    seen_near: set[str] = set()
    for raw in candidates:
        candidate_id = str(raw.get("candidateId", "")).strip()
        source = str(raw.get("source", "")).strip()
        thumbnail_ref = str(raw.get("thumbnailRef", "")).strip()
        content_digest = str(raw.get("contentDigest", "")).strip()
        if not candidate_id or not source or not thumbnail_ref or not content_digest:
            raise GptOAuthError("evidence_reference_invalid")
        near_key = str(raw.get("nearDuplicateKey", "")).strip()
        if content_digest in seen_digest or near_key and near_key in seen_near:
            continue
        seen_digest.add(content_digest)
        if near_key:
            seen_near.add(near_key)
        refs.append({
            "candidateId": candidate_id,
            "source": source,
            "thumbnailRef": thumbnail_ref,
            "contentDigest": content_digest,
            "nearDuplicateKey": near_key,
        })
        if len(refs) >= max_candidates:
            break
    if not refs:
        raise GptOAuthError("evidence_empty")
    inputs = [dict(item) for item in input_refs]
    return {
        "schemaVersion": JUDGE_SCHEMA_VERSION,
        "inputRefs": inputs,
        "candidateRefs": refs,
        "bundleDigest": _digest({"inputRefs": inputs, "candidateRefs": refs}),
    }


def _number(value: JsonValue, key: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= float(value) <= 1:
        raise GptOAuthError(f"judgement_{key}_invalid")
    return float(value)


def validate_judgement(raw: JsonValue, *, decision_type: str, evidence: JsonObject) -> JsonObject:
    decision_type = normalize_decision_type(decision_type)
    if not isinstance(raw, dict):
        raise GptOAuthError("judgement_schema_invalid")
    candidate_ids = {str(item["candidateId"]) for item in evidence["candidateRefs"] if isinstance(item, dict)}
    selected = raw.get("selectedCandidateId")
    decision = raw.get("decision")
    if decision not in {"selected", "manual_required"}:
        raise GptOAuthError("judgement_decision_invalid")
    if decision == "selected" and (not isinstance(selected, str) or selected not in candidate_ids):
        raise GptOAuthError("judgement_candidate_unknown")
    if decision == "manual_required" and selected is not None:
        raise GptOAuthError("judgement_manual_selection_forbidden")
    scores = raw.get("scores")
    if not isinstance(scores, dict):
        raise GptOAuthError("judgement_scores_invalid")
    normalized_scores: JsonObject = {
        key: _number(scores.get(key), key)
        for key in ("sameProductLikelihood", "visualSimilarity", "taskSuitability", "quality", "factConsistency")
    }
    risks = raw.get("riskFlags", [])
    if not isinstance(risks, list) or not all(isinstance(item, str) for item in risks):
        raise GptOAuthError("judgement_risk_flags_invalid")
    rationale = raw.get("rationale")
    if not isinstance(rationale, str) or not rationale.strip():
        raise GptOAuthError("judgement_rationale_missing")
    confidence = _number(raw.get("confidence"), "confidence")
    score_gap = _number(raw.get("scoreGap"), "score_gap")
    return {
        "decision": decision,
        "selectedCandidateId": selected,
        "scores": normalized_scores,
        "confidence": confidence,
        "scoreGap": score_gap,
        "riskFlags": list(risks),
        "rationale": rationale.strip(),
        "evidenceRefs": [str(item["candidateId"]) for item in evidence["candidateRefs"] if isinstance(item, dict)],
    }


class GptOAuthJudge:
    def __init__(self, api_hub_url: str = "http://127.0.0.1:4321", *, request_fn: Callable[..., GptHttpResponse] = requests.request) -> None:
        self.api_hub_url = api_hub_url.rstrip("/")
        self._request = request_fn

    def _call(self, method: str, path: str, payload: JsonObject | None = None) -> JsonObject:
        try:
            response = self._request(method, f"{self.api_hub_url}{path}", json=payload, timeout=(3, 120))
        except requests.RequestException as error:
            raise GptOAuthError("api_hub_unavailable", retryable=True) from error
        if response.status_code >= 400:
            raise GptOAuthError("api_hub_request_failed", retryable=response.status_code >= 500)
        raw = response.json()
        if not isinstance(raw, dict):
            raise GptOAuthError("api_hub_response_invalid")
        return dict(raw)

    def _ready(self) -> JsonObject:
        status = self._call("GET", "/api/playbooks/gpt-oauth/status")
        if status.get("connectorId") != "chatgpt_login_oauth" or status.get("mode") != "chatgpt-login-oauth" or status.get("authMode") != "chatgpt" or status.get("chatGptLoginReady") is not True:
            raise GptOAuthError("oauth_not_ready", retryable=True)
        return self._call("GET", "/api/llm/options")

    def judge(
        self,
        *,
        decision_type: str,
        input_refs: Iterable[Mapping[str, JsonValue]],
        candidates: Iterable[Mapping[str, JsonValue]],
        model: str = "latestModel",
        reasoning_effort: str = "medium",
        service_tier: str = "standard",
        preset: str = "dual_review",
    ) -> JsonObject:
        decision_type = normalize_decision_type(decision_type)
        evidence = build_evidence_bundle(input_refs, candidates)
        options = self._ready()
        available_models = {
            str(item.get("id"))
            for item in options.get("modelOptions", [])
            if isinstance(item, dict) and item.get("id")
        }
        available_reasoning = {
            str(item.get("id"))
            for item in options.get("reasoningOptions", [])
            if isinstance(item, dict) and item.get("id")
        }
        available_tiers = {
            str(item.get("id"))
            for item in options.get("serviceTierOptions", [])
            if isinstance(item, dict) and item.get("id")
        }
        resolved_model = str(options.get("latestModel") or "latestModel") if model in {"", "latestModel"} else model
        if available_models and resolved_model not in available_models:
            raise GptOAuthError("model_option_invalid")
        if available_reasoning and reasoning_effort not in available_reasoning:
            raise GptOAuthError("reasoning_option_invalid")
        if available_tiers and service_tier not in available_tiers:
            raise GptOAuthError("service_tier_option_invalid")
        payload: JsonObject = {
            "prompt": json.dumps(
                {
                    "decisionType": decision_type,
                    "evidence": evidence,
                    "instruction": (
                        "Return one JSON object only with these exact keys: "
                        "decision ('selected' or 'manual_required'), "
                        "selectedCandidateId (one referenced candidate ID or null), "
                        "scores (an object with sameProductLikelihood, visualSimilarity, "
                        "taskSuitability, quality, factConsistency; every value is a number 0..1), "
                        "confidence (number 0..1), scoreGap (number 0..1), "
                        "riskFlags (array of strings), rationale (nonempty string). "
                        "Choose only a referenced candidate. If evidence is insufficient or "
                        "conflicting, use manual_required and null selectedCandidateId."
                    ),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            "model": resolved_model,
            "preferLatest": True,
            "reasoningEffort": reasoning_effort,
            "serviceTier": service_tier,
            "timeoutMs": 120000,
            "jsonOnly": True,
        }
        response = self._call("POST", "/api/gpt-oauth/exec", payload)
        if response.get("ok") is not True or response.get("usedGptOAuth") is not True or response.get("rawTokenReturned") is True:
            raise GptOAuthError("oauth_exec_not_proven", retryable=True)
        text = response.get("text")
        if not isinstance(text, str):
            raise GptOAuthError("judgement_text_missing")
        try:
            raw_judgement = json.loads(text)
        except json.JSONDecodeError as error:
            raise GptOAuthError("judgement_json_invalid") from error
        judgement = validate_judgement(raw_judgement, decision_type=decision_type, evidence=evidence)
        metadata: JsonObject = {
            "judgeId": f"gpt-oauth:{decision_type}",
            "decisionType": decision_type,
            "judgeSchemaVersion": JUDGE_SCHEMA_VERSION,
            "promptVersion": PROMPT_VERSION,
            "model": str(response.get("model") or resolved_model),
            "reasoningEffort": reasoning_effort,
            "serviceTier": service_tier,
            "preset": preset,
            "evidenceBundleDigest": evidence["bundleDigest"],
            "judgementDigest": _digest(judgement),
        }
        return {"receipt": metadata | {"judgement": judgement, "evidence": evidence}}
