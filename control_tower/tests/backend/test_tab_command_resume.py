from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess

import pytest

from test_parallel_production_board import _live_worker
from test_tab_command_backend import (
    TabEnvironment, complete_tab, queue_tab, tab_env, tab_payload, tab_receipt,
)


def editable_projection(env: TabEnvironment) -> None:
    env.projection["sequence"] = 10
    env.projection["stages"][0]["selectedIds"] = ["representative-a"]
    env.projection["inputs"].append({"key": "operator_controls", "count": 1, "items": [{
        "schema": "factory-operator-controls:v1", "fields": [
            {"fieldId": "material", "value": "스테인리스"},
            {"fieldId": "sale_price", "value": "12000"},
        ],
    }]})
    env.bridge.accept_projection(env.projection)


def field_receipt(env: TabEnvironment, order, *, material="철", price="12000"):
    receipt = tab_receipt(env, order)
    receipt["projection"]["sequence"] = 11
    receipt["projection"]["inputs"][-1]["items"][0]["fields"] = [
        {"fieldId": "material", "value": material},
        {"fieldId": "sale_price", "value": price},
    ]
    return receipt


def assert_real_restore_keeps_values(payload, expected) -> None:
    program = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = fs.readFileSync('src/app-core-03.js', 'utf8');
const start = source.indexOf('async function factoryRuntimeControlRestoreRequiredValues(');
const end = source.indexOf('\nfunction factoryRuntimeControlCompetitorSnapshot(', start);
if (start < 0 || end < 0) throw Error('restore function missing');
const draft = { product: { finalDb: {}, confirmedDb: {}, requirementsSnapshot: {} }, automation: {} };
const context = { state: { productInfoManualValues: {} }, factoryRuntimeDetachedValue: structuredClone,
  factoryRuntimeUpdateOwnedFactory: async (action, owner, mutate) => mutate(draft),
  factoryRuntimeControlApplyProvidedColorOptions: () => true };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.factoryRuntimeControlRestoreRequiredValues(request.payload).then(() => {
  for (const [key, expected] of Object.entries(request.expected)) {
    if (draft.product.finalDb[key] !== expected || draft.product.confirmedDb[key] !== expected
      || context.state.productInfoManualValues[key] !== expected) throw Error('restored stale field: ' + key);
  }
}).catch(error => { console.error(error.message); process.exitCode = 1; });
"""
    result = subprocess.run(
        ["node", "-e", program], input=json.dumps({"payload": payload, "expected": expected}),
        text=True, capture_output=True, timeout=20, cwd=Path(__file__).resolve().parents[3],
    )
    assert result.returncode == 0, result.stderr


def test_commit_field_receipt_updates_only_that_override_before_resume(tab_env: TabEnvironment) -> None:
    editable_projection(tab_env)
    before = deepcopy(tab_env.bridge.product_job_context(tab_env.job_id)["payload"])
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "fields", "action": "commitField",
                               "value": {"fieldId": "material", "value": "철"}})
    receipt = field_receipt(tab_env, order)
    assert complete_tab(tab_env, order, receipt).status_code == 200
    after = tab_env.bridge.product_job_context(tab_env.job_id)["payload"]
    assert after == {**before, "requiredValues": {**before["requiredValues"], "material": "철"}}
    tab_env.bridge.resume_product(tab_env.job_id)
    runtime = tab_env.bridge.claim(_live_worker())["order"]["command"]["payload"]
    assert runtime["checkpoint"] == receipt["checkpoint"]
    assert runtime["inputImages"] == before["inputImages"]
    assert_real_restore_keeps_values(runtime, {"material": "철", "salePrice": "12000"})


def test_db_confirmation_updates_known_values_without_erasing_other_overrides(tab_env: TabEnvironment) -> None:
    editable_projection(tab_env)
    before = deepcopy(tab_env.bridge.product_job_context(tab_env.job_id)["payload"])
    identity = {"type": "sinhwa", "candidateKey": "db-1", "productNo": "", "jcode": "1",
                "productCode": "db-1", "scopeKey": "scope", "identityKey": "identity"}
    order = queue_tab(tab_env, {**tab_payload(tab_env), "action": "apply-db-candidate",
                               "value": {"candidateIdentity": identity}})
    receipt = field_receipt(tab_env, order, material="면", price="18000")
    receipt["projection"]["inputs"][0]["items"] = [{"dbSelectedId": "db-1"}]
    assert complete_tab(tab_env, order, receipt).status_code == 200
    after = tab_env.bridge.product_job_context(tab_env.job_id)["payload"]
    assert after == {**before, "requiredValues": {**before["requiredValues"], "material": "면", "salePrice": "18000"}}
    tab_env.bridge.resume_product(tab_env.job_id)
    runtime = tab_env.bridge.claim(_live_worker())["order"]["command"]["payload"]
    assert_real_restore_keeps_values(runtime, {"material": "면", "salePrice": "18000", "usage": "주방용"})


@pytest.mark.parametrize("material,price", [("원하지 않은 값", "12000"), ("철", "1"), ("", "12000")])
def test_field_receipt_must_prove_requested_value_and_preserve_unrelated_fields(tab_env, material, price):
    editable_projection(tab_env)
    order = queue_tab(tab_env, {**tab_payload(tab_env), "tabId": "fields", "action": "commitField",
                               "value": {"fieldId": "material", "value": "철"}})
    before = tab_env.bridge._mutable_state_snapshot_locked()
    response = complete_tab(tab_env, order, field_receipt(tab_env, order, material=material, price=price))
    assert response.status_code == 422
    assert tab_env.bridge._mutable_state_snapshot_locked() == before
