from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import hashlib
import mimetypes
import os
from pathlib import Path
import re
import shutil
from typing import Protocol
from urllib.parse import unquote_to_bytes

from services.local_asset_archive_scan import scan_archive_records
from services.local_asset_manifest import (
    existing_manifest_entries,
    remove_unreferenced_files,
    write_library_manifest,
)
from services.local_asset_sources import (
    ImageSource,
    JsonObject,
    LibraryIdentity,
    collect_record_sources,
    collect_snapshot_sources,
    json_text,
)


LIBRARY_FOLDER_NAMES = (
    "01_INPUT_기본이미지",
    "02_INPUT_색상옵션",
    "03_OUTPUT_경쟁사후보",
    "04_OUTPUT_경쟁사선택",
    "05_OUTPUT_Cafe24후보",
    "06_OUTPUT_Cafe24선택",
    "07_OUTPUT_신화사DB후보",
    "08_OUTPUT_신화사DB선택",
    "09_OUTPUT_대표이미지",
    "10_OUTPUT_이미지컷",
    "11_OUTPUT_사이즈컷",
    "12_OUTPUT_색상옵션컷",
    "13_OUTPUT_섹션이미지",
    "14_OUTPUT_최종선택",
)

class ImageFetcher(Protocol):
    def __call__(self, url: str) -> tuple[str, bytes] | None: ...


@dataclass(frozen=True, slots=True)
class LibraryBuildRequest:
    archive_root: Path
    identity: LibraryIdentity
    snapshot: JsonObject
    archive_records: tuple[JsonObject, ...]
    fetch_image: ImageFetcher | None = None


@dataclass(frozen=True, slots=True)
class LibraryBuildResult:
    root: Path
    category_counts: dict[str, int]
    file_count: int
    pending_remote_count: int


def _safe_name(value: str, fallback: str, limit: int = 72) -> str:
    normalized = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", value.strip() or fallback)
    normalized = re.sub(r"\s+", "_", normalized).strip(" ._")
    normalized = re.sub(r"_+", "_", normalized)
    return (normalized[:limit].strip(" ._") or fallback)


def _decode_data_url(value: str) -> tuple[str, bytes] | None:
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", value, re.S)
    if not match:
        return None
    mime = (match.group(1) or "application/octet-stream").strip()
    payload = match.group(3) or ""
    try:
        raw = base64.b64decode(payload, validate=True) if match.group(2) else unquote_to_bytes(payload)
    except (binascii.Error, ValueError):
        return None
    return mime, raw


def _extension(mime: str, source_path: Path | None) -> str:
    if source_path and source_path.suffix:
        return source_path.suffix.lstrip(".").lower()
    extension = (mimetypes.guess_extension(mime) or ".bin").lstrip(".").lower()
    return "jpg" if extension == "jpe" else extension


def _source_payload(
    source: ImageSource,
    fetcher: ImageFetcher | None,
) -> tuple[str, bytes, Path | None] | None:
    local_path = Path(source.value) if not source.value.startswith(("data:", "http://", "https://")) else None
    decoded = _decode_data_url(source.value) if source.value.startswith("data:") else None
    fetched = fetcher(source.value) if source.value.startswith(("http://", "https://")) and fetcher else None
    if local_path and local_path.is_file():
        raw = local_path.read_bytes()
        mime = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    elif decoded:
        mime, raw = decoded
        local_path = None
    elif fetched:
        mime, raw = fetched
        local_path = None
    else:
        return None
    return mime, raw, local_path


def _materialize(
    source: ImageSource,
    target_dir: Path,
    payload: tuple[str, bytes, Path | None],
    digest: str,
) -> Path:
    mime, raw, local_path = payload
    extension = _extension(mime, local_path)
    filename = f"{_safe_name(source.title, 'image', 48)}__{digest[:10]}.{extension}"
    target = target_dir / filename
    if not target.exists():
        if local_path:
            try:
                os.link(local_path, target)
            except OSError:
                shutil.copy2(local_path, target)
        else:
            target.write_bytes(raw)
    return target


def workfile_library_root(archive_root: Path, identity: LibraryIdentity) -> Path:
    folder_name = _safe_name(
        f"{identity.product_name}__{identity.workspace_id}",
        "작업파일",
        120,
    )
    return archive_root / "작업파일별" / folder_name


def build_workfile_library(request: LibraryBuildRequest) -> LibraryBuildResult:
    root = workfile_library_root(request.archive_root, request.identity)
    category_dirs = {name: root / name for name in LIBRARY_FOLDER_NAMES}
    for directory in category_dirs.values():
        directory.mkdir(parents=True, exist_ok=True)

    sources = (
        collect_snapshot_sources(request.snapshot)
        + collect_record_sources(request.archive_records, request.identity)
        + collect_record_sources(
            scan_archive_records(request.archive_root, request.identity),
            request.identity,
        )
    )
    unique_sources = {
        (source.category, source.value): source
        for source in sources
        if source.category in category_dirs and source.value
    }
    entries_by_source = existing_manifest_entries(root, LIBRARY_FOLDER_NAMES)
    entries_by_content = {
        (
            json_text(entry.get("category")),
            json_text(entry.get("contentHash")),
        ): entry
        for entry in entries_by_source.values()
        if json_text(entry.get("category"))
        and json_text(entry.get("contentHash"))
    }
    pending_remote_count = 0
    for source in unique_sources.values():
        source_key = hashlib.sha256(
            f"{source.category}\0{source.value}".encode("utf-8", errors="ignore")
        ).hexdigest()
        if source_key in entries_by_source:
            continue
        payload = _source_payload(source, request.fetch_image)
        if payload is None:
            if source.value.startswith(("http://", "https://")):
                pending_remote_count += 1
            continue
        digest = hashlib.sha256(payload[1]).hexdigest()
        content_key = (source.category, digest)
        existing_entry = entries_by_content.get(content_key)
        if existing_entry is not None:
            aliases = existing_entry.get("sourceKeys")
            source_keys = {
                json_text(existing_entry.get("sourceKey")),
                source_key,
            }
            if isinstance(aliases, list):
                source_keys.update(json_text(item) for item in aliases)
            existing_entry["sourceKeys"] = sorted(key for key in source_keys if key)
            entries_by_source[source_key] = existing_entry
            continue
        path = _materialize(
            source,
            category_dirs[source.category],
            payload,
            digest,
        )
        entry: JsonObject = {
            "category": source.category,
            "title": source.title,
            "file": path.name,
            "contentHash": digest,
            "sourceKey": source_key,
            "sourceKeys": [source_key],
            "source": source.source,
        }
        entries_by_source[source_key] = entry
        entries_by_content[content_key] = entry

    entries = list({
        (
            json_text(entry.get("category")),
            json_text(entry.get("contentHash")),
        ): entry
        for entry in entries_by_source.values()
    }.values())
    entries.sort(
        key=lambda item: (
            json_text(item.get("category")),
            json_text(item.get("file")),
        )
    )
    remove_unreferenced_files(root, LIBRARY_FOLDER_NAMES, entries)
    write_library_manifest(
        root,
        request.identity,
        LIBRARY_FOLDER_NAMES,
        entries,
    )
    category_counts = {
        name: sum(
            1
            for entry in entries
            if json_text(entry.get("category")) == name
        )
        for name in LIBRARY_FOLDER_NAMES
    }
    return LibraryBuildResult(
        root=root,
        category_counts=category_counts,
        file_count=sum(category_counts.values()),
        pending_remote_count=pending_remote_count,
    )
