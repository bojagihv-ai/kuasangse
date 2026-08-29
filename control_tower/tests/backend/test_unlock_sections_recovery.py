"""잠긴 섹션을 화면에서 풀 수 있어야 한다.

잠근 섹션은 「섹션 다시 만들기」가 일부러 보존하고 개별 재생성도 거부한다. 그래서
잠긴 채로 잘못된 내용이 들어 있으면 몇 번을 다시 만들어도 그대로인데, 푸는 길이
앱 화면에만 있어 관제탑에서 일하는 사람은 빠져나올 수 없었다 — 실측 2026-08-29:
specifications 하나 때문에 재생성 네 번이 헛돌았다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from control_tower.backend.factory_sync import FactorySyncBridge, FactorySyncError


def test_unlock_sections_is_an_allowed_recovery_action() -> None:
    assert "unlock-sections" in FactorySyncBridge.RECOVERY_ACTIONS


def test_the_other_recovery_actions_are_still_allowed() -> None:
    # 새 갈래를 더하면서 기존 되살리기를 떨어뜨리지 않는다.
    assert "clear-cafe24-target" in FactorySyncBridge.RECOVERY_ACTIONS
    assert "regenerate-sections" in FactorySyncBridge.RECOVERY_ACTIONS


def test_an_unknown_recovery_action_is_still_refused(tmp_path: Path) -> None:
    bridge = FactorySyncBridge(state_path=tmp_path / "jobs.json")
    with pytest.raises(FactorySyncError) as raised:
        bridge.queue_product_recovery("factory-job-none", "wipe-everything")
    assert raised.value.code in {
        "factory_recovery_action_invalid",
        "factory_product_job_not_found",
    }


def test_board_offers_the_unlock_button_next_to_the_other_recovery_buttons() -> None:
    board = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "production-board.mjs"
    ).read_text(encoding="utf-8")
    assert "action: 'recover-unlock'" in board
    assert "섹션 잠금 풀기" in board
    # 되살리기 셋은 같은 조건 아래 함께 뜬다.
    assert "action: 'recover-clear-target'" in board
    assert "action: 'recover-sections'" in board
    assert "recoverJob(target.dataset.jobId, 'unlock-sections')" in board


def test_the_runtime_command_contract_accepts_the_new_action() -> None:
    contract = (
        Path(__file__).resolve().parents[3] / "src" / "modules" / "batch-control-contract.mjs"
    ).read_text(encoding="utf-8")
    assert "'unlock-sections'" in contract
