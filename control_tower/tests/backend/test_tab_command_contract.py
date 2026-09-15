from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
import subprocess

import pytest

from control_tower.backend.factory_sync import FactorySyncError, _assert_tab_command_preservation
from test_tab_command_backend import (
    TabEnvironment, complete_tab, queue_tab, read_execution, tab_env, tab_payload, tab_receipt,
)


def test_finished_job_tab_order_passes_actual_browser_contract(tab_env: TabEnvironment) -> None:
    tab_env.bridge._product_jobs[tab_env.job_id].stage_key = ""
    payload = {**tab_payload(tab_env), "tabId": "fields", "action": "commitField",
               "value": {"fieldId": "stock", "value": "99", "label": "기본 재고"}}
    order = queue_tab(tab_env, payload)
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import fs from 'node:fs'; import {validateOrder} from './src/modules/batch-control-contract.mjs'; "
         "const order=validateOrder(JSON.parse(fs.readFileSync(0,'utf8'))); "
         "console.log(JSON.stringify(order.command.payload.value));"],
        input=json.dumps(order), capture_output=True, text=True, encoding="utf-8",
        cwd=Path(__file__).parents[3], timeout=15, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == payload["value"]


def test_saving_adds_document_archive_without_losing_or_replacing_existing_content(tab_env: TabEnvironment) -> None:
    before = deepcopy(tab_env.projection)
    before["stages"].append({"key": "final_detail", "selectedIds": ["document-a"],
                             "candidates": [{"id": "document-a", "kind": "html", "documentArchiveId": "", "label": "14 sections"}]})
    after = deepcopy(before)
    after["stages"][-1]["candidates"][0]["documentArchiveId"] = "be1bc585c9299c19"
    command = {**tab_payload(tab_env), "tabId": "fields", "action": "commitField",
               "value": {"fieldId": "stock", "value": "99"}}
    _assert_tab_command_preservation(before, after, command)
    before = deepcopy(after)
    for value in ("", "aaaaaaaaaaaaaaaa"):
        after["stages"][-1]["candidates"][0]["documentArchiveId"] = value
        with pytest.raises(FactorySyncError, match="factory_tab_command_state_reduced"):
            _assert_tab_command_preservation(before, after, command)


@pytest.mark.parametrize("tab,action,value", [
    ("fields", "commitField", {"fieldId": "material", "value": "철", "label": "재질"}),
    ("competitor", "guideAction", "search"),
    ("competitor", "marketAction", {"type": "collect-details", "selectedIds": ["candidate-a"]}),
    ("sections", "updateSectionInstruction", {"sectionId": "hero", "value": "지시"}),
    ("sections", "updateSectionAssemblySource", {"sectionId": "hero", "sourceId": "product", "selected": True}),
    ("sections", "updateSectionAssemblyCutUsage", {"sectionId": "hero", "cutUsage": "background"}),
    ("sections", "updateSectionAssemblyCut", {"sectionId": "hero", "cutAssetKey": "cut-a"}),
    ("sections", "updateSectionAssemblyNote", {"sectionId": "hero", "note": "메모"}),
    ("sections", "saveManualSection", {"sectionId": "hero", "content": {"headline": "제목"}}),
    ("sections", "applySectionVariant", {"sectionId": "hero", "variantId": "variant-a"}),
    ("sections", "generateSection", {"sectionId": "hero"}),
    ("sections", "setSectionBasisMode", {"sectionId": "hero", "basisId": "product"}),
    ("sections", "setSectionGenerationMode", {"sectionId": "hero", "modeId": "manual"}),
    ("sections", "updateSectionOrder", ["hero", "size"]),
    ("sections", "setSectionEnabled", {"sectionId": "hero", "enabled": False}),
    ("db", "confirm-no-db-candidate", None), ("db", "confirm-no-cafe24-candidate", {}),
    ("db", "clear-db-candidate", None), ("db", "clear-cafe24-candidate", {}),
    ("db", "restore-detached-db", None),
])
def test_allowed_values_are_forwarded_without_an_extra_wrapper(tab_env, tab, action, value):
    payload = {**tab_payload(tab_env), "tabId": tab, "action": action, "value": value}
    order = queue_tab(tab_env, payload)
    assert order["command"]["payload"] == payload
    receipt = tab_receipt(tab_env, order)
    if tab == "fields":
        receipt["projection"]["inputs"].append({"key": "operator_controls", "items": [{"fields": [value]}]})
    assert complete_tab(tab_env, order, receipt).status_code == 200
    assert not tab_env.bridge.has_pending()


def test_operator_controls_changes_and_added_images_preserve_existing_assets(tab_env: TabEnvironment) -> None:
    tab_env.projection["inputs"].extend([
        {"key": "operator_controls", "count": 1, "items": [{"db": {"query": "old"}}]},
        {"key": "source_images", "count": 1, "items": [{"id": "image-a"}]},
    ])
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    order = queue_tab(tab_env)
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["sequence"] += 1
    receipt["projection"]["inputs"][-2]["items"][0]["db"]["query"] = "new"
    receipt["projection"]["inputs"][-1]["count"] = 2
    receipt["projection"]["inputs"][-1]["items"].append({"id": "image-b"})
    response = complete_tab(tab_env, order, receipt)
    assert response.status_code == 200, response.get_json()
    assert len(tab_env.bridge.current_state()["inputs"][-1]["items"]) == 2


@pytest.mark.parametrize("field,value", [("count", 0), ("items", [])])
def test_original_input_images_cannot_be_reduced(tab_env, field, value):
    tab_env.projection["inputs"].append({"key": "source_images", "count": 1, "items": [{"id": "image-a"}]})
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    order = queue_tab(tab_env)
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["sequence"] += 1
    receipt["projection"]["inputs"][-1][field] = value
    assert complete_tab(tab_env, order, receipt).status_code == 422


@pytest.mark.parametrize("proof", ["valid", "different-key", "different-product", "missing-selection"])
def test_cafe24_product_transition_requires_exact_selection_receipt(tab_env, proof):
    identity = {"type": "cafe24", "candidateKey": "candidate-3001", "productNo": "3001",
                "jcode": "", "productCode": "P0001", "scopeKey": "scope", "identityKey": "identity"}
    payload = {**tab_payload(tab_env), "action": "apply-cafe24-candidate", "value": {"candidateIdentity": identity}}
    order = queue_tab(tab_env, payload)
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["session"]["productId"] = "cafe24:3001"
    receipt["projection"]["registration"]["productId"] = "cafe24:3001"
    receipt["checkpoint"]["productId"] = "cafe24:3001"
    receipt["projection"]["inputs"][0]["items"] = [{"cafe24SelectedId": "candidate-3001"}]
    if proof == "different-key":
        receipt["projection"]["inputs"][0]["items"][0]["cafe24SelectedId"] = "foreign"
    if proof == "different-product":
        receipt["projection"]["session"]["productId"] = "cafe24:9999"
        receipt["projection"]["registration"]["productId"] = "cafe24:9999"
        receipt["checkpoint"]["productId"] = "cafe24:9999"
    if proof == "missing-selection":
        receipt["projection"]["inputs"][0]["items"] = []
    response = complete_tab(tab_env, order, receipt)
    assert response.status_code == (200 if proof == "valid" else 409), response.get_json()
    if proof == "valid":
        assert tab_env.bridge.product_job_context(tab_env.job_id)["checkpoint"]["productId"] == "cafe24:3001"


def test_heartbeat_keeps_long_collection_running_for_fifteen_minutes(tab_env: TabEnvironment, monkeypatch) -> None:
    order = queue_tab(tab_env)
    now = tab_env.bridge._clock()
    for minute in range(1, 16):
        monkeypatch.setattr(tab_env.bridge, "_clock", lambda minute=minute: now + minute * 60)
        result = tab_env.bridge.lifecycle(order["orderId"], "heartbeat", {
            **order, "workerId": "factory-worker-live", "eventSequence": 1,
        })
        assert result["accepted"] is True
        assert read_execution(tab_env, order)["status"] == "running"
    assert complete_tab(tab_env, order, tab_receipt(tab_env, order)).status_code == 200


@pytest.mark.parametrize("status", ["blocked", "completed"])
def test_previous_status_and_stage_are_restored_on_success(tab_env, status):
    tab_env.bridge._product_jobs[tab_env.job_id].status = status
    order = queue_tab(tab_env)
    receipt = tab_receipt(tab_env, order)
    receipt["checkpoint"]["status"] = status
    assert complete_tab(tab_env, order, receipt).status_code == 200
    assert tab_env.bridge.product_job_context(tab_env.job_id)["job"]["status"] == status
    assert not tab_env.bridge.has_pending()


def test_seeded_projection_without_admitted_worker_is_rejected(tab_env: TabEnvironment) -> None:
    tab_env.bridge._factory_session = None
    with pytest.raises(FactorySyncError, match="factory_worker_build_not_admitted"):
        tab_env.bridge.queue_tab_command(tab_env.job_id, tab_payload(tab_env))


def test_receipt_poll_does_not_expose_command_payload_or_credentials(tab_env: TabEnvironment) -> None:
    order = queue_tab(tab_env)
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["apiKey"] = "not-public"
    assert complete_tab(tab_env, order, receipt).status_code == 200
    status = read_execution(tab_env, order)
    assert "command" not in status and "payload" not in status
    assert "not-public" not in str(status)


@pytest.mark.parametrize("action", ["clear-cafe24-candidate", "confirm-no-cafe24-candidate"])
def test_explicit_cafe24_deselection_can_restore_local_product_identity(tab_env, action):
    tab_env.projection["session"]["productId"] = "cafe24:3001"
    tab_env.projection["registration"]["productId"] = "cafe24:3001"
    tab_env.projection["sequence"] += 1
    tab_env.bridge.accept_projection(tab_env.projection)
    tab_env.bridge._product_jobs[tab_env.job_id].checkpoint["productId"] = "cafe24:3001"
    order = queue_tab(tab_env, {**tab_payload(tab_env), "action": action, "value": None})
    receipt = tab_receipt(tab_env, order)
    receipt["projection"]["sequence"] += 1
    product_id = f"factory:{tab_env.projection['session']['productKey']}"
    receipt["projection"]["session"]["productId"] = product_id
    receipt["projection"]["registration"]["productId"] = product_id
    receipt["checkpoint"]["productId"] = product_id
    receipt["projection"]["inputs"][0]["items"] = [{"cafe24SelectedId": ""}]
    response = complete_tab(tab_env, order, receipt)
    assert response.status_code == 200, response.get_json()
    assert tab_env.bridge.product_job_context(tab_env.job_id)["checkpoint"]["productId"] == product_id
