from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Final

from .canonical_json import canonical_json_bytes, canonical_json_digest
from .runtime_cache import JsonObject, JsonValue


class ReadbackProjectionError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


READBACK_SCHEMA: Final = "cafe24-product-readback:v1"
_SHA256: Final = re.compile(r"^[a-f0-9]{64}$")
_FIELDS: Final = (
    "schema",
    "productNo",
    "productCode",
    "productName",
    "display",
    "selling",
    "marketSync",
    "categories",
    "hasOption",
    "options",
    "variants",
    "images",
    "detailHtmlDigest",
    "detailHtmlBytes",
    "detailHtmlCharacters",
    "updatedAt",
)
_VARIANT_FIELDS: Final = ("variantCode", "display", "selling", "quantity")
_IMAGE_FIELDS: Final = ("role", "sha256", "bytes")
_IMAGE_ORDER: Final = {"detail": 0, "list": 1, "small": 2, "tiny": 3}


def _text(value: JsonValue, code: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ReadbackProjectionError(code)
    return value.strip()


def _integer(value: JsonValue, code: str) -> int:
    if type(value) is not int or value < 0:
        raise ReadbackProjectionError(code)
    return value


def _flag(value: JsonValue) -> str:
    flag = _text(value, "readback_projection_flag_invalid")
    if flag not in {"T", "F"}:
        raise ReadbackProjectionError("readback_projection_flag_invalid")
    return flag


def _variants(value: JsonValue) -> list[JsonValue]:
    if not isinstance(value, list):
        raise ReadbackProjectionError("readback_projection_variants_invalid")
    variants: list[JsonValue] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != set(_VARIANT_FIELDS):
            raise ReadbackProjectionError("readback_projection_variants_invalid")
        variants.append(
            {
                "variantCode": _text(item.get("variantCode"), "readback_projection_variants_invalid"),
                "display": _flag(item.get("display")),
                "selling": _flag(item.get("selling")),
                "quantity": _integer(item.get("quantity"), "readback_projection_variants_invalid"),
            },
        )
    return sorted(variants, key=lambda item: str(item["variantCode"]) if isinstance(item, dict) else "")


def _images(value: JsonValue) -> list[JsonValue]:
    if not isinstance(value, list):
        raise ReadbackProjectionError("readback_projection_images_invalid")
    images: list[JsonValue] = []
    roles: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != set(_IMAGE_FIELDS):
            raise ReadbackProjectionError("readback_projection_images_invalid")
        role = _text(item.get("role"), "readback_projection_images_invalid")
        digest = _text(item.get("sha256"), "readback_projection_images_invalid").casefold()
        if role not in _IMAGE_ORDER or role in roles or _SHA256.fullmatch(digest) is None:
            raise ReadbackProjectionError("readback_projection_images_invalid")
        roles.add(role)
        images.append(
            {
                "role": role,
                "sha256": digest,
                "bytes": _integer(item.get("bytes"), "readback_projection_images_invalid"),
            },
        )
    return sorted(images, key=lambda item: _IMAGE_ORDER[str(item["role"])] if isinstance(item, dict) else 99)


def normalize_readback_projection(value: Mapping[str, JsonValue]) -> JsonObject:
    if set(value) != set(_FIELDS):
        raise ReadbackProjectionError("readback_projection_fields_invalid")
    if value.get("schema") != READBACK_SCHEMA:
        raise ReadbackProjectionError("readback_projection_schema_invalid")
    categories = value.get("categories")
    options = value.get("options")
    if (
        not isinstance(categories, list)
        or any(type(item) is not int or item < 0 for item in categories)
        or not isinstance(options, list)
    ):
        raise ReadbackProjectionError("readback_projection_fields_invalid")
    has_option = _flag(value.get("hasOption"))
    if has_option == "F" and options:
        raise ReadbackProjectionError("readback_projection_options_invalid")
    html_digest = _text(value.get("detailHtmlDigest"), "readback_projection_html_invalid").casefold()
    if _SHA256.fullmatch(html_digest) is None:
        raise ReadbackProjectionError("readback_projection_html_invalid")
    return {
        "schema": READBACK_SCHEMA,
        "productNo": _integer(value.get("productNo"), "readback_projection_product_invalid"),
        "productCode": _text(value.get("productCode"), "readback_projection_product_invalid"),
        "productName": _text(value.get("productName"), "readback_projection_product_invalid"),
        "display": _flag(value.get("display")),
        "selling": _flag(value.get("selling")),
        "marketSync": _flag(value.get("marketSync")),
        "categories": sorted(set(categories)),
        "hasOption": has_option,
        "options": list(options),
        "variants": _variants(value.get("variants")),
        "images": _images(value.get("images")),
        "detailHtmlDigest": html_digest,
        "detailHtmlBytes": _integer(value.get("detailHtmlBytes"), "readback_projection_html_invalid"),
        "detailHtmlCharacters": _integer(
            value.get("detailHtmlCharacters"),
            "readback_projection_html_invalid",
        ),
        "updatedAt": _text(value.get("updatedAt"), "readback_projection_product_invalid"),
    }


def canonical_readback_bytes(value: Mapping[str, JsonValue]) -> bytes:
    return canonical_json_bytes(normalize_readback_projection(value))


def canonical_readback_digest(value: Mapping[str, JsonValue]) -> str:
    return canonical_json_digest(normalize_readback_projection(value))
