from __future__ import annotations

import json
import os
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TypeVar

from services.workspace_mutation import (
    StagedFilesystemMutation,
    pending_filesystem_mutation_from_record,
)


_PROCESS_LOCKS: dict[Path, threading.RLock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()
ResultT = TypeVar("ResultT")


def _process_lock(path: Path) -> threading.RLock:
    resolved = path.resolve()
    with _PROCESS_LOCKS_GUARD:
        return _PROCESS_LOCKS.setdefault(resolved, threading.RLock())


class WorkspaceLockStore:
    def __init__(self, state_path: Path | str) -> None:
        self._state_path = Path(state_path)
        self._lock_path = self._state_path.with_suffix(self._state_path.suffix + ".lock")
        self._process_lock = _process_lock(self._lock_path)

    @contextmanager
    def _locked(self) -> Iterator[None]:
        with self._process_lock:
            self._lock_path.parent.mkdir(parents=True, exist_ok=True)
            with self._lock_path.open("a+b") as lock_file:
                lock_file.seek(0, os.SEEK_END)
                if lock_file.tell() == 0:
                    lock_file.write(b"0")
                    lock_file.flush()
                lock_file.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    lock_file.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    def _read_raw(self) -> dict:
        try:
            value = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {"schema": 1, "workspaces": {}}
        return value if isinstance(value, dict) else {"schema": 1, "workspaces": {}}

    def _read(self) -> dict:
        state = self._read_raw()
        recovered = False
        for record in state.get("workspaces", {}).values():
            pending_record = record.get("pendingMutation")
            if not isinstance(pending_record, dict):
                continue
            pending = pending_filesystem_mutation_from_record(pending_record)
            pending.publish()
            record.pop("pendingMutation", None)
            recovered = True
        if recovered:
            self._write(state)
        return state

    def _write(self, state: dict) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._state_path.with_name(
            f"{self._state_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("w", encoding="utf-8", newline="") as output:
                json.dump(state, output, ensure_ascii=False, separators=(",", ":"))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self._state_path)
        finally:
            temporary.unlink(missing_ok=True)

    def _mutation_checkpoint(self, checkpoint: str) -> None:
        return None

    def _pending_is_durable(self, scope: str, transaction_id: str) -> bool:
        record = self._record(self._read_raw(), scope)
        pending = record.get("pendingMutation")
        return isinstance(pending, dict) and pending.get("transactionId") == transaction_id

    def _commit_staged_mutation(
        self,
        state: dict,
        record: dict,
        scope: str,
        next_revision: int,
        mutation: StagedFilesystemMutation[ResultT],
    ) -> ResultT:
        transaction_id = uuid.uuid4().hex
        pending = None
        try:
            self._mutation_checkpoint("before-stage")
            pending = mutation.stage(transaction_id)
            self._mutation_checkpoint("after-stage")
        except (OSError, RuntimeError):
            pending and pending.cleanup()
            raise

        previous_revision = int(record.get("revision") or 0)
        record["revision"] = int(next_revision)
        record["pendingMutation"] = pending.as_record()
        try:
            self._write(state)
        except OSError:
            if not self._pending_is_durable(scope, transaction_id):
                record["revision"] = previous_revision
                record.pop("pendingMutation", None)
                pending.cleanup()
            raise

        self._mutation_checkpoint("after-authority-persist")
        pending.publish()
        self._mutation_checkpoint("after-publish")
        record.pop("pendingMutation", None)
        self._write(state)
        self._mutation_checkpoint("after-finalize")
        return mutation.result

    @staticmethod
    def _record(state: dict, scope: str) -> dict:
        workspaces = state.setdefault("workspaces", {})
        return workspaces.setdefault(
            scope, {"nextFencingToken": 0, "revision": 0, "lease": None}
        )
