from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Callable

from .runtime_cache import JsonObject, JsonValue


class ReviewConflict(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class ReviewTask:
    review_id: str
    product_id: str
    decision_type: str
    expected_version: int
    status: str
    candidate_ids: tuple[str, ...]
    dedupe_key: str


def _dedupe_key(product_id: str, decision_type: str, candidate_ids: tuple[str, ...], expected_version: int) -> str:
    raw = json.dumps([product_id, decision_type, candidate_ids, expected_version], separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ReviewService:
    def __init__(self, enqueue: Callable[[str], None] | None = None) -> None:
        self._tasks: dict[str, ReviewTask] = {}
        self._enqueue = enqueue

    def create(self, product_id: str, decision_type: str, candidate_ids: list[str], expected_version: int) -> ReviewTask:
        normalized = tuple(dict.fromkeys(item.strip() for item in candidate_ids if item.strip()))
        if not product_id.strip() or not decision_type.strip() or expected_version < 0:
            raise ReviewConflict("review_payload_invalid")
        dedupe_key = _dedupe_key(product_id, decision_type, normalized, expected_version)
        existing = self._tasks.get(dedupe_key)
        if existing is not None:
            return existing
        task = ReviewTask(f"review-{dedupe_key[:16]}", product_id, decision_type, expected_version, "open", normalized, dedupe_key)
        self._tasks[dedupe_key] = task
        return task

    def resolve(self, review_id: str, *, selected_candidate_id: str | None, expected_version: int, new_version: int) -> ReviewTask:
        task = next((item for item in self._tasks.values() if item.review_id == review_id), None)
        if task is None:
            raise ReviewConflict("review_missing")
        if task.status != "open" or expected_version != task.expected_version or new_version <= expected_version:
            raise ReviewConflict("review_stale_version")
        if selected_candidate_id is None or selected_candidate_id not in task.candidate_ids:
            raise ReviewConflict("review_candidate_invalid")
        resolved = ReviewTask(task.review_id, task.product_id, task.decision_type, new_version, "resolved", task.candidate_ids, task.dedupe_key)
        self._tasks[task.dedupe_key] = resolved
        if self._enqueue is not None:
            self._enqueue(task.product_id)
        return resolved
