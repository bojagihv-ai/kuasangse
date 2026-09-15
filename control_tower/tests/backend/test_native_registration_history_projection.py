from copy import deepcopy
import json

from control_tower.backend.factory_sync import FactorySyncBridge, _ProductJob, _public_hydration_projection
from control_tower.backend.runtime_cache import JsonObject


def test_native_history_survives_public_reload_without_approval_or_private_fields() -> None:
    identity: JsonObject = {
        "jobId": "factory-job-native", "workspaceId": "batch:factory-job-native",
        "productId": "cafe24:3024", "productKey": "전통꽃자수파우치",
        "runId": "registered-run", "inputFingerprint": "registered-input",
    }
    remote: JsonObject = {
        "productNo": "3024", "productName": "전통 꽃자수 파우치", "optionName": "색상",
        "representativeImageCount": 4, "detailImageCount": 14, "variantCount": 2,
        "optionValues": ["자주", "빨강"],
        "inventoryByOption": {"자주": {"quantity": "99", "useInventory": "T"},
                              "빨강": {"quantity": "99", "useInventory": "T"}},
    }
    receipt: JsonObject = {
        **identity, "schema": "factory-cafe24-native-registration-history:v1", "status": "verified",
        "receiptId": "native-registration:3024", "identitySource": "registration-preflight",
        "registeredAt": "2026-09-05T13:00:00.000Z", "remoteReadback": remote,
    }
    dirty = deepcopy(receipt)
    dirty["approvalToken"] = "PRIVATE_TOKEN"
    dirty["rawPayload"] = {"private": "PRIVATE_PAYLOAD"}
    dirty_remote = deepcopy(remote)
    dirty_remote["rawImage"] = "PRIVATE_IMAGE"
    dirty["remoteReadback"] = dirty_remote
    source: JsonObject = {"session": {"revision": 220}, "registration": {
        "jobId": identity["jobId"], "status": "approval_required", "approvalTokenState": "missing",
        "publicationReceipt": dirty,
    }, "receipts": [dirty]}
    before = deepcopy(source)
    payload: JsonObject = {
        "expectedWorkspaceId": identity["workspaceId"], "expectedProductId": identity["productId"],
        "expectedProductKey": identity["productKey"], "expectedRunId": "edited-run",
        "expectedInputFingerprint": "edited-input", "fileName": "파우치.kuasangse", "expectedSha256": "a" * 64,
    }

    result = _public_hydration_projection(json.loads(json.dumps(source)), payload)

    assert result["registration"] == {"jobId": identity["jobId"], "status": "approval_required",
                                      "approvalTokenState": "missing", "publicationReceipt": receipt}
    assert result["receipts"] == [receipt]
    assert "PRIVATE_" not in json.dumps(result)
    assert source == before


def test_public_job_exposes_only_checkpoint_run_for_restore_button() -> None:
    job = _ProductJob(job_id="job-native", payload={"batchId": "batch-native", "mode": "manual",
                      "productName": "파우치"}, checkpoint={"runId": "saved-run", "private": "PRIVATE_CHECKPOINT"})

    public = FactorySyncBridge()._public_product_job(job)

    assert public["checkpointRunId"] == "saved-run"
    assert public["checkpointAvailable"] is True
    assert "PRIVATE_CHECKPOINT" not in json.dumps(public)
