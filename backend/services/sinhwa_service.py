"""Client helpers for the Sinhwa DB Hub PDP API."""
from __future__ import annotations

import os
import re
from typing import Any

import requests

from config import Config


class SinhwaLookupError(RuntimeError):
    pass


def _api_base() -> str:
    return (Config.SINHWA_PDP_API_BASE or "http://127.0.0.1:8200/api/pdp").rstrip("/")


def _clean_query(value: str | None) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\.[a-zA-Z0-9]+$", "", text)
    return text.strip()


def extract_explicit_product_code(file_name: str | None) -> int | None:
    """Extract only intentional product-code patterns.

    Camera names such as IMG_7074.JPG are intentionally ignored because they are
    image sequence numbers, not reliable product codes.
    """
    stem = _clean_query(os.path.basename(file_name or ""))
    patterns = [
        r"(?:^|[^A-Za-z0-9가-힣])(?:jcode|code|product|pcode|상품코드|품번|제품코드)[\s_-]*(\d{1,10})(?:\D|$)",
        r"^(\d{1,10})(?:[\s_-]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, stem, flags=re.IGNORECASE)
        if match:
            try:
                return int(match.group(1))
            except (TypeError, ValueError):
                return None
    return None


def lookup_sinhwa_product(
    *,
    file_name: str | None = None,
    product_name: str | None = None,
    timeout: int = 10,
) -> dict[str, Any]:
    code = extract_explicit_product_code(file_name)
    params: dict[str, Any] = {"limit": 10}
    if code is not None:
        params["jcode"] = code
    else:
        query = _clean_query(product_name) or _clean_query(file_name)
        if not query:
            raise SinhwaLookupError("상품코드 또는 상품명 검색어가 없습니다.")
        params["q"] = query

    url = f"{_api_base()}/products/lookup"
    try:
        resp = requests.get(url, params=params, timeout=timeout)
    except Exception as exc:
        raise SinhwaLookupError(f"신화사 DB API 연결 실패: {exc}") from exc

    if resp.status_code >= 400:
        raise SinhwaLookupError(f"신화사 DB API 오류 ({resp.status_code}): {resp.text[:300]}")

    try:
        data = resp.json()
    except ValueError as exc:
        raise SinhwaLookupError("신화사 DB API 응답이 JSON이 아닙니다.") from exc

    if not data.get("matched"):
        candidates = data.get("candidates") or []
        if candidates:
            preview = ", ".join(
                f"{item.get('productCode')} {item.get('productName')}"
                for item in candidates[:5]
            )
            raise SinhwaLookupError(f"DB 상품을 하나로 확정하지 못했습니다. 후보: {preview}")
        raise SinhwaLookupError("DB에서 일치하는 상품을 찾지 못했습니다.")

    if not data.get("product"):
        raise SinhwaLookupError("DB 매칭은 됐지만 상품 정보가 비어 있습니다.")
    return data


def attach_sinhwa_context(analysis: dict[str, Any], lookup: dict[str, Any]) -> dict[str, Any]:
    product = lookup.get("product") or {}
    out = dict(analysis or {})
    out["sinhwa_db"] = product
    out["sinhwa_db_match"] = lookup.get("match") or {}
    out["sinhwa_db_ai_context"] = lookup.get("aiContext") or ""
    if product.get("productName"):
        out["product_name"] = product["productName"]
    if product.get("category"):
        out["category"] = product["category"]
    if product.get("size"):
        out["db_size"] = product["size"]
    return out
