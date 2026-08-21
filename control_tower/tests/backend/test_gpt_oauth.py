from __future__ import annotations

import json
from typing import Any

import pytest

from control_tower.backend.gpt_oauth import GptOAuthError, GptOAuthJudge, build_evidence_bundle


class FakeResponse:
    def __init__(self, body: dict[str, Any], status_code: int = 200) -> None:
        self.status_code = status_code
        self.body = body

    def json(self) -> dict[str, Any]:
        return self.body


def fake_transport_factory(judgement: dict[str, Any], *, ready: bool = True):
    calls: list[tuple[str, str]] = []

    def transport(method: str, url: str, **kwargs: Any) -> FakeResponse:
        calls.append((method, url))
        if url.endswith("/status"):
            return FakeResponse({"connectorId": "chatgpt_login_oauth", "mode": "chatgpt-login-oauth", "authMode": "chatgpt", "chatGptLoginReady": ready})
        if url.endswith("/options"):
            return FakeResponse({
                "latestModel": "gpt-5.6-sol",
                "modelOptions": [{"id": "gpt-5.6-sol"}],
                "reasoningOptions": [{"id": "medium"}],
                "serviceTierOptions": [{"id": "standard"}],
            })
        return FakeResponse({"ok": True, "usedGptOAuth": True, "rawTokenReturned": False, "text": json.dumps(judgement)})

    return transport, calls


def candidate(candidate_id: str, digest: str, near: str = "") -> dict[str, str]:
    return {"candidateId": candidate_id, "source": "fixture", "thumbnailRef": f"thumb:{candidate_id}", "contentDigest": digest, "nearDuplicateKey": near}


def valid_judgement() -> dict[str, Any]:
    return {"decision": "selected", "selectedCandidateId": "candidate-a", "scores": {"sameProductLikelihood": 0.9, "visualSimilarity": 0.8, "taskSuitability": 0.9, "quality": 0.8, "factConsistency": 0.9}, "confidence": 0.87, "scoreGap": 0.21, "riskFlags": [], "rationale": "fixture evidence supports candidate-a"}


def test_evidence_bundle_deduplicates_exact_and_near_duplicates() -> None:
    bundle = build_evidence_bundle([], [candidate("a", "digest-a", "near-a"), candidate("b", "digest-a", "near-b"), candidate("c", "digest-c", "near-a"), candidate("d", "digest-d", "near-d")])
    assert [item["candidateId"] for item in bundle["candidateRefs"]] == ["a", "d"]


def test_evidence_bundle_rejects_all_untrusted_input_references() -> None:
    candidates = [candidate("a", "digest-a")]
    with pytest.raises(GptOAuthError, match="evidence_input_reference_invalid"):
        build_evidence_bundle([{"inputId": "input-a", "accessToken": "fixture-only"}], candidates)
    with pytest.raises(GptOAuthError, match="evidence_input_reference_invalid"):
        build_evidence_bundle([{"inputId": {"secret": "fixture-only"}}], candidates)
    with pytest.raises(GptOAuthError, match="evidence_input_reference_invalid"):
        build_evidence_bundle([{"inputId": "fixture-token-hidden-in-allowed-field"}], candidates)


def test_judge_returns_schema_bound_receipt_without_secrets() -> None:
    transport, calls = fake_transport_factory(valid_judgement())
    receipt = GptOAuthJudge(request_fn=transport).judge(decision_type="representative_a_cut", input_refs=[], candidates=[candidate("candidate-a", "digest-a")])
    assert receipt["receipt"]["judgement"]["selectedCandidateId"] == "candidate-a"
    assert receipt["receipt"]["judgement"]["scoreGap"] == 0.21
    assert receipt["receipt"]["evidence"]["candidateRefs"][0]["candidateId"] == "candidate-a"
    assert "token" not in json.dumps(receipt).lower()
    assert [path.rsplit("/", 1)[-1] for _, path in calls] == ["status", "options", "exec"]


def test_judge_rejects_unknown_candidate_and_oauth_not_ready() -> None:
    unknown = dict(valid_judgement(), selectedCandidateId="missing")
    transport, _ = fake_transport_factory(unknown)
    with pytest.raises(GptOAuthError, match="judgement_candidate_unknown"):
        GptOAuthJudge(request_fn=transport).judge(decision_type="db_product_match", input_refs=[], candidates=[candidate("candidate-a", "digest-a")])


def test_judge_uses_only_api_hub_catalog_and_requested_defaults() -> None:
    transport, _ = fake_transport_factory(valid_judgement())
    receipt = GptOAuthJudge(request_fn=transport).judge(
        decision_type="representative_image",
        input_refs=[],
        candidates=[candidate("candidate-a", "digest-a")],
        model="latestModel",
        reasoning_effort="medium",
        service_tier="standard",
        preset="fast_single",
    )
    assert receipt["receipt"]["model"] == "gpt-5.6-sol"
    assert receipt["receipt"]["reasoningEffort"] == "medium"
    assert receipt["receipt"]["serviceTier"] == "standard"
    assert receipt["receipt"]["preset"] == "fast_single"
    transport, _ = fake_transport_factory(valid_judgement(), ready=False)
    with pytest.raises(GptOAuthError, match="oauth_not_ready"):
        GptOAuthJudge(request_fn=transport).judge(decision_type="db_product_match", input_refs=[], candidates=[candidate("candidate-a", "digest-a")])
