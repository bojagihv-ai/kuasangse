from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Final, TypeAlias


JsonValue: TypeAlias = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]
SUPPORTED_EXTENSIONS: Final = frozenset({"jpg", "jpeg", "png", "webp"})
BASE_NAME: Final = re.compile(r"^(?P<ordinal>[0-9]+)\.(?P<extension>jpg|jpeg|png|webp)$", re.IGNORECASE)
COLOR_NAME: Final = re.compile(r"^(?P<ordinal>[0-9]+)\.(?P<color>[^.\\/]+)\.(?P<extension>jpg|jpeg|png|webp)$", re.IGNORECASE)
ALLOWED_COLOR_CHARS: Final = re.compile(r"^[\w\s-]+$", re.UNICODE)


class IntakeError(Exception):
    def __init__(self, code: str, path: str) -> None:
        self.code = code
        self.path = path
        super().__init__(code, path)

    def __str__(self) -> str:
        return f"{self.code}:{self.path}"


def _ensure_directory(path: Path, code: str) -> Path:
    if path.is_symlink() or not path.is_dir():
        raise IntakeError(code, str(path))
    return path.resolve()


def _ensure_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file():
        raise IntakeError("unsafe_file", str(path))
    return path.resolve()


def _read_metadata(product_root: Path) -> Mapping[str, JsonValue]:
    metadata_path = _ensure_file(product_root / "product.json")
    try:
        value = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IntakeError("product_json_invalid", str(metadata_path)) from error
    if not isinstance(value, dict):
        raise IntakeError("product_json_invalid", str(metadata_path))
    return value


def _ordinal(raw: str, path: Path) -> int:
    value = int(raw)
    if value < 1:
        raise IntakeError("ordinal_invalid", str(path))
    return value


def _digest(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise IntakeError("file_read_failed", str(path)) from error


def _file_entries(directory: Path, *, colors: bool) -> list[tuple[int, str | None, str, str, str]]:
    entries: list[tuple[int, str | None, str, str, str]] = []
    try:
        children = tuple(directory.iterdir())
    except OSError as error:
        raise IntakeError("directory_read_failed", str(directory)) from error
    for child in children:
        if child.is_symlink() or not child.is_file():
            raise IntakeError("unsafe_file", str(child))
        match = COLOR_NAME.fullmatch(child.name) if colors else BASE_NAME.fullmatch(child.name)
        if match is None:
            raise IntakeError("filename_invalid", str(child))
        extension = match.group("extension").lower()
        if extension not in SUPPORTED_EXTENSIONS:
            raise IntakeError("image_type_unsupported", str(child))
        ordinal = _ordinal(match.group("ordinal"), child)
        color = match.group("color").strip() if colors else None
        if colors and (not color or ALLOWED_COLOR_CHARS.fullmatch(color) is None):
            raise IntakeError("color_name_invalid", str(child))
        entries.append((ordinal, color, child.name, extension, _digest(_ensure_file(child))))
    return entries


def _check_unique(entries: Iterable[tuple[int, str | None, str, str, str]], code: str) -> None:
    seen: set[tuple[int, str]] = set()
    for ordinal, color, _name, _extension, _digest_value in entries:
        key = (ordinal, "" if color is None else color.casefold())
        if key in seen:
            raise IntakeError(code, f"{ordinal}:{color or 'base'}")
        seen.add(key)


def _fingerprint(entries: Iterable[tuple[int, str | None, str, str, str]]) -> str:
    canonical = "".join(
        f"{ordinal:08d}\0{color or ''}\0{name}\0{digest_value}\n"
        for ordinal, color, name, _extension, digest_value in sorted(entries, key=lambda item: (item[0], item[1] or "", item[2]))
    )
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _product_id(metadata: Mapping[str, JsonValue], fingerprint: str) -> str:
    for key in ("productId", "externalId"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value is not None:
            raise IntakeError("product_id_invalid", f"$.{key}")
    return f"product-{fingerprint.removeprefix('sha256:')[:16]}"


def parse_product_folder(product_root: Path, batch_id: str, workspace_id: str, current_run_id: str) -> JsonObject:
    root = _ensure_directory(product_root, "product_directory_invalid")
    metadata = _read_metadata(root)
    base_root = _ensure_directory(root / "base", "base_directory_invalid")
    colors_root = _ensure_directory(root / "colors", "colors_directory_invalid")
    base_entries = _file_entries(base_root, colors=False)
    color_entries = _file_entries(colors_root, colors=True)
    if not base_entries:
        raise IntakeError("base_image_missing", str(base_root))
    if not base_entries and not color_entries:
        raise IntakeError("input_image_missing", str(root))
    _check_unique(base_entries, "duplicate_base_sequence")
    _check_unique(color_entries, "duplicate_color_sequence")
    all_entries = base_entries + color_entries
    fingerprint = _fingerprint(all_entries)
    product_id = _product_id(metadata, fingerprint)
    primary_value = metadata.get("primaryBaseSequence")
    primary = min(entry[0] for entry in base_entries) if primary_value is None else primary_value
    if type(primary) is not int or not any(entry[0] == primary for entry in base_entries):
        raise IntakeError("primary_base_missing", "$.primaryBaseSequence")
    ordered_base = sorted(base_entries, key=lambda entry: (entry[0] != primary, entry[0], entry[2]))
    ordered_colors = sorted(color_entries, key=lambda entry: (entry[0], entry[1] or "", entry[2]))
    ordered = ordered_base + ordered_colors
    images: list[JsonObject] = []
    for ordinal, color, name, extension, digest_value in ordered:
        role = "base" if color is None else "color-option"
        image_id = f"{product_id}:{role}:{ordinal}:{color or 'base'}"
        images.append(
            {
                "imageId": image_id,
                "role": role,
                "ordinal": ordinal,
                "colorName": color,
                "fileName": name,
                "sha256": digest_value,
                "evidenceRefs": [],
            },
        )
    if len(images) < 2:
        raise IntakeError("input_image_count_invalid", str(root))
    return {
        "contractType": "product-manifest",
        "contractVersion": "1.0.0",
        "capabilityVersion": "1.0.0",
        "batchId": batch_id,
        "productId": product_id,
        "productKey": product_id,
        "workspaceId": workspace_id,
        "currentRunId": current_run_id,
        "inputImageFingerprint": fingerprint,
        "workfileRevision": 0,
        "inputImages": images,
        "evidenceRefs": [],
    }

