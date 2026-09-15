from __future__ import annotations

from test_factory_sync import _manual_product_job_payload
from test_parallel_production_board import _live_worker
from test_tab_command_backend import TabEnvironment, tab_env


def test_open_checkpoint_never_starts_generation_even_for_current_waiting_product(tab_env: TabEnvironment) -> None:
    response = tab_env.client.post(
        f"/api/factory/jobs/{tab_env.job_id}/resume",
        json={"restoreOnly": True}, headers=tab_env.headers,
    )
    assert response.status_code == 202, response.get_json()
    order = tab_env.bridge.claim(_live_worker())["order"]
    payload = order["command"]["payload"]
    assert payload["restoreOnly"] is True
    assert payload["startFresh"] is False
    assert payload["checkpoint"]["jobId"] == tab_env.job_id


def test_normal_resume_still_requires_a_cut_and_restore_only_is_strict_boolean(tab_env: TabEnvironment) -> None:
    url = f"/api/factory/jobs/{tab_env.job_id}/resume"
    normal = tab_env.client.post(url, json={}, headers=tab_env.headers)
    assert normal.status_code == 409
    assert normal.get_json()["error"]["code"] == "factory_decision_required"
    invalid = tab_env.client.post(url, json={"restoreOnly": "true"}, headers=tab_env.headers)
    assert invalid.status_code == 422


def test_open_checkpoint_does_not_interrupt_another_running_product(tab_env: TabEnvironment) -> None:
    tab_env.bridge.queue_product(_manual_product_job_payload(suffix="another-running"))
    running_order = tab_env.bridge.claim(_live_worker())["order"]
    response = tab_env.client.post(
        f"/api/factory/jobs/{tab_env.job_id}/resume",
        json={"restoreOnly": True}, headers=tab_env.headers,
    )
    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "factory_worker_busy"
    assert running_order["command"]["payload"]["jobId"] != tab_env.job_id


def test_open_request_preserves_an_existing_selection_reservation(tab_env: TabEnvironment) -> None:
    tab_env.bridge.reserve_product_selection(tab_env.job_id, {"stageKey": "representative", "candidateId": "representative-b"})
    before = tab_env.bridge.product_jobs()
    response = tab_env.client.post(
        f"/api/factory/jobs/{tab_env.job_id}/resume",
        json={"restoreOnly": True}, headers=tab_env.headers,
    )
    assert response.status_code == 409
    assert response.get_json()["error"]["code"] in {"factory_worker_busy", "factory_selection_pending"}
    assert tab_env.bridge.product_jobs() == before
