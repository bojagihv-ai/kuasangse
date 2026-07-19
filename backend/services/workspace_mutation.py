from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Generic, Literal, TypeVar, TypedDict, assert_never


ResultT = TypeVar("ResultT")


class PendingWriteRecord(TypedDict):
    action: Literal["write"]
    target: str
    staged: str
    digest: str


class PendingDeleteRecord(TypedDict):
    action: Literal["delete"]
    target: str


PendingOperationRecord = PendingWriteRecord | PendingDeleteRecord


class PendingMutationRecord(TypedDict):
    transactionId: str
    operations: list[PendingOperationRecord]


@dataclass(frozen=True, slots=True)
class MutationRecoveryError(RuntimeError):
    transaction_id: str
    target: Path
    reason: str

    def __str__(self) -> str:
        return f"mutation {self.transaction_id} cannot recover {self.target}: {self.reason}"


@dataclass(frozen=True, slots=True)
class FileWrite:
    target: Path
    content: str


@dataclass(frozen=True, slots=True)
class FileDelete:
    target: Path


FileChange = FileWrite | FileDelete


@dataclass(frozen=True, slots=True)
class PendingWrite:
    target: Path
    staged: Path
    digest: str


@dataclass(frozen=True, slots=True)
class PendingDelete:
    target: Path


PendingChange = PendingWrite | PendingDelete


def _digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


@dataclass(frozen=True, slots=True)
class PendingFilesystemMutation:
    transaction_id: str
    changes: tuple[PendingChange, ...]

    def publish(self) -> None:
        for change in self.changes:
            match change:
                case PendingWrite(target=target, staged=staged, digest=digest):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if staged.exists():
                        os.replace(staged, target)
                    if not target.exists() or _digest(target) != digest:
                        raise MutationRecoveryError(self.transaction_id, target, "digest mismatch")
                case PendingDelete(target=target):
                    target.unlink(missing_ok=True)
                case unreachable:
                    assert_never(unreachable)

    def cleanup(self) -> None:
        for change in self.changes:
            match change:
                case PendingWrite(staged=staged):
                    staged.unlink(missing_ok=True)
                case PendingDelete():
                    continue
                case unreachable:
                    assert_never(unreachable)

    def as_record(self) -> PendingMutationRecord:
        operations: list[PendingOperationRecord] = []
        for change in self.changes:
            match change:
                case PendingWrite(target=target, staged=staged, digest=digest):
                    operations.append({
                        "action": "write",
                        "target": str(target.resolve()),
                        "staged": str(staged.resolve()),
                        "digest": digest,
                    })
                case PendingDelete(target=target):
                    operations.append({
                        "action": "delete",
                        "target": str(target.resolve()),
                    })
                case unreachable:
                    assert_never(unreachable)
        return {"transactionId": self.transaction_id, "operations": operations}


@dataclass(frozen=True, slots=True)
class StagedFilesystemMutation(Generic[ResultT]):
    result: ResultT
    changes: tuple[FileChange, ...]

    def stage(self, transaction_id: str) -> PendingFilesystemMutation:
        pending: list[PendingChange] = []
        try:
            for index, change in enumerate(self.changes):
                match change:
                    case FileWrite(target=target, content=content):
                        target.parent.mkdir(parents=True, exist_ok=True)
                        staged = target.with_name(
                            f"{target.name}.kuasangse-stage-{transaction_id}-{index}.tmp"
                        )
                        with staged.open("w", encoding="utf-8", newline="") as output:
                            output.write(content)
                            output.flush()
                            os.fsync(output.fileno())
                        pending.append(PendingWrite(target.resolve(), staged.resolve(), _digest(staged)))
                    case FileDelete(target=target):
                        pending.append(PendingDelete(target.resolve()))
                    case unreachable:
                        assert_never(unreachable)
        except OSError:
            PendingFilesystemMutation(transaction_id, tuple(pending)).cleanup()
            raise
        return PendingFilesystemMutation(transaction_id, tuple(pending))


def pending_filesystem_mutation_from_record(
    value: PendingMutationRecord,
) -> PendingFilesystemMutation:
    transaction_id = str(value.get("transactionId") or "")
    changes: list[PendingChange] = []
    for operation in value.get("operations") or []:
        action = str(operation.get("action") or "")
        target = Path(str(operation.get("target") or ""))
        match action:
            case "write":
                changes.append(PendingWrite(
                    target=target,
                    staged=Path(str(operation.get("staged") or "")),
                    digest=str(operation.get("digest") or ""),
                ))
            case "delete":
                changes.append(PendingDelete(target=target))
            case _:
                raise MutationRecoveryError(transaction_id, target, f"unknown action {action}")
    return PendingFilesystemMutation(transaction_id, tuple(changes))
