"""Claude OAuth 판정기 — GptOAuthJudge 와 같은 judge() 계약, 다른 제공자.

2026-09-17: 조작자 요청 "내가 선택 가능한 모든 컷을 클로드 oauth 나 gpt oauth 를 붙여서
자동화도 가능하게". API Hub(4321)에는 GPT 와 대칭인 Claude OAuth 브리지가 이미 있다
(GET /api/claude-oauth/status, GET /api/claude-oauth/options, POST /api/claude-oauth/exec).
여기서는 그 브리지를 GPT 판정기와 똑같은 모양(evidence bundle -> 판정 JSON -> receipt)으로
감싸기만 한다. 판정 규칙·검증(validate_judgement)·증거 묶음은 gpt_oauth 의 것을 그대로 쓴다 —
제공자가 달라도 영수증 형식이 같아야 후속 단계(candidate_selector, PDP decision)가 구분 없이 읽는다.

브리지 계약에서 확인한 함정 (memory: project-schyo-llm-claude-fallback):
- model 과 effort 는 필수. 별칭('opus')은 조용히 다른 모델로 붙으니 full id 만 허용한다.
- jsonOnly 는 스키마 강제가 아니라 프롬프트 한 줄 — 코드 펜스가 그대로 올 수 있어 벗겨 낸다.
- 미로그인은 428. 응답의 usedClaudeOAuth 가 true 가 아니면 "실제로 모델이 답했다" 고 볼 수 없다.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable, Mapping

import requests

from .gpt_oauth import (
    JUDGE_SCHEMA_VERSION,
    PROMPT_VERSION,
    GptHttpResponse,
    _digest,
    build_evidence_bundle,
    normalize_decision_type,
    validate_judgement,
)
from .runtime_cache import JsonObject, JsonValue

CONNECTOR_ID = "claude_login_oauth"
PROVIDER_ID = "claude-oauth"
_JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


class ClaudeOAuthError(Exception):
    def __init__(self, code: str, *, retryable: bool = False) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(code)


def strip_json_fence(text: str) -> str:
    """브리지가 jsonOnly 여도 코드 펜스를 그대로 돌려줄 때가 있다."""
    return _JSON_FENCE.sub("", text).strip()


class ClaudeOAuthJudge:
    def __init__(
        self,
        api_hub_url: str = "http://127.0.0.1:4321",
        *,
        request_fn: Callable[..., GptHttpResponse] = requests.request,
    ) -> None:
        self.api_hub_url = api_hub_url.rstrip("/")
        self._request = request_fn

    def _call(
        self,
        method: str,
        path: str,
        payload: JsonObject | None = None,
        *,
        timeout: tuple[int, int] = (3, 200),
    ) -> JsonObject:
        try:
            response = self._request(method, f"{self.api_hub_url}{path}", json=payload, timeout=timeout)
        except requests.RequestException as error:
            raise ClaudeOAuthError("api_hub_unavailable", retryable=True) from error
        if response.status_code == 428:
            raise ClaudeOAuthError("oauth_not_ready", retryable=True)
        if response.status_code >= 400:
            raise ClaudeOAuthError("api_hub_request_failed", retryable=response.status_code >= 500)
        raw = response.json()
        if not isinstance(raw, dict):
            raise ClaudeOAuthError("api_hub_response_invalid")
        return dict(raw)

    def _ready(self) -> JsonObject:
        status = self._call("GET", "/api/claude-oauth/status")
        oauth = status.get("oauthStatus")
        if (
            status.get("ok") is not True
            or not isinstance(oauth, dict)
            or oauth.get("mode") != "claude-subscription-oauth"
            or oauth.get("claudeLoginReady") is not True
            or oauth.get("loggedIn") is not True
            or status.get("rawTokenReturned") is True
        ):
            raise ClaudeOAuthError("oauth_not_ready", retryable=True)
        return self._call("GET", "/api/claude-oauth/options")

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
        # service_tier 는 GPT 전용 개념이다. 계약을 맞추려 받기만 하고 브리지에는 보내지 않는다.
        decision_type = normalize_decision_type(decision_type)
        evidence = build_evidence_bundle(input_refs, candidates)
        options = self._ready()
        defaults = options.get("defaults") if isinstance(options.get("defaults"), dict) else {}
        available_models = {
            str(item.get("id"))
            for item in options.get("modelOptions", [])
            if isinstance(item, dict) and item.get("id")
        }
        available_efforts = {
            str(item.get("id"))
            for item in options.get("effortOptions", [])
            if isinstance(item, dict) and item.get("id")
        }
        resolved_model = str(defaults.get("model") or "claude-opus-5") if model in {"", "latestModel"} else model
        if available_models and resolved_model not in available_models:
            # 별칭('opus', 'haiku')도 여기서 막힌다 — 브리지가 조용히 다른 모델로 바꿔 붙이기 때문.
            raise ClaudeOAuthError("model_option_invalid")
        effort = reasoning_effort or str(defaults.get("effort") or "high")
        if available_efforts and effort not in available_efforts:
            raise ClaudeOAuthError("effort_option_invalid")
        timeout_ms = int(defaults.get("timeoutMs") or 180000)
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
            "effort": effort,
            "timeoutMs": timeout_ms,
            "jsonOnly": True,
        }
        response = self._call(
            "POST",
            "/api/claude-oauth/exec",
            payload,
            timeout=(3, timeout_ms // 1000 + 30),
        )
        if (
            response.get("ok") is not True
            or response.get("usedClaudeOAuth") is not True
            or response.get("rawTokenReturned") is True
        ):
            raise ClaudeOAuthError("oauth_exec_not_proven", retryable=True)
        text = response.get("text")
        if not isinstance(text, str):
            raise ClaudeOAuthError("judgement_text_missing")
        try:
            raw_judgement = json.loads(strip_json_fence(text))
        except json.JSONDecodeError as error:
            raise ClaudeOAuthError("judgement_json_invalid") from error
        judgement = validate_judgement(raw_judgement, decision_type=decision_type, evidence=evidence)
        metadata: JsonObject = {
            "judgeId": f"{PROVIDER_ID}:{decision_type}",
            "provider": PROVIDER_ID,
            "connectorId": CONNECTOR_ID,
            "decisionType": decision_type,
            "judgeSchemaVersion": JUDGE_SCHEMA_VERSION,
            "promptVersion": PROMPT_VERSION,
            "model": str(response.get("model") or resolved_model),
            "reasoningEffort": effort,
            "serviceTier": service_tier,
            "preset": preset,
            "evidenceBundleDigest": evidence["bundleDigest"],
            "judgementDigest": _digest(judgement),
        }
        return {"receipt": metadata | {"judgement": judgement, "evidence": evidence}}
