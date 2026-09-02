from __future__ import annotations

import uuid
from importlib import metadata
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from services.public_network import (
    PublicAddressPolicyError,
    assert_public_hostname,
    resolve_public_addresses,
)


class ScraplingUnavailable(RuntimeError):
    pass


class ScraplingRequestError(ValueError):
    pass


_MAX_PRODUCTS = 10
_MAX_IMAGES_PER_PRODUCT = 80
_MAX_PAGE_TEXT_CHARACTERS = 60_000
_IMAGE_SELECTORS = (
    "meta[property='og:image']::attr(content)",
    "meta[name='twitter:image']::attr(content)",
    "img::attr(src)",
    "img::attr(data-src)",
    "img::attr(data-original)",
    "img::attr(data-lazy-src)",
    "img::attr(data-image-url)",
    "source::attr(srcset)",
    "img::attr(srcset)",
)


def _load_fetcher() -> Any:
    try:
        from scrapling.fetchers import StealthyFetcher
    except (ImportError, ModuleNotFoundError) as exc:
        raise ScraplingUnavailable(
            "Scrapling 선택 실행기가 설치되지 않았습니다. backend 가상환경에 "
            "'scrapling[fetchers]'를 설치하고 브라우저 런타임을 준비해주세요."
        ) from exc
    return StealthyFetcher


def health() -> dict[str, Any]:
    try:
        _load_fetcher()
        version = metadata.version("scrapling")
    except (ScraplingUnavailable, metadata.PackageNotFoundError):
        return {
            "ok": True,
            "available": False,
            "version": "",
            "engine": "StealthyFetcher",
            "mode": "optional",
        }
    return {
        "ok": True,
        "available": True,
        "version": version,
        "engine": "StealthyFetcher",
        "mode": "optional",
    }


def _public_http_url(value: Any) -> str:
    """수집 대상 URL 이 정말 바깥 주소인지 — 문자열이 아니라 실제로 가리키는 IP 로 판정한다.

    왜 (묶음 G6 #19, 2026-09-02): 예전엔 ipaddress 파싱이 되는 문자열만 걸렀다. 그래서
    `127.0.0.1.nip.io`·`localtest.me` (DNS 가 127.0.0.1 로 답함), `0x7f000001`·`127.1`
    (파싱은 실패하지만 접속 라이브러리는 127.0.0.1 로 읽음) 이 "외부" 로 통과했다.
    image-proxy 와 같은 services.public_network 잣대를 쓴다.
    """
    raw = str(value or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ScraplingRequestError("상품 URL은 외부 http/https 주소여야 합니다.")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ScraplingRequestError("로컬 주소는 Scrapling 수집 대상으로 사용할 수 없습니다.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        assert_public_hostname(hostname, port, resolver=_resolve_addresses)
    except PublicAddressPolicyError as exc:
        if exc.code == "image_address_unresolved":
            raise ScraplingRequestError(
                f"상품 URL 의 주소({hostname})를 찾지 못했습니다. 주소를 확인한 뒤 다시 시도해주세요."
            ) from exc
        raise ScraplingRequestError(
            "사설·루프백 주소(또는 그리로 향하는 도메인)는 Scrapling 수집 대상으로 사용할 수 없습니다."
        ) from exc
    return raw


def _resolve_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """검사에서 DNS 를 가짜로 바꿔 끼우는 자리."""
    return resolve_public_addresses(hostname, port)


def _selector_values(page: Any, selector: str) -> list[str]:
    try:
        selected = page.css(selector)
        values = selected.getall() if hasattr(selected, "getall") else list(selected or [])
    except (AttributeError, TypeError, ValueError):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def _normalize_image_urls(page: Any, base_url: str) -> list[str]:
    values: list[str] = []
    for selector in _IMAGE_SELECTORS:
        values.extend(_selector_values(page, selector))

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidates = [part.strip().split(" ", 1)[0] for part in value.split(",")]
        for candidate in candidates:
            if not candidate or candidate.startswith(("data:", "blob:", "javascript:")):
                continue
            absolute = urljoin(base_url, candidate)
            parsed = urlparse(absolute)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                continue
            if absolute in seen:
                continue
            seen.add(absolute)
            normalized.append(absolute)
            if len(normalized) >= _MAX_IMAGES_PER_PRODUCT:
                return normalized
    return normalized


def _page_title(page: Any, fallback: str) -> str:
    values = _selector_values(page, "title::text")
    return values[0] if values else fallback


def fetch_url_html_text(url: str) -> str:
    product_url = _public_http_url(url)
    page = _load_fetcher().fetch(
        product_url,
        headless=True,
        network_idle=True,
        timeout=60_000,
    )
    document = BeautifulSoup(str(page.html_content or ""), "html.parser")
    for element in document(["script", "style", "noscript", "svg", "iframe"]):
        element.decompose()
    text = " ".join(document.stripped_strings)
    if not text:
        raise ScraplingRequestError("경쟁사 페이지에서 분석할 텍스트를 찾지 못했습니다.")
    return text[:_MAX_PAGE_TEXT_CHARACTERS]


def _capture_product(fetcher: Any, product: dict[str, Any], index: int) -> dict[str, Any]:
    product_url = _public_http_url(
        product.get("product_url")
        or product.get("url")
        or product.get("link")
        or product.get("detail_url")
    )
    candidate_id = str(
        product.get("id")
        or product.get("product_id")
        or product.get("productId")
        or product_url
    ).strip()
    fallback_title = str(product.get("title") or product.get("name") or f"후보 {index + 1}").strip()
    page = fetcher.fetch(
        product_url,
        headless=True,
        network_idle=True,
        timeout=60_000,
    )
    image_urls = _normalize_image_urls(page, product_url)
    return {
        "id": candidate_id,
        "candidate_id": candidate_id,
        "title": _page_title(page, fallback_title),
        "platform": str(product.get("platform") or product.get("site") or "").strip(),
        "product_url": product_url,
        "status": "success" if image_urls else "empty",
        "image_urls": image_urls,
        "screenshot_urls": image_urls,
        "capture_runtime": "scrapling",
        "method": "scrapling_stealthy",
    }


def capture_details(payload: dict[str, Any]) -> dict[str, Any]:
    raw_products = payload.get("products")
    if not isinstance(raw_products, list) or not raw_products:
        raise ScraplingRequestError("products 배열에 상세수집 후보를 넣어주세요.")
    if len(raw_products) > _MAX_PRODUCTS:
        raise ScraplingRequestError(f"Scrapling 1회 상세수집은 최대 {_MAX_PRODUCTS}건입니다.")
    if any(not isinstance(product, dict) for product in raw_products):
        raise ScraplingRequestError("products의 각 항목은 JSON 객체여야 합니다.")

    fetcher = _load_fetcher()
    capture_id = f"scrapling_{uuid.uuid4().hex}"
    scraped_data: dict[str, dict[str, Any]] = {}
    products: list[dict[str, Any]] = []
    failed_items: list[dict[str, str]] = []

    for index, raw_product in enumerate(raw_products):
        product = dict(raw_product)
        candidate_id = str(
            product.get("id")
            or product.get("product_id")
            or product.get("productId")
            or f"candidate-{index + 1}"
        ).strip()
        try:
            captured = _capture_product(fetcher, product, index)
        except ScraplingRequestError:
            raise
        except Exception as exc:
            captured = {
                "id": candidate_id,
                "candidate_id": candidate_id,
                "title": str(product.get("title") or product.get("name") or candidate_id),
                "platform": str(product.get("platform") or product.get("site") or ""),
                "product_url": str(
                    product.get("product_url")
                    or product.get("url")
                    or product.get("link")
                    or product.get("detail_url")
                    or ""
                ),
                "status": "failed",
                "image_urls": [],
                "screenshot_urls": [],
                "capture_runtime": "scrapling",
                "method": "scrapling_stealthy",
                "error": str(exc),
            }
            failed_items.append({"id": candidate_id, "error": str(exc)})
        resolved_id = str(captured.get("id") or candidate_id)
        scraped_data[resolved_id] = captured
        products.append(
            {
                **product,
                "id": resolved_id,
                "product_url": captured.get("product_url", ""),
                "status": captured.get("status", "failed"),
            }
        )

    succeeded = sum(1 for item in scraped_data.values() if item.get("image_urls"))
    failed = len(products) - succeeded
    status = "completed" if failed == 0 else ("partial_success" if succeeded else "failed")
    return {
        "ok": succeeded > 0,
        "status": status,
        "capture_id": capture_id,
        "capture_runtime": "scrapling",
        "engine": "StealthyFetcher",
        "total": len(products),
        "completed": succeeded,
        "failed": failed,
        "products": products,
        "scraped_data": scraped_data,
        "failed_items": failed_items,
    }
