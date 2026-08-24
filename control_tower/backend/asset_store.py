from __future__ import annotations

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import tempfile
from threading import RLock
from typing import Final

from .runtime_cache import JsonObject


ASSET_REF = re.compile(r"^sha256-[a-f0-9]{64}$")
MEDIA_TYPE = re.compile(r"^image/[A-Za-z0-9][A-Za-z0-9.+-]{0,62}$")
ASSET_MANIFEST_SCHEMA: Final = "factory-input-asset:v1"


class AssetStoreError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def parse_image_data_url(data_url: str) -> tuple[str, bytes]:
    """data:image/...;base64,... 를 (media_type, bytes) 로 푼다."""
    prefix, separator, encoded = str(data_url).partition(",")
    if not separator or not prefix.startswith("data:") or not prefix.endswith(";base64"):
        raise AssetStoreError("factory_asset_data_url_invalid")
    media_type = prefix[len("data:") : -len(";base64")]
    if MEDIA_TYPE.fullmatch(media_type) is None:
        raise AssetStoreError("factory_asset_media_type_invalid")
    try:
        content = b64decode(encoded, validate=True)
    except (Base64Error, ValueError) as error:
        raise AssetStoreError("factory_asset_data_url_invalid") from error
    if not content:
        raise AssetStoreError("factory_asset_data_url_invalid")
    return media_type, content


class ProductAssetStore:
    """관제 상태 문서에서 무거운 입력 이미지를 분리해 보관하는 content-addressed 저장소.

    상태 JSON 에는 assetRef 만 남기므로 작업이 늘어도 상태 저장 비용이 늘지 않는다.
    같은 내용의 이미지는 여러 작업이 공유해도 한 벌만 저장된다.
    """

    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._lock = RLock()

    @property
    def root(self) -> Path:
        return self._root

    def _paths(self, digest: str) -> tuple[Path, Path]:
        shard = self._root / digest[:2]
        return shard / f"{digest}.bin", shard / f"{digest}.json"

    def put_data_url(self, data_url: str) -> JsonObject:
        media_type, content = parse_image_data_url(data_url)
        return self.put_bytes(content, media_type)

    def put_bytes(self, content: bytes, media_type: str) -> JsonObject:
        if MEDIA_TYPE.fullmatch(media_type) is None:
            raise AssetStoreError("factory_asset_media_type_invalid")
        if not content:
            raise AssetStoreError("factory_asset_content_empty")
        digest = sha256(content).hexdigest()
        descriptor: JsonObject = {
            "assetRef": f"sha256-{digest}",
            "mediaType": media_type,
            "byteLength": len(content),
        }
        binary_path, manifest_path = self._paths(digest)
        with self._lock:
            if binary_path.is_file() and manifest_path.is_file():
                return descriptor
            try:
                binary_path.parent.mkdir(parents=True, exist_ok=True)
                self._write_atomic(binary_path, content)
                self._write_atomic(
                    manifest_path,
                    json.dumps(
                        {"schema": ASSET_MANIFEST_SCHEMA, **descriptor},
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8"),
                )
            except OSError as error:
                raise AssetStoreError("factory_asset_write_failed") from error
        return descriptor

    def _write_atomic(self, path: Path, content: bytes) -> None:
        handle = tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f"{path.stem}-",
            suffix=".tmp",
            delete=False,
        )
        temp_path = Path(handle.name)
        try:
            with handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            temp_path.replace(path)
        except OSError:
            temp_path.unlink(missing_ok=True)
            raise

    def _digest(self, asset_ref: str) -> str:
        value = str(asset_ref or "")
        if ASSET_REF.fullmatch(value) is None:
            raise AssetStoreError("factory_asset_ref_invalid")
        return value.removeprefix("sha256-")

    def has(self, asset_ref: str) -> bool:
        try:
            digest = self._digest(asset_ref)
        except AssetStoreError:
            return False
        binary_path, manifest_path = self._paths(digest)
        return binary_path.is_file() and manifest_path.is_file()

    def read(self, asset_ref: str) -> tuple[str, bytes]:
        digest = self._digest(asset_ref)
        binary_path, manifest_path = self._paths(digest)
        try:
            content = binary_path.read_bytes()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AssetStoreError("factory_asset_missing") from error
        if not isinstance(manifest, dict) or manifest.get("schema") != ASSET_MANIFEST_SCHEMA:
            raise AssetStoreError("factory_asset_manifest_invalid")
        media_type = str(manifest.get("mediaType") or "")
        if MEDIA_TYPE.fullmatch(media_type) is None:
            raise AssetStoreError("factory_asset_manifest_invalid")
        if sha256(content).hexdigest() != digest:
            raise AssetStoreError("factory_asset_corrupted")
        return media_type, content

    def data_url(self, asset_ref: str) -> str:
        media_type, content = self.read(asset_ref)
        return f"data:{media_type};base64,{b64encode(content).decode('ascii')}"
