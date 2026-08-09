from __future__ import annotations

import hashlib

import pytest

from control_tower.backend.readback_canonical import (
    ReadbackProjectionError,
    canonical_readback_bytes,
    canonical_readback_digest,
)
from control_tower.backend.runtime_cache import JsonObject


def _projection() -> JsonObject:
    return {
        "schema": "cafe24-product-readback:v1",
        "productNo": 2994,
        "productCode": "P0000ELE",
        "productName": "방울수저집",
        "display": "F",
        "selling": "F",
        "marketSync": "F",
        "categories": [71],
        "hasOption": "F",
        "options": [],
        "variants": [],
        "images": [{"role": "detail", "sha256": "a" * 64, "bytes": 3}],
        "detailHtmlDigest": "b" * 64,
        "detailHtmlBytes": 5,
        "detailHtmlCharacters": 3,
        "updatedAt": "2026-07-30T23:08:16+09:00",
    }


def test_canonical_readback_is_recursive_sorted_utf8_without_newline() -> None:
    projection = _projection()
    expected = (
        '{"categories":[71],"detailHtmlBytes":5,"detailHtmlCharacters":3,'
        '"detailHtmlDigest":"' + ("b" * 64) + '","display":"F","hasOption":"F",'
        '"images":[{"bytes":3,"role":"detail","sha256":"' + ("a" * 64) + '"}],'
        '"marketSync":"F","options":[],"productCode":"P0000ELE","productName":"방울수저집",'
        '"productNo":2994,"schema":"cafe24-product-readback:v1","selling":"F",'
        '"updatedAt":"2026-07-30T23:08:16+09:00","variants":[]}'
    ).encode()

    actual = canonical_readback_bytes(projection)

    assert actual == expected
    assert not actual.endswith(b"\n")
    assert canonical_readback_digest(projection) == hashlib.sha256(expected).hexdigest()


def test_canonical_readback_rejects_unknown_or_unsafe_fields() -> None:
    projection = _projection()
    projection["rawEnvelope"] = {"accessToken": "forbidden"}

    with pytest.raises(ReadbackProjectionError, match="readback_projection_fields_invalid"):
        canonical_readback_bytes(projection)
