from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from flask import Flask

from routes import api_core


PUBLIC_IP = "93.184.216.34"
MAX_IMAGE_BYTES = 8 * 1024 * 1024


@dataclass(slots=True)
class FakePinnedResponse:
    status: int = 200
    headers: dict[str, str] = field(
        default_factory=lambda: {"content-type": "image/jpeg"},
    )
    chunks: tuple[bytes, ...] = (b"marketplace-image",)
    closed: bool = False

    @property
    def status_code(self) -> int:
        return self.status

    def stream(self, _chunk_size: int) -> Iterator[bytes]:
        yield from self.chunks

    def iter_content(self, chunk_size: int) -> Iterator[bytes]:
        yield from self.stream(chunk_size)

    def raise_for_status(self) -> None:
        if self.status >= 400:
            raise RuntimeError(f"HTTP {self.status}")

    def release_conn(self) -> None:
        self.closed = True

    def close(self) -> None:
        self.closed = True


@dataclass(slots=True)
class ProxyHarness:
    addresses: dict[str, tuple[str, ...]]
    responses: dict[str, FakePinnedResponse]
    resolved: list[tuple[str, int]] = field(default_factory=list)
    connected: list[tuple[str, str, str]] = field(default_factory=list)
    legacy_calls: list[str] = field(default_factory=list)

    def resolve(self, hostname: str, port: int) -> tuple[str, ...]:
        self.resolved.append((hostname, port))
        return self.addresses.get(hostname, ())

    def request(self, url: str, hostname: str, ip_address: str) -> FakePinnedResponse:
        self.connected.append((url, hostname, ip_address))
        return self.responses[url]

    def legacy_get(self, url: str, **_kwargs) -> FakePinnedResponse:
        self.legacy_calls.append(url)
        return self.responses[url]


def make_client(monkeypatch: pytest.MonkeyPatch, harness: ProxyHarness):
    monkeypatch.setattr(
        api_core,
        "_image_proxy_resolve_addresses",
        harness.resolve,
        raising=False,
    )
    monkeypatch.setattr(
        api_core,
        "_image_proxy_request_hop",
        harness.request,
        raising=False,
    )
    monkeypatch.setattr(api_core.requests, "get", harness.legacy_get)
    app = Flask(__name__)
    app.register_blueprint(api_core.api, url_prefix="/api")
    return app.test_client()


def request_image(client, url: str):
    return client.get("/api/image-proxy", query_string={"raw": "1", "url": url})


def test_allowlisted_https_host_streams_through_the_reviewed_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://thumbnail.coupangcdn.com/current.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP,)},
        responses={url: FakePinnedResponse()},
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 200
    assert response.data == b"marketplace-image"
    assert harness.connected == [(url, "thumbnail.coupangcdn.com", PUBLIC_IP)]
    assert harness.legacy_calls == []


def test_naver_shopping_image_cdn_streams_through_the_reviewed_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://shopping-phinf.pstatic.net/main_6065680/60656805020.jpg"
    harness = ProxyHarness(
        addresses={"shopping-phinf.pstatic.net": (PUBLIC_IP,)},
        responses={url: FakePinnedResponse()},
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 200
    assert response.data == b"marketplace-image"
    assert harness.connected == [(url, "shopping-phinf.pstatic.net", PUBLIC_IP)]
    assert harness.legacy_calls == []


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/not-allowed.jpg",
        "https://sub.thumbnail.coupangcdn.com/not-allowed.jpg",
        f"https://{PUBLIC_IP}/direct-ip.jpg",
        "http://thumbnail.coupangcdn.com/not-https.jpg",
    ],
)
def test_non_exact_or_direct_ip_hosts_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    url: str,
) -> None:
    harness = ProxyHarness(addresses={}, responses={})
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 400
    assert harness.resolved == []
    assert harness.connected == []


@pytest.mark.parametrize(
    "blocked_ip",
    ["10.0.0.8", "127.0.0.1", "169.254.10.20", "192.0.2.8"],
)
def test_allowlisted_host_rejects_non_global_resolved_addresses(
    monkeypatch: pytest.MonkeyPatch,
    blocked_ip: str,
) -> None:
    url = "https://thumbnail.coupangcdn.com/blocked.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (blocked_ip,)},
        responses={url: FakePinnedResponse()},
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 400
    assert harness.connected == []


def test_mixed_public_and_private_dns_answers_reject_entire_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://thumbnail.coupangcdn.com/mixed-dns.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP, "127.0.0.1")},
        responses={url: FakePinnedResponse()},
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 400
    assert harness.connected == []
    assert harness.legacy_calls == []


def test_redirect_to_disallowed_host_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = "https://thumbnail.coupangcdn.com/redirect.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP,)},
        responses={
            start: FakePinnedResponse(
                status=302,
                headers={"location": "https://example.com/private.jpg"},
                chunks=(),
            ),
        },
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, start)

    assert response.status_code == 400
    assert harness.connected == [(start, "thumbnail.coupangcdn.com", PUBLIC_IP)]


def test_redirect_to_allowlisted_host_with_private_dns_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = "https://thumbnail.coupangcdn.com/redirect.jpg"
    target = "https://gdimg.gmarket.co.kr/private.jpg"
    harness = ProxyHarness(
        addresses={
            "thumbnail.coupangcdn.com": (PUBLIC_IP,),
            "gdimg.gmarket.co.kr": ("127.0.0.1",),
        },
        responses={
            start: FakePinnedResponse(
                status=302,
                headers={"location": target},
                chunks=(),
            ),
        },
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, start)

    assert response.status_code == 400
    assert harness.connected == [(start, "thumbnail.coupangcdn.com", PUBLIC_IP)]


def test_dns_rebinding_cannot_change_the_reviewed_connected_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://thumbnail.coupangcdn.com/rebind.jpg"
    resolve_count = 0
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP,)},
        responses={url: FakePinnedResponse()},
    )

    def rebinding_resolver(hostname: str, port: int) -> tuple[str, ...]:
        nonlocal resolve_count
        resolve_count += 1
        harness.resolved.append((hostname, port))
        return (PUBLIC_IP,) if resolve_count == 1 else ("127.0.0.1",)

    client = make_client(monkeypatch, harness)
    monkeypatch.setattr(
        api_core,
        "_image_proxy_resolve_addresses",
        rebinding_resolver,
        raising=False,
    )

    response = request_image(client, url)

    assert response.status_code == 200
    assert resolve_count == 1
    assert harness.connected == [(url, "thumbnail.coupangcdn.com", PUBLIC_IP)]
    assert harness.legacy_calls == []


def test_non_image_mime_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "https://thumbnail.coupangcdn.com/not-image.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP,)},
        responses={
            url: FakePinnedResponse(headers={"content-type": "text/html"}),
        },
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 400


@pytest.mark.parametrize(
    "response",
    [
        FakePinnedResponse(
            headers={"content-type": "image/jpeg", "content-length": str(MAX_IMAGE_BYTES + 1)},
        ),
        FakePinnedResponse(chunks=(b"x" * (MAX_IMAGE_BYTES + 1),)),
    ],
)
def test_images_larger_than_eight_megabytes_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    response: FakePinnedResponse,
) -> None:
    url = "https://thumbnail.coupangcdn.com/too-large.jpg"
    harness = ProxyHarness(
        addresses={"thumbnail.coupangcdn.com": (PUBLIC_IP,)},
        responses={url: response},
    )
    client = make_client(monkeypatch, harness)

    result = request_image(client, url)

    assert result.status_code == 413


def test_current_marketplace_image_path_still_streams(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://gdimg.gmarket.co.kr/goods/123/market.jpg"
    harness = ProxyHarness(
        addresses={"gdimg.gmarket.co.kr": (PUBLIC_IP,)},
        responses={url: FakePinnedResponse(chunks=(b"market", b"-image"))},
    )
    client = make_client(monkeypatch, harness)

    response = request_image(client, url)

    assert response.status_code == 200
    assert response.data == b"market-image"
    assert harness.connected == [(url, "gdimg.gmarket.co.kr", PUBLIC_IP)]
    assert harness.legacy_calls == []
