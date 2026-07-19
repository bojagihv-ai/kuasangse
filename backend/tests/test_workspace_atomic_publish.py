from __future__ import annotations

from pathlib import Path

import pytest

from services.workspace_lock_service import WorkspaceLockService
from services.workspace_mutation import FileWrite, StagedFilesystemMutation


class InjectedMutationFailure(RuntimeError):
    pass


class CheckpointService(WorkspaceLockService):
    def __init__(self, state_path: Path, fail_at: str) -> None:
        super().__init__(state_path)
        self._fail_at = fail_at

    def _mutation_checkpoint(self, checkpoint: str) -> None:
        if checkpoint == self._fail_at:
            raise InjectedMutationFailure(checkpoint)


def _plan(target: Path, value: str = "B") -> StagedFilesystemMutation[str]:
    return StagedFilesystemMutation(
        result=value,
        changes=(FileWrite(target=target, content=value),),
    )


def _lease(service: WorkspaceLockService):
    return service.acquire("project:alpha", "A", "session-a", ttl_ms=30_000)


@pytest.mark.parametrize("checkpoint", ["before-stage", "after-stage"])
def test_stage_failure_leaves_effect_and_revision_unchanged(
    tmp_path: Path, checkpoint: str
) -> None:
    # Given: an accepted lease and a visible pre-mutation file.
    state_path = tmp_path / "authority.json"
    target = tmp_path / "last-work.json"
    target.write_text("A", encoding="utf-8")
    service = CheckpointService(state_path, checkpoint)
    lease = _lease(service)

    # When: failure is injected before the authority revision is published.
    with pytest.raises(InjectedMutationFailure):
        service.commit_mutation(
            "project:alpha",
            lease.lease_id,
            lease.fencing_token,
            expected_revision=0,
            next_revision=1,
            mutation=_plan(target),
        )

    # Then: neither the file nor the durable authority revision changed.
    assert target.read_text(encoding="utf-8") == "A"
    assert WorkspaceLockService(state_path).status("project:alpha").revision == 0
    assert list(tmp_path.glob("*.kuasangse-stage-*")) == []


def test_restart_recovers_publish_after_authority_revision_is_durable(tmp_path: Path) -> None:
    # Given: a staged file mutation whose authority commit will be interrupted.
    state_path = tmp_path / "authority.json"
    target = tmp_path / "last-work.json"
    target.write_text("A", encoding="utf-8")
    service = CheckpointService(state_path, "after-authority-persist")
    lease = _lease(service)

    # When: the process fails after revision 1 is durable but before file publication.
    with pytest.raises(InjectedMutationFailure):
        service.commit_mutation(
            "project:alpha",
            lease.lease_id,
            lease.fencing_token,
            expected_revision=0,
            next_revision=1,
            mutation=_plan(target),
        )
    assert target.read_text(encoding="utf-8") == "A"

    # Then: a fresh service recovers the pending publish before exposing status.
    restarted = WorkspaceLockService(state_path)
    assert restarted.status("project:alpha").revision == 1
    assert target.read_text(encoding="utf-8") == "B"
    assert list(tmp_path.glob("*.kuasangse-stage-*")) == []


def test_restart_finalizes_idempotently_after_publish_failure(tmp_path: Path) -> None:
    # Given: a mutation interrupted after its staged file became visible.
    state_path = tmp_path / "authority.json"
    target = tmp_path / "last-work.json"
    target.write_text("A", encoding="utf-8")
    service = CheckpointService(state_path, "after-publish")
    lease = _lease(service)

    # When: publication succeeds but final transaction cleanup is interrupted.
    with pytest.raises(InjectedMutationFailure):
        service.commit_mutation(
            "project:alpha",
            lease.lease_id,
            lease.fencing_token,
            expected_revision=0,
            next_revision=1,
            mutation=_plan(target),
        )
    assert target.read_text(encoding="utf-8") == "B"

    # Then: restart treats the already-published digest as complete and clears recovery state.
    restarted = WorkspaceLockService(state_path)
    assert restarted.status("project:alpha").revision == 1
    assert target.read_text(encoding="utf-8") == "B"
    assert restarted.status("project:alpha").revision == 1


def test_successful_atomic_publish_returns_result_with_matching_revision(tmp_path: Path) -> None:
    # Given: an accepted lease and a staged filesystem mutation.
    state_path = tmp_path / "authority.json"
    target = tmp_path / "last-work.json"
    target.write_text("A", encoding="utf-8")
    service = WorkspaceLockService(state_path)
    lease = _lease(service)

    # When: the mutation is committed without failure injection.
    snapshot, result = service.commit_mutation(
        "project:alpha",
        lease.lease_id,
        lease.fencing_token,
        expected_revision=0,
        next_revision=1,
        mutation=_plan(target),
    )

    # Then: visible content, returned result, and authority revision describe one publish.
    assert result == "B"
    assert snapshot.revision == 1
    assert target.read_text(encoding="utf-8") == "B"
