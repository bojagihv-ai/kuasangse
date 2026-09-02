"""공개망 주소 판정 — 서버가 대신 접속해 주는 모든 경로가 같은 잣대를 쓴다.

왜 한곳에 모았나 (실측 2026-09-02, 묶음 G6 #19/#20):
  - image-proxy(api_core)는 getaddrinfo 로 실제 IP 를 풀어 사설·루프백을 걸렀는데,
  - Scrapling 수집(scrapling_service)은 호스트 문자열만 보고 ipaddress 파싱이 실패하면
    그냥 통과시켰다. 그래서 `127.0.0.1.nip.io` / `localtest.me` (DNS 가 127.0.0.1 로 답함),
    `0x7f000001` / `127.1` / `2130706433` (inet_aton 이 127.0.0.1 로 읽는 표기) 이
    "외부 주소" 로 통과해 백엔드가 자기 자신·같은 PC 의 다른 서비스에 접속할 수 있었다.
  - 작업파일 이미지 자료함(api_archive)은 follow_redirects=True 라서 첫 홉만 검사하고
    302 뒤 127.0.0.1 을 그대로 따라갔다.

여기 두 함수가 그 잣대다. 라우트는 이걸 감싸서 자기 오류 형식으로 바꿔 쓴다.
"""
from __future__ import annotations

import ipaddress
import socket


class PublicAddressPolicyError(ValueError):
    """공개망이 아닌 주소. code 는 기존 image-proxy 가 쓰던 문구를 그대로 잇는다."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _literal_address(hostname: str):
    """숫자 표기(IPv4 점 표기·16진·10진 정수·8진, IPv6 대괄호)를 IP 로 읽는다. 아니면 None.

    Windows 의 getaddrinfo 는 `127.1` 같은 축약 표기를 못 풀고(11001) Linux 는 푼다 —
    OS 마다 결과가 갈리면 검사가 검사가 아니다. inet_aton 은 두 OS 모두 같은 규칙으로
    읽으니 먼저 이걸로 확정한다.
    """
    text = str(hostname or "").strip().strip("[]")
    if not text:
        return None
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        pass
    try:
        return ipaddress.ip_address(socket.inet_aton(text))
    except (OSError, ValueError):
        return None


def resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """호스트가 실제로 가리키는 IP 들. 숫자 표기는 DNS 를 묻지 않고 그대로 읽는다."""
    literal = _literal_address(hostname)
    if literal is not None:
        return (literal.compressed,)
    addresses = socket.getaddrinfo(
        hostname,
        port,
        family=socket.AF_UNSPEC,
        type=socket.SOCK_STREAM,
    )
    return tuple(sorted({str(address[4][0]).split("%", 1)[0] for address in addresses}))


def review_public_addresses(addresses) -> tuple[str, ...]:
    """하나라도 공개망 밖이면 전부 거절한다 — 섞인 DNS 응답으로 사설 IP 에 붙는 길을 막는다."""
    reviewed = []
    for address in addresses:
        parsed = ipaddress.ip_address(address)
        # ::ffff:127.0.0.1 처럼 IPv6 에 싸인 IPv4 는 안의 주소로 판정한다.
        mapped = getattr(parsed, "ipv4_mapped", None)
        if mapped is not None:
            parsed = mapped
        if (
            not parsed.is_global
            or parsed.is_private
            or parsed.is_loopback
            or parsed.is_link_local
            or parsed.is_multicast
            or parsed.is_reserved
            or parsed.is_unspecified
        ):
            raise PublicAddressPolicyError("non_public_image_address")
        reviewed.append(parsed.compressed)
    if not reviewed:
        raise PublicAddressPolicyError("image_address_missing")
    return tuple(sorted(set(reviewed)))


def assert_public_hostname(hostname: str, port: int, resolver=resolve_public_addresses) -> tuple[str, ...]:
    """호스트를 풀어 검사까지 한 번에. DNS 실패도 거절이다(모르는 곳에는 안 붙는다).

    숫자 표기는 **resolver 보다 먼저** 여기서 읽는다. 이름 풀이를 누가 갈아끼워도
    `127.1` / `0x7f000001` 같은 표기가 그 틈으로 빠져나가지 못하게 한다 -
    이건 이름 풀이 방식이 아니라 정책이다.
    """
    literal = _literal_address(hostname)
    if literal is not None:
        return review_public_addresses((literal.compressed,))
    try:
        addresses = resolver(hostname, port)
    except (socket.gaierror, OSError, ValueError) as exc:
        raise PublicAddressPolicyError("image_address_unresolved") from exc
    return review_public_addresses(addresses)
