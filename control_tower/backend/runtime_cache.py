from __future__ import annotations

import json
import os
import re
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Final, TypeAlias, assert_never


JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
_CACHE_FILE: Final = "runtime-cache.json"
_CACHE_AUTHORITY: Final = "remote-pdp-control-v1"
_FORBIDDEN_KEY: Final = re.compile(r"(?:authorization|bearer|secret|password|credential|access.?token|refresh.?token|api.?key)", re.IGNORECASE)


class RuntimeCacheError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class CacheValueError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _validate_cache_value(value: JsonValue, path: str = "$") -> JsonValue:
    match value:
        case dict() as mapping:
            result: JsonObject = {}
            for key, child in mapping.items():
                if _FORBIDDEN_KEY.search(key):
                    raise CacheValueError("cache_secret_forbidden")
                result[key] = _validate_cache_value(child, f"{path}.{key}")
            return result
        case list() as values:
            return [_validate_cache_value(child, f"{path}[{index}]") for index, child in enumerate(values)]
        case str() | int() | float() | bool() | None:
            return value
        case unreachable:
            assert_never(unreachable)


def _parse_json_value(value: JsonValue, path: str = "$") -> JsonValue:
    match value:
        case dict() as mapping:
            return {key: _parse_json_value(child, f"{path}.{key}") for key, child in mapping.items()}
        case list() as values:
            return [_parse_json_value(child, f"{path}[{index}]") for index, child in enumerate(values)]
        case str() | int() | float() | bool() | None:
            return value
        case unreachable:
            assert_never(unreachable)


class ReplayableRuntimeCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = root / _CACHE_FILE
        self.root.mkdir(parents=True, exist_ok=True)
        self._entries = self._read()

    def get(self, cache_key: str) -> JsonObject | None:
        value = self._entries.get(cache_key)
        return None if value is None else dict(value)

    def put(self, cache_key: str, payload: Mapping[str, JsonValue]) -> None:
        if not cache_key.strip():
            raise CacheValueError("cache_key_missing")
        normalized = _validate_cache_value(dict(payload))
        match normalized:
            case dict() as value:
                self._entries[cache_key] = value
            case unreachable:
                assert_never(unreachable)
        self._write()

    def _read(self) -> dict[str, JsonObject]:
        if not self.path.exists():
            return {}
        try:
            raw = _parse_json_value(json.loads(self.path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, RuntimeCacheError) as error:
            raise RuntimeCacheError("cache_read_failed") from error
        if not isinstance(raw, dict) or raw.get("authority") != _CACHE_AUTHORITY:
            raise RuntimeCacheError("cache_authority_invalid")
        entries = raw.get("entries")
        if not isinstance(entries, dict):
            raise RuntimeCacheError("cache_entries_invalid")
        result: dict[str, JsonObject] = {}
        for key, value in entries.items():
            if not isinstance(value, dict):
                raise RuntimeCacheError("cache_entry_invalid")
            result[key] = value
        return result

    def _write(self) -> None:
        document: JsonObject = {
            "authority": _CACHE_AUTHORITY,
            "schemaVersion": 1,
            "entries": self._entries,
        }
        handle = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self.root,
            prefix="runtime-cache-",
            suffix=".tmp",
            delete=False,
        )
        temp_path = Path(handle.name)
        try:
            with handle:
                json.dump(document, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            temp_path.replace(self.path)
        except OSError as error:
            temp_path.unlink(missing_ok=True)
            raise RuntimeCacheError("cache_write_failed") from error
