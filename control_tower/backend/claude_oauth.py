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
import os
import re
import tempfile
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

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


def extract_json_object(text: str) -> str:
    """펜스를 벗겨도 JSON 이 아니면, 본문 안의 첫 번째 균형 잡힌 {…} 객체만 꺼낸다.

    실측 2026-09-17: 같은 프롬프트로 두 번 부르니 한 번은 순수 펜스 JSON, 한 번은 앞뒤에
    설명 문장이 붙어 json.loads 가 실패했다(judgement_json_invalid). 모델 출력은 형식이
    흔들리므로, 검증(validate_judgement)은 그대로 두고 꺼내는 쪽만 너그럽게 한다.
    """
    stripped = strip_json_fence(text)
    try:
        json.loads(stripped)
        return stripped
    except json.JSONDecodeError:
        pass
    start = stripped.find("{")
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(stripped)) if start >= 0 else ():
        char = stripped[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return stripped[start:index + 1]
    return stripped


class ClaudeOAuthJudge:
    def __init__(
        self,
        api_hub_url: str = "http://127.0.0.1:4321",
        *,
        request_fn: Callable[..., GptHttpResponse] = requests.request,
        asset_base_url: str = "http://127.0.0.1:43030",
        tower_base_url: str = "http://127.0.0.1:41009",
        image_dir: str | os.PathLike[str] | None = None,
        fetch_fn: Callable[..., GptHttpResponse] = requests.get,
        max_images: int = 12,
    ) -> None:
        self.api_hub_url = api_hub_url.rstrip("/")
        self._request = request_fn
        # 후보 그림을 내려받아 둘 곳. 허브의 Claude 브리지는 글자만 받으므로(apiClaudeOauth.js, 이미지 필드 없음)
        # 그림은 같은 PC 의 파일로 두고 Claude CLI(plan 모드 · 읽기 도구 허용)가 경로를 열어 보게 한다.
        self.asset_base_url = asset_base_url.rstrip("/")
        self.tower_base_url = tower_base_url.rstrip("/")
        self.image_dir = Path(image_dir) if image_dir else Path(tempfile.gettempdir()) / "control-tower-claude-judge"
        self._fetch = fetch_fn
        self.max_images = max_images

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

    def _image_url(self, reference: str) -> str:
        """후보 그림 참조를 내려받을 수 있는 주소로. 조립공장 보관함 원본(/image)은 768px 축소본으로 바꿔 받는다."""
        ref = str(reference or "").strip()
        if not ref or ref.startswith("thumb:") or ref.startswith("asset:"):
            return ""
        if ref.startswith("http://") or ref.startswith("https://"):
            return ref
        if ref.startswith("/api/local-archive/"):
            ref = re.sub(r"/image(?:\?.*)?$", "/thumbnail?w=768", ref)
            return f"{self.asset_base_url}{ref}"
        if ref.startswith("/api/factory/"):
            return f"{self.tower_base_url}{ref}"
        return ""

    def _attach_images(self, evidence: Mapping[str, JsonValue]) -> list[JsonObject]:
        """증거 묶음의 후보 그림을 파일로 내려받는다. 못 받은 후보는 뺀다(글자 판정으로 남는다).

        돌아오는 값: [{candidateId, path, bytes}]. 파일 이름은 내용 다이제스트라 같은 그림은 다시 받지 않는다.
        """
        attached: list[JsonObject] = []
        # build_evidence_bundle 은 후보를 candidateRefs 로 싣는다(candidateId·thumbnailRef·contentDigest).
        candidates = evidence.get("candidateRefs") if isinstance(evidence, Mapping) else None
        if not isinstance(candidates, list):
            return attached
        try:
            self.image_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            return attached
        for item in candidates[: self.max_images]:
            if not isinstance(item, Mapping):
                continue
            url = self._image_url(str(item.get("thumbnailRef") or ""))
            candidate_id = str(item.get("candidateId") or "")
            if not url or not candidate_id:
                continue
            digest = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("contentDigest") or candidate_id))[:64] or "candidate"
            try:
                response = self._fetch(url, timeout=(3, 30))
                if response.status_code != 200:
                    continue
                content = response.content
                content_type = str(response.headers.get("Content-Type") or "").lower()
            except (requests.RequestException, AttributeError):
                continue
            if not content or len(content) > 8 * 1024 * 1024:
                continue
            suffix = ".png" if "png" in content_type else ".webp" if "webp" in content_type else ".jpg"
            path = self.image_dir / f"{digest}{suffix}"
            try:
                path.write_bytes(content)
            except OSError:
                continue
            attached.append({"candidateId": candidate_id, "path": str(path), "bytes": len(content)})
        return attached

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
        # 그림을 파일로 내려 두고 경로를 알려 준다. 브리지는 Claude CLI 를 plan 모드로 띄우므로 읽기 도구로 열어 볼 수 있다.
        # 그림을 하나도 못 받으면 글자 판정으로 남는다 — 그때는 모델이 manual_required 로 답하는 게 맞다.
        images = self._attach_images(evidence)
        prompt_body: JsonObject = {
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
        }
        if images:
            prompt_body["imageFiles"] = [{"candidateId": item["candidateId"], "path": item["path"]} for item in images]
            prompt_body["viewingInstruction"] = (
                "Before judging, open every file listed in imageFiles with your Read tool "
                "(absolute local paths; they are the candidate pictures) and look at each picture. "
                "Judge visually: the product must be shown whole and clearly for its stage "
                "(representative, size guide, colour option, or image cut). "
                "Do not answer manual_required merely because pictures are files — you can read them."
            )
        payload: JsonObject = {
            "prompt": json.dumps(prompt_body, ensure_ascii=False, separators=(",", ":")),
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
            raw_judgement = json.loads(extract_json_object(text))
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
            # 그림을 몇 장 보여 줬는지 — 0 이면 글자만 보고 판정한 것이다(영수증만 보고도 알 수 있어야 한다).
            "imageCount": len(images),
        }
        # 얼마나 쓰는지 보이지 않으면 안 된다 — 브리지가 주는 비용을 영수증에 그대로 싣는다.
        cost = response.get("totalCostUsd")
        if isinstance(cost, (int, float)) and not isinstance(cost, bool):
            metadata["costUsd"] = float(cost)
        return {"receipt": metadata | {"judgement": judgement, "evidence": evidence}}
