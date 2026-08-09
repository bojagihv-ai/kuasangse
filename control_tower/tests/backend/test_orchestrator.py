from __future__ import annotations

import pytest

from control_tower.backend.cafe24_bridge import build_cafe24_command
from control_tower.backend.cafe24_staging import (
    APPROVAL_BINDING_FIELDS,
    SAFE_DEFAULTS,
    Cafe24ApprovalGate,
    build_preview,
)
from control_tower.backend.orchestrator import (
    ConveyorConflict,
    DEFAULT_POLICY,
    RetryClass,
    Scheduler,
    classify_failure,
    resolve_policy,
    run_full_auto_product,
)
from control_tower.backend.policy import build_policy_snapshot


def test_policy_precedence_is_stage_then_product_then_batch_then_default() -> None:
    # Given: 서로 다른 값을 가진 네 정책 계층을 준비한다.
    default = {"representative": "auto", "size": "auto"}
    batch = {"representative": "manual"}
    product = {"representative": "auto", "size": "manual"}
    stage = {"representative": "manual"}

    # When: 하나의 stage 정책을 해석한다.
    result = resolve_policy(stage, product, batch, default)

    # Then: 가장 구체적인 값만 덮어쓰고 나머지는 아래 계층에서 채워야 한다.
    assert result == {"representative": "manual", "size": "manual"}


def test_waiting_manual_product_does_not_block_next_auto_product() -> None:
    # Given: 제품 A는 대표컷 수동 검수에서 멈추고 제품 B는 다음 자동 단계에 있다.
    scheduler = Scheduler()
    scheduler.add_product("product-a", current_stage="representative", status="waiting_manual")
    scheduler.add_product("product-b", current_stage="validation", status="queued")

    # When: 다음에 실행할 제품을 선택한다.
    decision = scheduler.next_work()

    # Then: A를 기다리지 않고 B만 작업자로 선택해야 한다.
    assert decision is not None
    assert decision.product_id == "product-b"
    assert decision.stage_id == "validation"


def test_factory_stage_has_single_active_claim_and_resume_checkpoint() -> None:
    # Given: 조립공장 단계 두 개가 동시에 실행 후보인 scheduler를 준비한다.
    scheduler = Scheduler()
    scheduler.add_product("product-a", current_stage="representative", status="queued")
    scheduler.add_product("product-b", current_stage="size", status="queued")

    # When: 첫 claim을 등록하고 두 번째 claim을 요청한다.
    first = scheduler.claim("product-a")
    second = scheduler.claim("product-b")
    scheduler.release("product-a", status="waiting_manual")
    resumed = scheduler.next_work()

    # Then: 한 번에 하나만 claim되고 반납 뒤에는 정확한 체크포인트가 재개되어야 한다.
    assert first.stage_id == "representative"
    assert second is None
    assert resumed is not None
    assert resumed.product_id == "product-b"
    assert resumed.stage_id == "size"


def test_retry_classification_never_retries_authentication_or_manual_decisions() -> None:
    # Given: 일시적·인증·수동·검증 실패를 준비한다.
    # When: 각 실패를 재시도 정책으로 분류한다.
    # Then: 네트워크만 제한적으로 재시도하고 나머지는 개입으로 보낸다.
    assert classify_failure("timeout") is RetryClass.RETRYABLE
    assert classify_failure("network") is RetryClass.RETRYABLE
    assert classify_failure("authentication") is RetryClass.MANUAL
    assert classify_failure("manual_required") is RetryClass.MANUAL
    assert classify_failure("validation") is RetryClass.FATAL


def test_progress_reaches_one_hundred_only_after_verified_terminal_state() -> None:
    # Given: 작업 단계 완료율과 최종 상태를 가진 scheduler를 준비한다.
    scheduler = Scheduler()
    scheduler.add_product("product-a", current_stage="validation", status="queued")

    # When: 중간 단계와 검증 완료를 각각 기록한다.
    scheduler.complete_stage("product-a", "validation")
    before = scheduler.progress("product-a")
    scheduler.complete_stage("product-a", "staged_verified")
    after = scheduler.progress("product-a")

    # Then: 최종 원격 검증 전에는 100이 아니고 이후에만 100이어야 한다.
    assert before < 100
    assert after == 100
    assert DEFAULT_POLICY["representative"] == "auto"


def test_full_auto_conveyor_reaches_staged_verified_with_existing_fake_bridges() -> None:
    decisions: list[str] = []
    stages: list[str] = []
    cafe24_calls: list[dict[str, object]] = []
    identity = {
        "productId": "product-auto",
        "productKey": "product-key-auto",
        "runId": "run-auto",
        "inputFingerprint": "sha256:auto",
        "revision": 3,
    }
    policy = build_policy_snapshot(
        "batch-auto",
        "product-auto",
        "full_auto",
        {},
        {},
        {},
    )
    preview = build_preview({
        "batchId": "batch-auto",
        "productId": identity["productId"],
        "productKey": identity["productKey"],
        "categoryId": "71",
        "htmlDigest": "sha256:html",
        "imageDigests": ["sha256:image"],
        "expectedWorkfileRevision": identity["revision"],
        "expectedRunId": identity["runId"],
        "expectedInputFingerprint": identity["inputFingerprint"],
        **SAFE_DEFAULTS,
    })
    gate = Cafe24ApprovalGate()
    request = gate.issue(preview)
    approval_binding = {
        key: preview[key] if key in preview else preview["payload"][key]
        for key in APPROVAL_BINDING_FIELDS
    }
    approved = gate.approve(str(request["approvalRequestId"]), approval_binding)
    approval = {"approvalToken": approved["approvalToken"], **identity}

    def execute_cafe24(binding):
        grant = gate.consume(str(binding["approvalToken"]), approval_binding)
        command = build_cafe24_command(
            grant,
            str(grant["approvalGrantDigest"]),
            job_id="job-auto",
        )
        cafe24_calls.append(command)
        return {
            "status": "staged_verified",
            "externalWrite": False,
            "remoteReadbackDigest": "sha256:readback",
        }

    result = run_full_auto_product(
        identity=identity,
        policy_snapshot=policy,
        candidates_by_decision={decision: [{"candidateId": f"{decision}-a"}] for decision in policy["resolved"]},
        decide=lambda decision, _candidates: decisions.append(decision) or {
            "status": "selected",
            "candidateId": f"{decision}-a",
        },
        execute_stage=lambda stage, _context: stages.append(stage) or {"status": "completed"},
        approval=approval,
        execute_cafe24=execute_cafe24,
    )
    assert result["status"] == "staged_verified"
    assert result["percent"] == 100
    assert decisions == [
        "sinhwa_db_product",
        "cafe24_product",
        "required_field_candidate",
        "competitor_coupang",
        "competitor_smartstore",
        "competitor_gmarket",
        "competitor_auction",
        "competitor_elevenst",
        "representative_image",
        "size_image",
        "option_image",
        "general_image",
        "section_variant",
        "final_detail",
    ]
    assert stages[0] == "validation"
    assert cafe24_calls[0]["command"]["name"] == "detailToCafe24"
    assert "approvalToken" not in str(cafe24_calls[0])
    assert result["publicationReceipt"]["externalWrite"] is False


def test_manual_hold_releases_product_and_resume_rejects_stale_identity() -> None:
    identity = {
        "productId": "product-a",
        "productKey": "product-key-a",
        "runId": "run-a",
        "inputFingerprint": "sha256:a",
        "revision": 1,
    }
    policy = build_policy_snapshot(
        "batch-a",
        "product-a",
        "full_auto",
        {},
        {},
        {"sinhwa_db_product": "manual"},
    )
    held = run_full_auto_product(
        identity=identity,
        policy_snapshot=policy,
        candidates_by_decision={"sinhwa_db_product": [{"candidateId": "a"}]},
        decide=lambda *_args: {"status": "manual_required"},
        execute_stage=lambda *_args: {"status": "completed"},
        approval={},
        execute_cafe24=lambda _binding: {"status": "staged_verified"},
    )
    assert held["status"] == "waiting_manual"
    assert held["released"] is True
    assert held["checkpoint"]["nextStage"] == "candidate_collect"

    with pytest.raises(ConveyorConflict, match="stale_run_fingerprint"):
        run_full_auto_product(
            identity={**identity, "runId": "run-b"},
            policy_snapshot=policy,
            candidates_by_decision={},
            decide=lambda *_args: {"status": "selected"},
            execute_stage=lambda *_args: {"status": "completed"},
            approval={},
            execute_cafe24=lambda _binding: {"status": "staged_verified"},
            checkpoint=held["checkpoint"],
        )
