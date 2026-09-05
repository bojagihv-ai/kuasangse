"""계약: **서버가 대신 접속해 주는 경로는 전부 같은 잣대로 사설·루프백을 막는다.**

전수 진단 #19/#20 (2026-09-02):
  image-proxy 는 실제 IP 를 풀어 걸렀는데, Scrapling 수집과 작업파일 이미지 자료함은
  호스트 문자열만 보거나 첫 홉만 보고 넘어갔다. 그래서

    - `127.0.0.1.nip.io` / `localtest.me` (DNS 가 127.0.0.1 로 답하는 공개 도메인)
    - `127.1` / `0x7f000001` / `2130706433` (inet_aton 이 127.0.0.1 로 읽는 표기)
    - 공개 주소로 시작해 302 로 127.0.0.1 을 가리키는 리다이렉트

  가 "외부 주소" 로 통과해, 백엔드가 같은 PC 의 다른 서비스(신화사DB 8200, API 허브 4321,
  Cafe24 관제 8787)에 대신 접속할 수 있었다.

이 검사는 그 잣대 자체를 본다. 실제 DNS 를 타지 않도록 resolver 를 넣어 준다.
"""
from __future__ import annotations

import os
import socket
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.public_network import (  # noqa: E402
    PublicAddressPolicyError,
    assert_public_hostname,
    resolve_public_addresses,
    review_public_addresses,
)


@pytest.mark.parametrize(
    "hostname",
    ["127.0.0.1", "127.1", "0x7f000001", "2130706433", "0177.0.0.1"],
)
def test_loopback_written_in_any_notation_is_rejected(hostname):
    """축약·16진·10진 표기로 써도 루프백은 루프백이다.

    이 표기들은 브라우저와 requests 가 전부 127.0.0.1 로 접속한다. 예전 Scrapling 검사는
    ipaddress.ip_address('127.1') 이 ValueError 를 내면 '주소가 아니네' 하고 통과시켰다.
    """
    def _resolver(host, port):  # DNS 를 타면 안 된다 - 숫자 표기는 그대로 읽혀야 한다.
        raise AssertionError(f"숫자 표기인데 DNS 를 물었습니다: {host}:{port}")

    with pytest.raises(PublicAddressPolicyError):
        assert_public_hostname(hostname, 80, resolver=_resolver)


def test_public_dns_name_that_answers_loopback_is_rejected():
    # nip.io / localtest.me 계열. 이름은 완전한 공개 도메인인데 답이 127.0.0.1 이다.
    with pytest.raises(PublicAddressPolicyError) as caught:
        assert_public_hostname("127-0-0-1.nip.io", 80, resolver=lambda h, p: ("127.0.0.1",))
    assert caught.value.code == "non_public_image_address"


def test_ipv6_mapped_loopback_is_rejected():
    # ::ffff:127.0.0.1 은 IPv6 주소지만 실제로는 루프백에 붙는다.
    with pytest.raises(PublicAddressPolicyError):
        review_public_addresses(["::ffff:127.0.0.1"])


@pytest.mark.parametrize(
    "address",
    ["10.0.0.5", "192.168.0.10", "172.16.3.4", "169.254.1.1", "::1", "0.0.0.0", "224.0.0.1"],
)
def test_private_and_special_ranges_are_rejected(address):
    with pytest.raises(PublicAddressPolicyError):
        review_public_addresses([address])


def test_one_private_answer_poisons_the_whole_name():
    """DNS 가 공개 IP 와 사설 IP 를 섞어 답하면 전부 거절한다.

    하나만 통과시키면 요청이 실제로 어느 쪽에 붙을지 우리가 못 정한다 - 그게 DNS 재바인딩이다.
    """
    with pytest.raises(PublicAddressPolicyError):
        review_public_addresses(["93.184.216.34", "127.0.0.1"])


def test_public_address_is_allowed():
    reviewed = assert_public_hostname("example.com", 443, resolver=lambda h, p: ("93.184.216.34",))
    assert reviewed == ("93.184.216.34",)


def test_unresolvable_name_is_rejected_not_allowed():
    """모르는 곳에는 안 붙는다. DNS 실패를 '검사 못 했으니 통과' 로 읽으면 검사가 아니다."""
    def _boom(host, port):
        raise socket.gaierror("no such host")

    with pytest.raises(PublicAddressPolicyError) as caught:
        assert_public_hostname("존재하지-않는-이름.invalid", 80, resolver=_boom)
    assert caught.value.code == "image_address_unresolved"


def test_empty_answer_is_rejected():
    with pytest.raises(PublicAddressPolicyError) as caught:
        review_public_addresses([])
    assert caught.value.code == "image_address_missing"


def test_real_resolver_reads_literals_without_dns(monkeypatch):
    """대역이 아니라 **진짜 resolve_public_addresses** 가 숫자 표기를 DNS 없이 읽는지 본다.

    위 검사들은 resolver 를 넣어 주므로, 진짜 함수가 망가져도 통과한다.
    2026-09-02 에 _jepum_watcher_verdict 가 없는 이름을 부르는데 대역 때문에 4건이 전부
    통과한 적이 있다 - 같은 함정을 여기서 반복하지 않는다.
    """
    def _no_dns(*args, **kwargs):
        raise AssertionError("숫자 표기인데 getaddrinfo 를 불렀습니다")

    monkeypatch.setattr(socket, "getaddrinfo", _no_dns)
    assert resolve_public_addresses("127.0.0.1", 80) == ("127.0.0.1",)
    assert resolve_public_addresses("2130706433", 80) == ("127.0.0.1",)
