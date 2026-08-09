from __future__ import annotations

from control_tower.backend.candidate_selector import decide_candidates, select_candidates
from control_tower.backend.policy import build_policy_snapshot
from control_tower.backend.review_service import ReviewConflict, ReviewService


def candidate(candidate_id: str, digest: str, identity: str | None = None) -> dict[str, str]:
    return {"candidateId": candidate_id, "identityKey": identity or candidate_id, "contentDigest": digest}


def test_only_exactly_one_candidate_can_skip_the_judge() -> None:
    result = select_candidates("representative_image", [candidate("a", "digest-a")])
    assert result.status == "selected"
    assert result.exact_one_proof is not None
    assert select_candidates("representative_image", [candidate("a", "digest-a"), candidate("b", "digest-b")]).reason == "judge_receipt_missing"


def identity() -> dict[str, object]:
    return {
        "jobId": "job-a",
        "productId": "product-a",
        "productKey": "product-key-a",
        "runId": "run-a",
        "inputFingerprint": "sha256:input-a",
        "revision": 7,
        "eventId": "event-42",
    }


def policy(mode: str = "auto") -> dict[str, object]:
    return build_policy_snapshot(
        "batch-a",
        "product-a",
        "full_auto",
        {},
        {},
        {"representative_image": mode},
    )


class FakeJudge:
    def __init__(self, judgements: list[dict[str, object]]) -> None:
        self.judgements = judgements
        self.calls: list[dict[str, object]] = []

    def judge(self, **kwargs):
        self.calls.append(kwargs)
        judgement = self.judgements[len(self.calls) - 1]
        return {
            "receipt": {
                "model": "gpt-test",
                "reasoningEffort": kwargs["reasoning_effort"],
                "serviceTier": kwargs["service_tier"],
                "preset": kwargs["preset"],
                "judgement": judgement,
                "evidence": {"candidateRefs": [{"candidateId": item["candidateId"]} for item in kwargs["candidates"]]},
            },
        }


def strong_judgement(candidate_id: str, *, confidence: float = 0.91) -> dict[str, object]:
    return {
        "decision": "selected",
        "selectedCandidateId": candidate_id,
        "confidence": confidence,
        "scoreGap": 0.2,
        "riskFlags": [],
        "rationale": f"{candidate_id} evidence",
        "scores": {"sameProductLikelihood": 0.9, "taskSuitability": 0.9, "quality": 0.85},
    }


def test_single_candidate_builds_and_persists_deterministic_receipt_without_llm() -> None:
    persisted: list[tuple[str, dict[str, object]]] = []
    judge = FakeJudge([])
    result = decide_candidates(
        "representative_image",
        [candidate("a", "digest-a")],
        identity=identity(),
        policy_snapshot=policy(),
        judge=judge,
        persist=lambda job_id, receipt: persisted.append((job_id, receipt)) or {"decisionId": "pdp-decision-a"},
    )
    assert result.status == "selected"
    assert judge.calls == []
    assert result.receipt["decisionMethod"] == "deterministic_single_candidate"
    assert result.receipt["selectedCandidateId"] == "a"
    assert result.receipt["policySnapshotId"] == policy()["snapshotId"]
    assert persisted[0][0] == "job-a"
    assert result.receipt["persistence"]["decisionId"] == "pdp-decision-a"


def test_multiple_candidates_use_oauth_and_dual_review_disagreement_or_low_confidence_holds() -> None:
    candidates = [candidate("a", "digest-a"), candidate("b", "digest-b")]
    persisted: list[dict[str, object]] = []
    agreeing = FakeJudge([strong_judgement("b"), strong_judgement("b")])
    selected = decide_candidates(
        "representative_image",
        candidates,
        identity=identity(),
        policy_snapshot=policy(),
        judge=agreeing,
        preset="dual_review",
        persist=lambda _job_id, receipt: persisted.append(receipt) or {"decisionId": "selected"},
    )
    assert selected.status == "selected"
    assert selected.candidate_id == "b"
    assert len(agreeing.calls) == 2
    assert selected.receipt["decisionMethod"] == "gpt_oauth_dual_review"

    disagreeing = FakeJudge([strong_judgement("a"), strong_judgement("b")])
    held = decide_candidates(
        "representative_image",
        candidates,
        identity=identity(),
        policy_snapshot=policy(),
        judge=disagreeing,
        preset="dual_review",
        persist=lambda _job_id, receipt: persisted.append(receipt) or {"decisionId": "held"},
    )
    assert held.status == "manual_required"
    assert held.reason == "dual_review_disagreement"
    assert held.receipt["holdReason"] == "dual_review_disagreement"

    low = FakeJudge([strong_judgement("a", confidence=0.2)])
    held_low = decide_candidates(
        "representative_image",
        candidates,
        identity=identity(),
        policy_snapshot=policy(),
        judge=low,
        preset="fast_single",
        persist=lambda _job_id, receipt: persisted.append(receipt) or {"decisionId": "low"},
    )
    assert held_low.status == "manual_required"
    assert held_low.receipt["holdReason"] == "threshold_or_conflict"


def test_multiple_candidates_require_thresholds_and_conflict_free_receipt() -> None:
    base = {"decision": "selected", "selectedCandidateId": "b", "confidence": 0.9, "scoreGap": 0.2, "riskFlags": [], "scores": {"sameProductLikelihood": 0.9, "taskSuitability": 0.8, "quality": 0.8}}
    assert select_candidates("db_product_match", [candidate("a", "a"), candidate("b", "b")], judgement=base).status == "selected"
    assert select_candidates("db_product_match", [candidate("a", "a"), candidate("b", "b")], judgement={**base, "scoreGap": 0.01}).status == "manual_required"
    assert select_candidates("db_product_match", [candidate("a", "a"), candidate("b", "b")], judgement={**base, "riskFlags": ["same-product-conflict"]}).status == "manual_required"


def test_review_tasks_are_deduplicated_and_stale_resolution_is_rejected() -> None:
    queued: list[str] = []
    service = ReviewService(queued.append)
    first = service.create("product-a", "representative_image", ["candidate-a", "candidate-b"], 3)
    assert service.create("product-a", "representative_image", ["candidate-a", "candidate-b"], 3) == first
    resolved = service.resolve(first.review_id, selected_candidate_id="candidate-b", expected_version=3, new_version=4)
    assert resolved.status == "resolved"
    assert queued == ["product-a"]
    try:
        service.resolve(first.review_id, selected_candidate_id="candidate-a", expected_version=3, new_version=4)
    except ReviewConflict as error:
        assert error.code == "review_stale_version"
    else:
        raise AssertionError("stale review resolution was accepted")
