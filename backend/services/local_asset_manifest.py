from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path

from services.local_asset_sources import JsonObject, LibraryIdentity, json_text


def write_library_manifest(
    root: Path,
    identity: LibraryIdentity,
    folder_names: tuple[str, ...],
    entries: list[JsonObject],
) -> None:
    payload: JsonObject = {
        "version": 1,
        "workspaceId": identity.workspace_id,
        "productName": identity.product_name,
        "productKey": identity.product_key,
        "inputImageFingerprint": identity.input_image_fingerprint,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "folders": list(folder_names),
        "assets": entries,
    }
    temporary = root / "manifest.json.tmp"
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(root / "manifest.json")
    readme = (
        "작업파일 이미지 자료함\n"
        "원본 보관소는 이동하거나 삭제하지 않고, 이 폴더에는 작업파일별 보기용 사본/하드링크를 정리합니다.\n"
        "01~02는 INPUT, 03~14는 OUTPUT입니다. 같은 이미지는 내용 해시로 중복 저장하지 않습니다.\n"
    )
    (root / "README.txt").write_text(readme, encoding="utf-8")


def existing_manifest_entries(
    root: Path,
    folder_names: tuple[str, ...],
) -> dict[str, JsonObject]:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        return {}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(manifest, dict) or not isinstance(manifest.get("assets"), list):
        return {}
    entries: dict[str, JsonObject] = {}
    for value in manifest["assets"]:
        if not isinstance(value, dict):
            continue
        source_key = json_text(value.get("sourceKey"))
        source_keys = value.get("sourceKeys")
        aliases = (
            [json_text(item) for item in source_keys]
            if isinstance(source_keys, list)
            else []
        )
        category = json_text(value.get("category"))
        filename = Path(json_text(value.get("file"))).name
        if (
            source_key
            and category in folder_names
            and filename
            and (root / category / filename).is_file()
        ):
            entries[source_key] = value
            for alias in aliases:
                if alias:
                    entries[alias] = value
    return entries


def remove_unreferenced_files(
    root: Path,
    folder_names: tuple[str, ...],
    entries: list[JsonObject],
) -> None:
    referenced = {
        (
            json_text(entry.get("category")),
            Path(json_text(entry.get("file"))).name,
        )
        for entry in entries
    }
    for category in folder_names:
        directory = root / category
        for path in directory.iterdir():
            if path.is_file() and (category, path.name) not in referenced:
                path.unlink()
