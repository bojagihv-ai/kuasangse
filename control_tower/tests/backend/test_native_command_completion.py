from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import pytest

from test_tab_command_backend import (
    TabEnvironment, complete_tab, queue_tab, tab_env, tab_payload, tab_receipt,
)
from test_tab_command_resume import editable_projection, field_receipt, assert_real_restore_keeps_values
from test_factory_sync import _product_projection, _product_checkpoint
from test_selection_checkpoint_persists import _complete_cut_order


def test_whole_fields_checkpoint_retains_all_original_overrides(tab_env: TabEnvironment) -> None:
    editable_projection(tab_env)
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "fields", "action": "commitAllFields",
        "value": {"fields": [{"fieldId": "material", "value": "면"}, {"fieldId": "sale_price", "value": "18000"}]}})
    receipt = field_receipt(tab_env, order, material="면", price="18000")
    assert complete_tab(tab_env, order, receipt).status_code == 200
    payload = tab_env.bridge.product_job_context(tab_env.job_id)["payload"]
    assert_real_restore_keeps_values(payload, {"material": "면", "salePrice": "18000", "usage": "주방용"})


def test_multi_use_toggle_off_preserves_other_selected_candidates(tab_env: TabEnvironment) -> None:
    tab_env.projection["stages"][0]["selectedIds"] = ["representative-a", "representative-b"]
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "assets", "action": "toggleAssetUse", "value": "representative-a"})
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["sequence"] += 1
    receipt["projection"]["stages"][0]["selectedIds"] = ["representative-b"]
    assert complete_tab(tab_env, order, receipt).status_code == 200
    assert tab_env.bridge.current_state()["stages"][0]["selectedIds"] == ["representative-b"]


def test_checkpoint_only_save_and_key_lookup_are_readback_not_new_execution(tab_env: TabEnvironment) -> None:
    before = deepcopy(tab_env.bridge.product_job_context(tab_env.job_id))
    payload = {**tab_payload(tab_env), "tabId": "workfile", "action": "save-checkpoint", "value": {}}
    order = queue_tab(tab_env, payload)
    receipt = tab_receipt(tab_env, order)
    assert complete_tab(tab_env, order, receipt).status_code == 200
    status = tab_env.client.get(f"/api/factory/jobs/{tab_env.job_id}/command-receipt/{payload['idempotencyKey']}").get_json()
    assert status["status"] == "completed"
    assert status["receipt"] == receipt
    assert status["orderId"] == order["orderId"]
    after = tab_env.bridge.product_job_context(tab_env.job_id)
    assert after["checkpoint"] == receipt["checkpoint"]
    assert after["payload"] == before["payload"]
    assert status["requestDigest"] == hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    duplicate = tab_env.client.post(f"/api/factory/jobs/{tab_env.job_id}/tab-command", json=payload, headers=tab_env.headers).get_json()
    assert duplicate["orderId"] == order["orderId"]


@pytest.mark.parametrize("selected", [[], ["representative-a", "representative-b"], ["representative-c"]])
def test_multi_use_receipt_cannot_remove_peers_or_skip_the_toggle(tab_env: TabEnvironment, selected: list[str]) -> None:
    tab_env.projection["stages"][0]["selectedIds"] = ["representative-a", "representative-b"]
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "assets", "action": "toggleAssetUse", "value": "representative-a"})
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["stages"][0]["selectedIds"] = selected
    receipt["projection"]["sequence"] += 1
    before = tab_env.bridge.current_state()
    assert complete_tab(tab_env, order, receipt).status_code == 422
    assert tab_env.bridge.current_state() == before


def test_save_local_draft_updates_resume_overrides_without_erasing_files(tab_env: TabEnvironment) -> None:
    editable_projection(tab_env)
    tab_env.projection["inputs"][-1]["items"][0]["fields"][0]["value"] = "로컬 초안"
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    before = deepcopy(tab_env.bridge.product_job_context(tab_env.job_id)["payload"])
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "workfile", "action": "save-checkpoint", "value": {}})
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["sequence"] = 12
    assert complete_tab(tab_env, order, receipt).status_code == 200
    after = tab_env.bridge.product_job_context(tab_env.job_id)["payload"]
    assert after["inputImages"] == before["inputImages"]
    assert_real_restore_keeps_values(after, {"material": "로컬 초안", "salePrice": "12000", "usage": "주방용"})


def test_key_lookup_does_not_cross_job_and_unknown_order_is_not_success(tab_env: TabEnvironment) -> None:
    order = queue_tab(tab_env)
    key = order["idempotencyKey"]
    result = tab_env.client.get(f"/api/factory/jobs/{tab_env.job_id}/command-receipt/{key}").get_json()
    assert result["status"] == "running"
    assert result["receipt"] is None
    assert tab_env.client.get(f"/api/factory/jobs/foreign/command-receipt/{key}").status_code == 404
    assert tab_env.client.get(f"/api/factory/jobs/{tab_env.job_id}/command-receipt/missing").status_code == 404


def test_select_receipt_remains_readable_by_the_original_key_after_the_event(tab_env: TabEnvironment) -> None:
    session = tab_env.projection["session"]
    payload = {"productId": session["productId"], "productKey": session["productKey"],
        "stageKey": "representative", "candidateId": "representative-b", "decisionMode": "manual",
        "expectedRevision": session["revision"], "expectedRunId": session["runId"],
        "expectedInputFingerprint": session["inputFingerprint"], "idempotencyKey": "native-select-once"}
    accepted = tab_env.client.post(f"/api/factory/jobs/{tab_env.job_id}/select", json=payload, headers=tab_env.headers)
    assert accepted.status_code == 202, accepted.get_json()
    applied = _product_projection(tab_env.job_id, sequence=120, revision=24)
    applied["stages"][0]["selectedIds"] = ["representative-b"]
    checkpoint = _product_checkpoint(tab_env.job_id, applied, status="waiting_manual", stage_key="representative")
    _complete_cut_order(tab_env.bridge, projection=applied, candidate_id="representative-b",
        extra={"status": "waiting_manual", "checkpoint": checkpoint, "idempotencyKey": payload["idempotencyKey"]})
    result = tab_env.client.get(f"/api/factory/jobs/{tab_env.job_id}/command-receipt/native-select-once").get_json()
    assert result["status"] == "completed"
    assert result["receipt"]["checkpoint"] == checkpoint
    assert result["orderId"] == accepted.get_json()["order"]["orderId"]
