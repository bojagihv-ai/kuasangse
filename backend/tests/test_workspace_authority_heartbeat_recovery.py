from __future__ import annotations

from pathlib import Path

import pytest

from services.workspace_lock_service import WorkspaceLockService


def test_expired_lease_heartbeat_recovers_when_no_new_owner_acquired(
    tmp_path: Path,
) -> None:
    # Given: the browser-owned lease expired while its background timer was throttled.
    service = WorkspaceLockService(tmp_path / "authority.json")
    original = service.acquire(
        "project:background-tab",
        "사용자 창",
        "session-a",
        ttl_ms=5_000,
        now_ms=1_000,
    )

    # When: the same browser resumes and sends its delayed heartbeat.
    recovered = service.heartbeat(
        "project:background-tab",
        original.lease_id,
        original.fencing_token,
        ttl_ms=30_000,
        now_ms=7_000,
    )

    # Then: the exact lease is renewed because no competing owner replaced it.
    assert recovered.granted is True
    assert recovered.code == "HEARTBEAT_OK"
    assert recovered.lease_id == original.lease_id
    assert recovered.fencing_token == original.fencing_token
    assert recovered.expires_at == 37_000


def test_expired_lease_heartbeat_stays_rejected_after_new_owner_acquired(
    tmp_path: Path,
) -> None:
    # Given: A expired and B acquired a newer fenced lease.
    service = WorkspaceLockService(tmp_path / "authority.json")
    lease_a = service.acquire(
        "project:background-tab",
        "창 A",
        "session-a",
        ttl_ms=5_000,
        now_ms=1_000,
    )
    lease_b = service.acquire(
        "project:background-tab",
        "창 B",
        "session-b",
        ttl_ms=30_000,
        now_ms=7_000,
    )

    # When/Then: A cannot revive after ownership has moved to B.
    with pytest.raises(WorkspaceLockService.Conflict) as stale:
        service.heartbeat(
            "project:background-tab",
            lease_a.lease_id,
            lease_a.fencing_token,
            ttl_ms=30_000,
            now_ms=7_001,
        )
    assert stale.value.code == "STALE_FENCE"
    assert lease_b.fencing_token > lease_a.fencing_token
