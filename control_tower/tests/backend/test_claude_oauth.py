"""Claude OAuth 판정기 — GPT 판정기와 같은 계약을 다른 브리지로 지키는지.

2026-09-17: "모든 컷 선택을 클로드 oauth 나 gpt oauth 로 자동화도 가능하게".
허브 브리지(/api/claude-oauth/*)의 실제 응답 모양을 가짜 전송으로 재현한다:
status 는 oauthStatus.claudeLoginReady/loggedIn, options 는 modelOptions/effortOptions/defaults,
exec 는 ok/usedClaudeOAuth/rawTokenReturned/text. 코드 펜스는 브리지가 실제로 돌려주는 모양이다.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from control_tower.backend.claude_oauth import (
    CONNECTOR_ID,
    PROVIDER_ID,
    ClaudeOAuthError,
    ClaudeOAuthJudge,
    extract_json_object,
    strip_json_fence,
)


class FakeResponse:
    def __init__(self, body: dict[str, Any], status_code: int = 200) -> None:
        self.status_code = status_code
        self.body = body

    def json(self) -> dict[str, Any]:
        return self.body


def status_body(*, logged_in: bool = True) -> dict[str, Any]:
    return {
        "ok": True,
        "rawTokenReturned": False,
        "oauthStatus": {
            "mode": "claude-subscription-oauth",
            "cliAvailable": True,
            "loggedIn": logged_in,
            "claudeLoginReady": logged_in,
            "expired": False,
        },
    }


def options_body() -> dict[str, Any]:
    return {
        "authMode": "claude-subscription-oauth",
        "modelOptions": [
            {"id": "claude-opus-5", "alias": "opus", "recommended": True},
            {"id": "claude-sonnet-5", "alias": "sonnet"},
            {"id": "claude-haiku-4-5", "alias": "haiku"},
        ],
        "effortOptions": [{"id": "low"}, {"id": "medium"}, {"id": "high"}, {"id": "xhigh"}],
        "defaults": {"model": "claude-opus-5", "effort": "high", "timeoutMs": 180000},
    }


def fake_transport_factory(
    judgement: dict[str, Any],
    *,
    logged_in: bool = True,
    fenced: bool = False,
    exec_body: dict[str, Any] | None = None,
    exec_status: int = 200,
):
    calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def transport(method: str, url: str, **kwargs: Any) -> FakeResponse:
        calls.append((method, url, kwargs.get("json")))
        if url.endswith("/api/claude-oauth/status"):
            return FakeResponse(status_body(logged_in=logged_in))
        if url.endswith("/api/claude-oauth/options"):
            return FakeResponse(options_body())
        if exec_body is not None:
            return FakeResponse(exec_body, exec_status)
        text = json.dumps(judgement, ensure_ascii=False)
        if fenced:
            text = f"```json\n{text}\n```"
        return FakeResponse({"ok": True, "usedClaudeOAuth": True, "rawTokenReturned": False, "text": text, "model": "claude-opus-5"})

    return transport, calls


def candidate(candidate_id: str, digest: str) -> dict[str, str]:
    return {
        "candidateId": candidate_id,
        "source": "fixture",
        "thumbnailRef": f"thumb:{candidate_id}",
        "contentDigest": digest,
    }


def valid_judgement(selected: str = "candidate-a") -> dict[str, Any]:
    return {
        "decision": "selected",
        "selectedCandidateId": selected,
        "scores": {
            "sameProductLikelihood": 0.9,
            "visualSimilarity": 0.8,
            "taskSuitability": 0.9,
            "quality": 0.85,
            "factConsistency": 0.9,
        },
        "confidence": 0.88,
        "scoreGap": 0.3,
        "riskFlags": [],
        "rationale": "candidate-a 가 제품 전체가 보이고 배경이 정리돼 목록 썸네일로 가장 읽힌다.",
    }


CANDIDATES = [candidate("candidate-a", "digest-a"), candidate("candidate-b", "digest-b")]


def test_strip_json_fence_keeps_bare_json_and_removes_fences() -> None:
    assert strip_json_fence('{"a":1}') == '{"a":1}'
    assert strip_json_fence('```json\n{"a":1}\n```') == '{"a":1}'
    assert strip_json_fence('```\n{"a":1}\n```') == '{"a":1}'


def test_judge_uses_claude_bridge_and_returns_receipt_with_provider() -> None:
    transport, calls = fake_transport_factory(valid_judgement(), fenced=True)
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)

    result = judge.judge(
        decision_type="representative_image",
        input_refs=[],
        candidates=CANDIDATES,
        model="latestModel",
        reasoning_effort="high",
        service_tier="standard",
        preset="fast_single",
    )

    receipt = result["receipt"]
    assert receipt["provider"] == PROVIDER_ID == "claude-oauth"
    assert receipt["connectorId"] == CONNECTOR_ID == "claude_login_oauth"
    # normalize_decision_type 이 representative_image 를 representative_a_cut 로 정규화한다 (GPT 판정기와 동일)
    assert receipt["judgeId"] == "claude-oauth:representative_a_cut"
    assert receipt["decisionType"] == "representative_a_cut"
    assert receipt["judgement"]["selectedCandidateId"] == "candidate-a"
    assert receipt["model"] == "claude-opus-5"
    assert receipt["reasoningEffort"] == "high"
    # 브리지가 실제로 받은 것: status → options → exec, exec 에 model·effort 필수, 별칭 아님
    assert [c[0] + " " + c[1].rsplit("/", 1)[-1] for c in calls] == ["GET status", "GET options", "POST exec"]
    exec_payload = calls[-1][2]
    assert exec_payload["model"] == "claude-opus-5"
    assert exec_payload["effort"] == "high"
    assert exec_payload["jsonOnly"] is True
    assert exec_payload["timeoutMs"] == 180000
    assert "serviceTier" not in exec_payload, "GPT 전용 인자를 Claude 브리지에 보내면 안 된다"


def test_latest_model_resolves_to_bridge_default_model() -> None:
    transport, calls = fake_transport_factory(valid_judgement())
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES, model="latestModel")
    assert calls[-1][2]["model"] == "claude-opus-5"


def test_model_alias_is_rejected_not_silently_substituted() -> None:
    # 실측(memory): 브리지에 'haiku' 를 주면 조용히 claude-sonnet-5 로 붙는다. 여기서 막는다.
    transport, _ = fake_transport_factory(valid_judgement())
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(ClaudeOAuthError, match="model_option_invalid"):
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES, model="haiku")


def test_unknown_effort_is_rejected() -> None:
    transport, _ = fake_transport_factory(valid_judgement())
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(ClaudeOAuthError, match="effort_option_invalid"):
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES, reasoning_effort="max")


def test_not_logged_in_is_oauth_not_ready_and_never_calls_exec() -> None:
    transport, calls = fake_transport_factory(valid_judgement(), logged_in=False)
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(ClaudeOAuthError, match="oauth_not_ready") as error:
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES)
    assert error.value.retryable is True
    assert all(not c[1].endswith("/exec") for c in calls)


def test_bridge_428_is_oauth_not_ready() -> None:
    transport, _ = fake_transport_factory(valid_judgement(), exec_body={"ok": False, "reason": "not-logged-in"}, exec_status=428)
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(ClaudeOAuthError, match="oauth_not_ready"):
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES)


def test_exec_without_proof_is_rejected() -> None:
    body = {"ok": True, "usedClaudeOAuth": False, "rawTokenReturned": False, "text": json.dumps(valid_judgement())}
    transport, _ = fake_transport_factory(valid_judgement(), exec_body=body)
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(ClaudeOAuthError, match="oauth_exec_not_proven"):
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES)


def test_judgement_must_pick_a_referenced_candidate() -> None:
    transport, _ = fake_transport_factory(valid_judgement(selected="candidate-z"))
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    with pytest.raises(Exception) as error:
        judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES)
    assert "candidate" in str(error.value).lower() or "judgement" in str(error.value).lower()


def test_extract_json_object_tolerates_prose_around_the_object() -> None:
    # 실측 2026-09-17: 같은 프롬프트로 두 번 부르니 한 번은 설명 문장이 붙어 왔다.
    wrapped = "
".join([
        "Here is my judgement:",
        "```json",
        '{"a": {"b": "x}y"}, "c": [1, 2]}',
        "```",
        "Hope this helps.",
    ])
    assert json.loads(extract_json_object(wrapped)) == {"a": {"b": "x}y"}, "c": [1, 2]}
    assert extract_json_object('{"a":1}') == '{"a":1}'


def test_bridge_cost_lands_in_receipt() -> None:
    body = {"ok": True, "usedClaudeOAuth": True, "rawTokenReturned": False, "text": json.dumps(valid_judgement()), "totalCostUsd": 0.0312}
    transport, _ = fake_transport_factory(valid_judgement(), exec_body=body)
    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport)
    receipt = judge.judge(decision_type="size_image", input_refs=[], candidates=CANDIDATES)["receipt"]
    assert receipt["costUsd"] == 0.0312

