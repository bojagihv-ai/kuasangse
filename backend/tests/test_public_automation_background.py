from __future__ import annotations

from pathlib import Path

import pytest

from services import public_automation
from services.public_automation import PublicAutomationService


def test_background_completion_cannot_be_overwritten_by_queued_status(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = PublicAutomationService(tmp_path / "public-api")
    job = service.create_job("백그라운드 상태 경쟁 회귀")

    class InlineThread:
        def __init__(self, *, target, daemon: bool, name: str) -> None:
            self.target = target

        def start(self) -> None:
            self.target()

    def complete_immediately(job_id: str, mode: str, body: dict) -> dict:
        current = service.get_job(job_id)
        current["status"] = "completed"
        current["progress"] = 100
        current["progress_message"] = f"{mode} 생성이 완료되었습니다."
        return service._persist(current)

    # Given: the worker can complete before Thread.start() returns.
    monkeypatch.setattr(public_automation.threading, "Thread", InlineThread)
    monkeypatch.setattr(service, "_run_generation", complete_immediately)

    # When: generation is accepted as a background job.
    response = service.generate(job["id"], {"mode": "analysis"}, background=True)

    # Then: the completed state remains the persisted source of truth.
    assert response["accepted"] is True
    assert service.get_job(job["id"])["status"] == "completed"
