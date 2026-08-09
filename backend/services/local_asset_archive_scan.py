from __future__ import annotations

import json
from pathlib import Path
import re

from services.local_asset_sources import (
    JsonObject,
    LibraryIdentity,
    json_object,
    json_text,
)


_STAGE_BY_CATEGORY = {
    "input-images": "input",
    "size-images": "size",
    "option-images": "options",
    "hero-images": "hero",
    "cut-images": "cuts",
    "detail-page-files": "detail",
}


def _safe_segment(value: str) -> str:
    return re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", value).strip(" ._")


def _matches(identity: LibraryIdentity, metadata: JsonObject) -> bool:
    archived = json_object(metadata.get("identity"))
    workspace = json_text(archived.get("workspaceId"))
    same_workspace = workspace == identity.workspace_id
    matching_draft = (
        workspace.startswith("draft:")
        and json_text(archived.get("productKey")) == identity.product_key
        and json_text(archived.get("inputImageFingerprint"))
        == identity.input_image_fingerprint
    )
    return same_workspace or matching_draft


def _load_metadata(path: Path) -> JsonObject:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _image_path(asset_dir: Path) -> Path | None:
    return next(
        (
            path
            for path in sorted(asset_dir.glob("image.*"))
            if path.is_file()
        ),
        None,
    )


def _product_roots(
    archive_root: Path,
    identity: LibraryIdentity,
) -> list[Path]:
    workfiles = archive_root / "workfiles"
    if not workfiles.is_dir():
        return []
    product_names = {
        _safe_segment(identity.product_name),
        _safe_segment(identity.product_key),
    }
    roots: list[Path] = []
    for workspace_dir in workfiles.iterdir():
        assets_dir = workspace_dir / "assets"
        if not assets_dir.is_dir():
            continue
        roots.extend(
            product_dir
            for product_name in product_names
            if product_name
            for product_dir in (assets_dir / product_name,)
            if product_dir.is_dir()
        )
    return roots


def scan_archive_records(
    archive_root: Path,
    identity: LibraryIdentity,
) -> tuple[JsonObject, ...]:
    records: list[JsonObject] = []
    for product_root in _product_roots(archive_root, identity):
        for metadata_path in product_root.rglob("metadata.json"):
            metadata = _load_metadata(metadata_path)
            if not metadata or not _matches(identity, metadata):
                continue
            image_path = _image_path(metadata_path.parent)
            if image_path is None:
                continue
            archived = json_object(metadata.get("identity"))
            category = json_text(metadata.get("category"))
            stage = (
                json_text(metadata.get("stageId"))
                or json_text(archived.get("stageId"))
                or _STAGE_BY_CATEGORY.get(category, "")
            )
            records.append({
                "workspaceId": json_text(archived.get("workspaceId")),
                "productKey": json_text(archived.get("productKey")),
                "inputImageFingerprint": json_text(
                    archived.get("inputImageFingerprint")
                ),
                "stageId": stage,
                "category": category,
                "title": json_text(metadata.get("title")) or metadata_path.parent.name,
                "files": {"imagePath": str(image_path)},
            })
    return tuple(records)
