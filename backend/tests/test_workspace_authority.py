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


def test_local_archive_replica_requires_current_fence_without_advancing_revision(
    authority_client,
) -> None:
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
    assert stale.status_code == 409
    assert stale.get_json()["code"] == "STALE_FENCE"
    assert service.status("project:alpha").revision == 0
    assert lease_b["fencingToken"] > lease_a["fencingToken"]
