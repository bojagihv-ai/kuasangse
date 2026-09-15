from control_tower.backend.factory_sync import _product_progress_snapshot


def test_detail_request_trace_survives_product_progress_snapshot() -> None:
    projection = {
        "stages": [],
        "progress": {
            "stageKey": "final_detail",
            "percent": 86,
            "mode": "auto",
            "trace": {
                "schema": "factory-detail-stage-debug:v1",
                "correlationId": "job-1:workspace-1:run-1:7:abc",
                "jobId": "job-1",
                "workspaceId": "workspace-1",
                "runId": "run-1",
                "revision": 7,
                "phase": "request_timeout",
                "request": "헤더 텍스트",
                "sectionId": "hero",
                "sectionName": "대표",
                "errorCode": "factory_section_request_timeout",
                "at": 123,
                "requestTimeoutMs": 240000,
            },
        },
        "registration": {"status": "blocked", "blockers": ["final_detail_a_cut"]},
    }

    snapshot = _product_progress_snapshot(projection)

    assert snapshot is not None
    assert snapshot["trace"]["correlationId"] == "job-1:workspace-1:run-1:7:abc"
    assert snapshot["trace"]["phase"] == "request_timeout"
    assert snapshot["trace"]["errorCode"] == "factory_section_request_timeout"
    assert snapshot["trace"]["requestTimeoutMs"] == 240000

