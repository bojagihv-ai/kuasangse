from __future__ import annotations

import json
from pathlib import Path
from typing import Final

import pytest

from control_tower.backend.runtime_authority import (
    AuthorityConflict,
    PdpControlAuthority,
    RemoteAuthorityTransport,
)
from control_tower.backend.runtime_cache import ReplayableRuntimeCache
from control_tower.backend.runtime_cache import JsonObject


WORK_ORDER: Final = {
    "batchId": "batch-001",
    "productId": "product-001",
    "productKey": "product-001",
    "currentRunId": "run-001",
    "stageId": "validate",
    "attempt": 1,
    "inputImageFingerprint": "a" * 64,
    "expectedWorkfileRevision": 3,
    "idempotencyKey": "order-001",
}


class FakeRemoteAuthority:
    def __init__(self) -> None:
        self.calls: list[tuple[str, JsonObject]] = []
        self.job: JsonObject = {
            "jobId": "job-001",
            "status": "queued",
            "version": 4,
        }

    def claim_worker(self, order: JsonObject) -> JsonObject:
        self.calls.append(("claim", order))
        return {"orderId": "order-001", "jobId": "job-001", "status": "claimed", "version": 5}

    def append_event(self, event: JsonObject) -> JsonObject:
        self.calls.append(("event", event))
        return {"eventId": "event-001", "eventSequence": 1, "status": "accepted"}

    def get_job(self, job_id: str) -> JsonObject:
        self.calls.append(("get_job", {"jobId": job_id}))
        return dict(self.job)


def test_runtime_cache_round_trips_only_replayable_metadata_without_sqlite(tmp_path: Path) -> None:
    # Given: 로컬 업무 원장이 아닌 재생성 가능한 캐시를 준비한다.
    cache = ReplayableRuntimeCache(tmp_path)

    # When: 원격 작업의 상태 요약과 응답 다이제스트만 캐시한다.
    cache.put(
        "job:job-001",
        {"jobId": "job-001", "status": "queued", "remoteDigest": "b" * 64},
    )

    # Then: 캐시는 다시 읽히고 SQLite나 비밀정보 파일을 만들지 않아야 한다.
    restored = ReplayableRuntimeCache(tmp_path)
    assert restored.get("job:job-001") == {
        "jobId": "job-001",
        "status": "queued",
        "remoteDigest": "b" * 64,
    }
    assert list(tmp_path.glob("*.sqlite*")) == []
    cache_file = tmp_path / "runtime-cache.json"
    assert json.loads(cache_file.read_text(encoding="utf-8"))["authority"] == "remote-pdp-control-v1"


def test_runtime_cache_rejects_secret_like_payload_fields(tmp_path: Path) -> None:
    # Given: 재생성 가능한 캐시와 토큰처럼 보이는 payload를 준비한다.
    cache = ReplayableRuntimeCache(tmp_path)

    # When/Then: 인증정보를 로컬 cache에 기록하려는 시도는 거부되어야 한다.
    with pytest.raises(ValueError, match="cache_secret_forbidden"):
        cache.put("job:job-001", {"authorization": "Bearer hidden"})


def test_authority_commits_remote_event_before_caching_checkpoint(tmp_path: Path) -> None:
    # Given: 신화사 PDP 원장으로 위임하는 작업 권위 어댑터를 준비한다.
    remote = FakeRemoteAuthority()
    authority = PdpControlAuthority(remote, ReplayableRuntimeCache(tmp_path))

    # When: 작업 이벤트를 기록한다.
    result = authority.append_event({**WORK_ORDER, "eventSequence": 1, "status": "running"})

    # Then: 원격 commit이 먼저 수행되고 cache는 원격 영수증 요약만 보관해야 한다.
    assert remote.calls[0][0] == "event"
    assert result["eventId"] == "event-001"
    assert authority.cache.get("checkpoint:product-001") == {
        "eventId": "event-001",
        "eventSequence": 1,
        "status": "accepted",
    }


def test_authority_conflict_does_not_leave_a_local_checkpoint(tmp_path: Path) -> None:
    # Given: 오래된 원격 revision을 거부하는 transport를 준비한다.
    class StaleTransport(FakeRemoteAuthority):
        def append_event(self, event: JsonObject) -> JsonObject:
            self.calls.append(("event", event))
            raise AuthorityConflict("stale_version")

    authority = PdpControlAuthority(StaleTransport(), ReplayableRuntimeCache(tmp_path))

    # When/Then: 원격 conflict를 로컬 성공으로 바꾸지 않아야 한다.
    with pytest.raises(AuthorityConflict):
        authority.append_event({**WORK_ORDER, "eventSequence": 1, "status": "running"})
    assert authority.cache.get("checkpoint:product-001") is None


def test_recovery_reads_remote_job_and_uses_cache_only_as_non_authoritative_hint(tmp_path: Path) -> None:
    # Given: 원격 job과 오래된 cache 힌트를 함께 준비한다.
    remote = FakeRemoteAuthority()
    cache = ReplayableRuntimeCache(tmp_path)
    cache.put("job:job-001", {"jobId": "job-001", "status": "completed", "remoteDigest": "old"})
    authority = PdpControlAuthority(remote, cache)

    # When: 재시작 복구용 job을 읽는다.
    job = authority.recover_job("job-001")

    # Then: 원격 상태가 기준이며 cache는 새 원격 요약으로 갱신되어야 한다.
    assert job == {"jobId": "job-001", "status": "queued", "version": 4}
    assert remote.calls == [("get_job", {"jobId": "job-001"})]
    assert cache.get("job:job-001") == job
