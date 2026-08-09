from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services import vm_candidate_bridge


def test_read_job_reports_manual_verification_when_naver_detail_worker_fails_silently(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: the VM showed a Naver verification page, but the worker persisted a blank error.
    job_id = "vm_candidate_naver_silent_failure"
    request_path = tmp_path / "requests" / f"{job_id}.json"
    status_path = tmp_path / "results" / job_id / "status.json"
    request_path.parent.mkdir(parents=True)
    status_path.parent.mkdir(parents=True)
    request_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "operation": "detail_capture",
                "worker_payload": {
                    "products": [
                        {
                            "id": "naver_25854764348",
                            "platform": "naver",
                            "title": "수공예 호박 바늘쌈",
                            "product_url": "https://search.shopping.naver.com/catalog/25854764348",
                        },
                    ],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    status_path.write_text(
        json.dumps({"ok": False, "status": "error", "error": ""}),
        encoding="utf-8",
    )
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)

    # When
    result = vm_candidate_bridge.read_job(job_id)

    # Then: the UI receives a resumable manual gate instead of a blank terminal error.
    assert result["status"] == "manual_required"
    assert result["manual_action_required"] is True
    assert result["error_code"] == "naver_manual_verification_suspected"
    assert result["manual_items"][0]["manual_kind"] == "receipt_or_human_verification"
    assert result["manual_items"][0]["platform"] == "naver"


def test_read_job_keeps_non_naver_silent_failure_as_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a non-Naver detail job ended with the same blank worker error.
    job_id = "vm_candidate_other_silent_failure"
    request_path = tmp_path / "requests" / f"{job_id}.json"
    status_path = tmp_path / "results" / job_id / "status.json"
    request_path.parent.mkdir(parents=True)
    status_path.parent.mkdir(parents=True)
    request_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "operation": "detail_capture",
                "worker_payload": {
                    "products": [
                        {
                            "id": "coupang_1",
                            "platform": "coupang",
                            "product_url": "https://www.coupang.com/vp/products/1",
                        },
                    ],
                },
            },
        ),
        encoding="utf-8",
    )
    status_path.write_text(
        json.dumps({"ok": False, "status": "error", "error": ""}),
        encoding="utf-8",
    )
    monkeypatch.setattr(vm_candidate_bridge, "_BRIDGE_ROOT", tmp_path)

    # When
    result = vm_candidate_bridge.read_job(job_id)

    # Then: the Naver-only recovery must not hide unrelated worker failures.
    assert result["status"] == "error"
    assert result.get("manual_action_required") is not True
