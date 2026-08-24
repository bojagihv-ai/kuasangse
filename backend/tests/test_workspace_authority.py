from __future__ import annotations

import threading
from pathlib import Path

import pytest
from flask import Flask

from routes.api_shared import api
from services.workspace_mutation import FileWrite, StagedFilesystemMutation


def _service_class():
    from services.workspace_lock_service import WorkspaceLockService

    return WorkspaceLockService


def test_two_process_services_issue_monotonic_fence_and_reject_stale_owner(
    tmp_path: Path,
) -> None:
    service_class = _service_class()
    store = tmp_path / "authority.json"
    first = service_class(store)
    second = service_class(store)

    lease_a = first.acquire("project:alpha", "창 A", "session-a", ttl_ms=30_000)
    blocked = second.acquire("project:alpha", "창 B", "session-b", ttl_ms=30_000)
    lease_b = second.acquire(
        "project:alpha", "창 B", "session-b", ttl_ms=30_000, confirmed_takeover=True
    )

    assert lease_a.granted is True
    assert blocked.granted is False
    assert blocked.code == "LEASE_HELD"
    assert lease_b.granted is True
    assert lease_b.fencing_token > lease_a.fencing_token
    with pytest.raises(service_class.Conflict) as stale:
        first.heartbeat(
            "project:alpha", lease_a.lease_id, lease_a.fencing_token, ttl_ms=30_000
        )
    assert stale.value.code == "STALE_FENCE"


def test_expiry_release_and_different_scopes_remain_independent(tmp_path: Path) -> None:
    service = _service_class()(tmp_path / "authority.json")
    alpha = service.acquire("project:alpha", "A", "a", ttl_ms=1_000, now_ms=1_000)
    beta = service.acquire("project:beta", "B", "b", ttl_ms=1_000, now_ms=1_000)
    alpha_after_expiry = service.acquire(
        "project:alpha", "C", "c", ttl_ms=1_000, now_ms=6_001
    )

    assert alpha.granted and beta.granted
    assert alpha.fencing_token == 1
    assert beta.fencing_token == 1
    assert alpha_after_expiry.granted
    assert alpha_after_expiry.fencing_token == 2
    assert service.release(
        "project:alpha", alpha_after_expiry.lease_id, alpha_after_expiry.fencing_token,
        now_ms=6_002,
    ).code == "RELEASED"
    assert service.status("project:alpha", now_ms=6_002).state == "available"


def test_interleaved_mutations_allow_only_current_fence(tmp_path: Path) -> None:
    service_class = _service_class()
    store = tmp_path / "authority.json"
    service_a = service_class(store)
    service_b = service_class(store)
    lease_a = service_a.acquire("project:alpha", "A", "a", ttl_ms=30_000)
    started = threading.Event()
    resume = threading.Event()
    destination = tmp_path / "destination.txt"
    stale_codes: list[str] = []

    def delayed_a() -> None:
        started.set()
        resume.wait(timeout=2)
        try:
            service_a.commit_mutation(
                "project:alpha",
                lease_a.lease_id,
                lease_a.fencing_token,
                expected_revision=0,
                next_revision=1,
                mutation=StagedFilesystemMutation(
                    result="A", changes=(FileWrite(destination, "A"),)
                ),
            )
        except service_class.Conflict as error:
            stale_codes.append(error.code)

    worker = threading.Thread(target=delayed_a)
    worker.start()
    assert started.wait(timeout=1)
    lease_b = service_b.acquire(
        "project:alpha", "B", "b", ttl_ms=30_000, confirmed_takeover=True
    )
    service_b.commit_mutation(
        "project:alpha",
        lease_b.lease_id,
        lease_b.fencing_token,
        expected_revision=0,
        next_revision=1,
        mutation=StagedFilesystemMutation(
            result="B", changes=(FileWrite(destination, "B"),)
        ),
    )
    resume.set()
    worker.join(timeout=2)

    assert destination.read_text(encoding="utf-8") == "B"
    assert stale_codes == ["STALE_FENCE"]
    assert service_b.status("project:alpha").revision == 1


def test_same_process_concurrent_services_do_not_deadlock_os_file_lock(
    tmp_path: Path,
) -> None:
    service_class = _service_class()
    store = tmp_path / "authority.json"
    barrier = threading.Barrier(8)
    errors: list[BaseException] = []
    tokens: list[int] = []

    def acquire(index: int) -> None:
        try:
            barrier.wait(timeout=2)
            lease = service_class(store).acquire(
                f"project:parallel-{index}", f"창 {index}", f"session-{index}", ttl_ms=30_000
            )
            tokens.append(lease.fencing_token)
        except BaseException as error:
            errors.append(error)

    workers = [threading.Thread(target=acquire, args=(index,)) for index in range(8)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=3)

    assert not any(worker.is_alive() for worker in workers)
    assert errors == []
    assert tokens == [1] * 8


@pytest.fixture()
def authority_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from routes import api_archive, api_workspace_lock

    service = _service_class()(tmp_path / "authority.json")
    monkeypatch.setattr(api_workspace_lock, "_SERVICE", service)
    monkeypatch.setattr(api_archive, "_LAST_WORK_SCOPED_DIR", str(tmp_path / "last-work"))
    archive_root = tmp_path / "local-archive"
    monkeypatch.setattr(api_archive.Config, "LOCAL_ARCHIVE_FOLDER", str(archive_root))
    monkeypatch.setattr(api_archive, "_LOCAL_ARCHIVE_INDEX_PATH", str(archive_root / "index.json"))
    app = Flask(__name__)
    app.register_blueprint(api, url_prefix="/api")
    return app.test_client(), service


def _acquire(client, scope: str, owner: str = "창 A") -> dict[str, str | int | bool]:
    response = client.post(
        "/api/workspace-lock/acquire",
        json={"workspaceId": scope, "ownerId": owner, "sessionId": owner, "ttlMs": 30_000},
    )
    assert response.status_code == 200
    return response.get_json()


def test_last_work_requires_preconditions_and_force_never_bypasses_fence(
    authority_client,
) -> None:
    client, _ = authority_client
    lease_a = _acquire(client, "project:alpha")
    missing = client.post(
        "/api/last-work?workspaceId=project:alpha", json={"snapshot": {"value": "x"}}
    )
    first = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {"value": "accepted"},
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease_a["leaseId"],
            "fencingToken": lease_a["fencingToken"],
        },
    )
    lease_b = client.post(
        "/api/workspace-lock/acquire",
        json={
            "workspaceId": "project:alpha",
            "ownerId": "창 B",
            "sessionId": "b",
            "ttlMs": 30_000,
            "confirmedTakeover": True,
        },
    ).get_json()
    stale_force = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {"value": "stale"},
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease_a["leaseId"],
            "fencingToken": lease_a["fencingToken"],
            "force": True,
        },
    )
    current = client.get("/api/last-work?workspaceId=project:alpha")

    assert missing.status_code == 428
    assert missing.get_json()["code"] == "PRECONDITION_REQUIRED"
    assert first.status_code == 200
    assert first.get_json()["revision"] == 1
    assert stale_force.status_code == 409
    assert stale_force.get_json()["code"] == "STALE_FENCE"
    assert current.get_json()["snapshot"]["value"] == "accepted"
    assert current.get_json()["revision"] == 1
    assert current.headers["ETag"] == '"workspace-rev-1"'
    assert lease_b["fencingToken"] > lease_a["fencingToken"]


def test_last_work_stale_revision_and_fenced_delete_have_stable_codes(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {"value": 1},
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    stale = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {"value": 2},
            "expectedRevision": 0,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    missing_delete = client.delete("/api/last-work?workspaceId=project:alpha")
    fenced_delete = client.delete(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )

    assert accepted.status_code == 200
    assert stale.status_code == 409
    assert stale.get_json()["code"] == "STALE_REVISION"
    assert missing_delete.status_code == 428
    assert fenced_delete.status_code == 200
    assert fenced_delete.get_json()["revision"] == 2


def test_richer_competitor_snapshot_keep_is_exact_protected_noop(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"compPage": {"analysisResult": {"analyzedAt": 100, "summary": "kept"}}},
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    kept = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": {"product": {"productName": "A"}}},
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    status = client.get("/api/workspace-lock/status?workspaceId=project:alpha")

    assert accepted.status_code == 200
    assert kept.status_code == 200
    assert kept.get_json()["accepted"] is False
    assert kept.get_json()["keptExisting"] is True
    assert kept.get_json()["protectedNoOp"] is True
    assert kept.get_json()["scopeId"] == "project:alpha"
    assert kept.get_json()["revision"] == 1
    assert status.get_json()["revision"] == 1


def test_richer_factory_snapshot_keep_is_exact_protected_noop(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {
                        "product": product,
                        "assets": [{"id": "asset-one"}, {"id": "asset-two"}],
                    },
                },
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    kept = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {
                        "product": product,
                        "assets": [{"id": "asset-one"}],
                    },
                },
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    status = client.get("/api/workspace-lock/status?workspaceId=project:alpha")
    restored = client.get("/api/last-work?workspaceId=project:alpha")

    assert accepted.status_code == 200
    assert kept.status_code == 200
    assert kept.get_json()["accepted"] is False
    assert kept.get_json()["keptExisting"] is True
    assert kept.get_json()["protectedNoOp"] is True
    assert kept.get_json()["scopeId"] == "project:alpha"
    assert kept.get_json()["revision"] == 1
    assert status.get_json()["revision"] == 1
    assert len(restored.get_json()["snapshot"]["assets"]["factory"]["assets"]) == 2


def test_named_option_cuts_cannot_regress_to_startup_defaults(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    completed_options = {
        "images": [{"id": "source-red", "archiveId": "archive-red"}],
        "slots": [{"id": "slot-red", "name": "1.빨강", "imgIds": ["source-red"]}],
        "optionResults": [{"id": "result-red", "imageUrl": "/api/local-archive/assets/result-red/image"}],
    }
    startup_defaults = {
        "images": [],
        "slots": [{"id": "slot-red", "name": "1번", "imgIds": []}],
        "optionResults": [],
    }
    completed_competitor = {
        "marketScrape": {
            "results": [{"id": "candidate-red"}],
            "vmResults": [{"id": "candidate-red"}],
            "selectedIds": ["candidate-red"],
            "detailResults": {"candidate-red": {"images": ["detail-red"]}},
        },
        "sectionPlan": {"header": {"headline": "kept"}},
    }
    startup_competitor = {
        "marketScrape": {"results": [], "vmResults": [], "selectedIds": [], "detailResults": {}},
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {"product": product},
                    "optionSorter": completed_options,
                    "compPage": completed_competitor,
                },
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    regressed = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {"product": product},
                    "optionSorter": startup_defaults,
                    "compPage": startup_competitor,
                },
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert regressed.status_code == 200
    assert regressed.get_json()["accepted"] is False
    assert regressed.get_json()["protectedNoOp"] is True
    assert restored["assets"]["optionSorter"] == completed_options
    assert restored["assets"]["compPage"] == completed_competitor


def test_same_count_sparse_derived_rows_cannot_erase_saved_content(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    completed = {
        "workspaceScope": {"id": "project:alpha"},
        "assets": {
            "factory": {"product": product},
            "optionSorter": {
                "images": [{"id": "source-red", "archiveId": "archive-red"}],
                "slots": [{"id": "slot-red", "name": "1.빨강", "imgIds": ["source-red"]}],
                "optionResults": [{"id": "result-red", "imageUrl": "/api/local-archive/assets/result-red/image"}],
            },
            "compPage": {
                "marketScrape": {
                    "results": [{"id": "candidate-red", "title": "보존 후보"}],
                    "selectedIds": ["candidate-red"],
                    "detailResults": {"candidate-red": {"images": ["detail-red"], "body": "보존 상세"}},
                },
                "analysisResult": {"analyzedAt": 100, "conclusion": "보존 분석"},
                "sectionPlan": {"hero": {"headline": "보존 플랜"}},
                "planEdits": {"hero": "보존 지시"},
            },
        },
    }
    sparse = {
        "workspaceScope": {"id": "project:alpha"},
        "assets": {
            "factory": {"product": product},
            "optionSorter": {
                "images": [{"id": "source-red", "archiveId": "archive-red"}],
                "slots": [{"id": "slot-red", "name": "1.빨강", "imgIds": []}],
                "optionResults": [{"id": "result-red"}],
            },
            "compPage": {
                "marketScrape": {
                    "results": [{"id": "candidate-red"}],
                    "selectedIds": ["candidate-red"],
                    "detailResults": {"candidate-red": {}},
                },
                "analysisResult": {"analyzedAt": 100},
                "sectionPlan": {"hero": {}},
                "planEdits": {"hero": ""},
            },
        },
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": completed,
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    regressed = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": sparse,
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )

    assert accepted.status_code == 200
    assert regressed.status_code == 200
    assert regressed.get_json()["accepted"] is False
    assert regressed.get_json()["protectedNoOp"] is True
    # 어느 칸이 비었는지까지 적어야 막힌 작업을 사람이 풀 수 있다.
    reason = regressed.get_json()["reason"]
    assert "optionSorter.slots.content" in reason
    assert reason.endswith("imgIds")


def test_richer_option_slots_may_replace_generated_row_ids(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    initial_slots = [
        {"id": "slot_1", "name": "1번", "imgIds": []},
        {"id": "slot_2", "name": "2번", "imgIds": []},
    ]
    matched_slots = [
        {"id": "slot_generated_red", "name": "1.빨강", "imgIds": ["image-red"]},
        {"id": "slot_generated_blue", "name": "2.파랑", "imgIds": ["image-blue"]},
    ]

    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {"product": product},
                    "optionSorter": {"images": [], "slots": initial_slots, "optionResults": []},
                },
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    updated = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {"product": product},
                    "optionSorter": {
                        "images": [{"id": "image-red"}, {"id": "image-blue"}],
                        "slots": matched_slots,
                        "optionResults": [],
                    },
                },
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert updated.status_code == 200
    assert updated.get_json()["accepted"] is True
    assert restored["assets"]["optionSorter"]["slots"] == matched_slots


def test_newer_explicit_candidate_selection_change_may_clear_selection(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    initial = {
        "workspaceScope": {"id": "project:alpha"},
        "assets": {
            "factory": {"product": product},
            "compPage": {
                "marketScrape": {
                    "results": [{"id": "candidate-red", "title": "보존 후보"}],
                    "selectedIds": ["candidate-red"],
                    "selectedImageIds": ["detail-red"],
                    "detailSelectionVersion": 4,
                    "detailResults": {"candidate-red": {"images": ["detail-red"], "body": "보존 상세"}},
                },
            },
        },
    }
    cleared = {
        "workspaceScope": {"id": "project:alpha"},
        "assets": {
            "factory": {"product": product},
            "compPage": {
                "marketScrape": {
                    "results": [{"id": "candidate-red", "title": "보존 후보"}],
                    "selectedIds": [],
                    "selectedImageIds": [],
                    "detailSelectionVersion": 5,
                    "detailResults": {"candidate-red": {"images": ["detail-red"], "body": "보존 상세"}},
                },
            },
        },
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": initial,
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    updated = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": cleared,
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert updated.status_code == 200
    assert updated.get_json()["accepted"] is True
    assert restored["assets"]["compPage"]["marketScrape"]["selectedIds"] == []
    assert restored["assets"]["compPage"]["marketScrape"]["detailResults"]["candidate-red"]["body"] == "보존 상세"


def test_grouped_competitor_candidates_cannot_regress_to_empty_snapshot(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    completed_competitor = {
        "marketScrape": {
            "results": [],
            "groupedResults": {"vm": [{"id": "candidate-red"}]},
            "selectedIds": [],
        },
    }
    startup_competitor = {
        "marketScrape": {"results": [], "groupedResults": {}, "selectedIds": []},
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": {"product": product}, "compPage": completed_competitor},
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    regressed = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": {"product": product}, "compPage": startup_competitor},
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )

    assert accepted.status_code == 200
    assert regressed.status_code == 200
    assert regressed.get_json()["accepted"] is False
    assert regressed.get_json()["protectedNoOp"] is True


def test_option_none_may_remove_only_the_color_option_section(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    base_assets = {
        "sectionContents": {"intro": {"html": "intro"}, "size_color": {"html": "color"}},
        "sectionImages": {"intro": "intro-image", "size_color": "color-image"},
        "factory": {
            "product": product,
            "automation": {"optionMode": "pending"},
            "stages": {"options": {"status": "idle"}},
            "assets": [{"id": "asset-one"}],
        },
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": base_assets,
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    option_none = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    **base_assets,
                    "sectionContents": {"intro": {"html": "intro"}},
                    "sectionImages": {"intro": "intro-image"},
                    "factory": {
                        **base_assets["factory"],
                        "automation": {"optionMode": "none"},
                        "stages": {"options": {"status": "done"}},
                    },
                },
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert option_none.status_code == 200
    assert option_none.get_json()["accepted"] is True
    assert option_none.get_json()["revision"] == 2
    assert restored["assets"]["factory"]["automation"]["optionMode"] == "none"
    assert "size_color" not in restored["assets"]["sectionContents"]
    assert "size_color" not in restored["assets"]["sectionImages"]


def test_completed_option_decision_cannot_regress_to_pending_after_restart(
    authority_client,
) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    completed_factory = {
        "product": product,
        "automation": {"optionMode": "none"},
        "stages": {"options": {"status": "done"}},
        "assets": [{"id": "asset-one"}],
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": completed_factory},
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    regressed = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {
                    "factory": {
                        **completed_factory,
                        "automation": {"optionMode": "pending"},
                        "stages": {"options": {"status": "idle"}},
                    },
                },
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    status = client.get("/api/workspace-lock/status?workspaceId=project:alpha").get_json()
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert regressed.status_code == 200
    assert regressed.get_json()["accepted"] is False
    assert regressed.get_json()["protectedNoOp"] is True
    assert status["revision"] == 1
    assert restored["assets"]["factory"]["automation"]["optionMode"] == "none"
    assert restored["assets"]["factory"]["stages"]["options"]["status"] == "done"


def test_local_archive_replica_requires_current_fence_without_advancing_revision(
    authority_client,
) -> None:
    from routes import api_archive

    client, service = authority_client
    lease_a = _acquire(client, "project:alpha")
    asset = {
        "id": "asset-one",
        "workspaceId": "alpha",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
        "stageId": "input",
        "content": {"value": 1},
    }
    missing = client.post("/api/local-archive/assets", json={"asset": asset})
    accepted = client.post(
        "/api/local-archive/assets",
        json={
            "asset": asset,
            "authorityWorkspaceId": "project:alpha",
            "expectedRevision": 0,
            "revision": 0,
            "leaseId": lease_a["leaseId"],
            "fencingToken": lease_a["fencingToken"],
        },
    )
    lease_b = client.post(
        "/api/workspace-lock/acquire",
        json={
            "workspaceId": "project:alpha",
            "ownerId": "창 B",
            "sessionId": "b",
            "ttlMs": 30_000,
            "confirmedTakeover": True,
        },
    ).get_json()
    stale = client.post(
        "/api/local-archive/assets",
        json={
            "asset": {**asset, "id": "asset-stale", "content": {"value": 2}},
            "authorityWorkspaceId": "project:alpha",
            "expectedRevision": 0,
            "revision": 0,
            "leaseId": lease_a["leaseId"],
            "fencingToken": lease_a["fencingToken"],
        },
    )

    assert missing.status_code == 428
    assert accepted.status_code == 200
    stored = api_archive._local_archive_load_index()["assets"]
    assert stored[0]["workspaceId"] == "alpha"
    assert stale.status_code == 409
    assert stale.get_json()["code"] == "STALE_FENCE"
    assert service.status("project:alpha").revision == 0
    assert lease_b["fencingToken"] > lease_a["fencingToken"]


def test_local_archive_accepts_current_offline_branch_without_project_lease(
    authority_client,
) -> None:
    from routes import api_archive

    client, _service = authority_client
    asset = {
        "id": "offline-branch-asset",
        "workspaceId": "offline-product-a",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
        "stageId": "hero",
        "content": {"value": 1},
    }

    response = client.post(
        "/api/local-archive/assets",
        json={
            "asset": asset,
            "authorityWorkspaceId": "draft:tab-branch-a",
            "expectedRevision": 3,
            "revision": 3,
        },
    )

    assert response.status_code == 200
    stored = api_archive._local_archive_load_index()["assets"]
    assert stored[0]["assetId"] == "offline-branch-asset"
    assert stored[0]["workspaceId"] == "offline-product-a"


def test_required_fields_cannot_be_erased_by_same_work_blank_snapshot(authority_client) -> None:
    client, _ = authority_client
    lease = _acquire(client, "project:alpha")
    product = {
        "productName": "A",
        "productKey": "product-a",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
    }
    required = {
        "size": {"manualValue": "가로21cm*세로14cm", "manualTouched": True},
        "width_mm": {"manualValue": "21cm", "manualTouched": True},
        "depth_mm": {"manualValue": "14cm", "manualTouched": True},
        "material": {"manualValue": "모시", "manualTouched": True},
        "usage": {"manualValue": "화장품용파우치,작은소품보관용", "manualTouched": True},
    }
    accepted = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": {"product": {**product, "dbFieldSettings": required}}},
            },
            "expectedRevision": 0,
            "revision": 1,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    blank = client.post(
        "/api/last-work?workspaceId=project:alpha",
        json={
            "snapshot": {
                "workspaceScope": {"id": "project:alpha"},
                "assets": {"factory": {"product": {**product, "dbFieldSettings": {}}}},
            },
            "expectedRevision": 1,
            "revision": 2,
            "leaseId": lease["leaseId"],
            "fencingToken": lease["fencingToken"],
        },
    )
    restored = client.get("/api/last-work?workspaceId=project:alpha").get_json()["snapshot"]

    assert accepted.status_code == 200
    assert blank.status_code == 200
    assert blank.get_json()["accepted"] is False
    assert blank.get_json()["keptExisting"] is True
    assert blank.get_json()["protectedNoOp"] is True
    assert blank.get_json()["reason"] == "incoming snapshot dropped protected required fields"
    assert restored["assets"]["factory"]["product"]["dbFieldSettings"] == required
