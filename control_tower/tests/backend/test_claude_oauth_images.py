"""Claude 판정자가 후보 그림을 파일로 내려 두고 경로를 알려 주는지.

2026-09-18: 허브의 Claude 브리지(apiClaudeOauth.js)는 글자만 받는다. 그래서 실서버에서 시각 판정이 전부
manual_required 로 돌아왔다(그림을 못 봤으니 맞는 답이다). 브리지는 Claude CLI 를 plan 모드로 띄우므로
같은 PC 의 파일은 읽기 도구로 열어 볼 수 있다 — 그림을 내려받아 경로를 프롬프트에 싣는다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from control_tower.backend.claude_oauth import ClaudeOAuthJudge


class FakeResponse:
    def __init__(self, body: dict[str, Any], status_code: int = 200) -> None:
        self.status_code = status_code
        self.body = body

    def json(self) -> dict[str, Any]:
        return self.body


def fake_transport_factory(judgement: dict[str, Any]):
    """test_claude_oauth 의 가짜 브리지와 같은 모양(status → options → exec)."""
    calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def transport(method: str, url: str, **kwargs: Any) -> FakeResponse:
        calls.append((method, url, kwargs.get("json")))
        if url.endswith("/api/claude-oauth/status"):
            return FakeResponse({
                "ok": True, "rawTokenReturned": False,
                "oauthStatus": {"mode": "claude-subscription-oauth", "cliAvailable": True, "loggedIn": True, "claudeLoginReady": True, "expired": False},
            })
        if url.endswith("/api/claude-oauth/options"):
            return FakeResponse({
                "authMode": "claude-subscription-oauth",
                "modelOptions": [{"id": "claude-opus-5", "alias": "opus", "recommended": True}, {"id": "claude-haiku-4-5", "alias": "haiku"}],
                "effortOptions": [{"id": "low"}, {"id": "medium"}, {"id": "high"}],
                "defaults": {"model": "claude-opus-5", "effort": "high", "timeoutMs": 180000},
            })
        return FakeResponse({"ok": True, "usedClaudeOAuth": True, "rawTokenReturned": False, "text": json.dumps(judgement, ensure_ascii=False), "model": "claude-opus-5"})

    return transport, calls


def valid_judgement(selected: str) -> dict[str, Any]:
    return {
        "decision": "selected",
        "selectedCandidateId": selected,
        "scores": {"sameProductLikelihood": 0.9, "visualSimilarity": 0.8, "taskSuitability": 0.9, "quality": 0.85, "factConsistency": 0.9},
        "confidence": 0.88,
        "scoreGap": 0.3,
        "riskFlags": [],
        "rationale": f"{selected} 가 제품 전체가 보이고 배경이 정리돼 가장 읽힌다.",
    }


class FakeImageResponse:
    def __init__(self, content: bytes, status_code: int = 200, content_type: str = "image/jpeg") -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"Content-Type": content_type}


def archive_candidate(candidate_id: str, digest: str, *, ref: str | None = None) -> dict[str, str]:
    return {
        "candidateId": candidate_id,
        "source": "factory-runtime",
        "thumbnailRef": ref if ref is not None else f"/api/local-archive/assets/{digest}/image",
        "contentDigest": digest,
    }


def test_judge_downloads_candidate_pictures_and_tells_claude_where_they_are(tmp_path: Path) -> None:
    transport, calls = fake_transport_factory(valid_judgement("cand-a"))
    fetched: list[str] = []

    def fetch(url: str, **kwargs: Any) -> FakeImageResponse:
        fetched.append(url)
        return FakeImageResponse(b"\xff\xd8\xff" + b"0" * 64)

    judge = ClaudeOAuthJudge(
        "http://hub.test", request_fn=transport, fetch_fn=fetch, image_dir=tmp_path,
        asset_base_url="http://factory.test:43030", tower_base_url="http://tower.test:41009",
    )
    receipt = judge.judge(
        decision_type="size_image",
        input_refs=[],
        candidates=[
            archive_candidate("cand-a", "aaaa1111"),
            archive_candidate("cand-b", "bbbb2222", ref="/api/factory/jobs/job-1/history/assets/input-0/thumbnail"),
        ],
        model="latestModel",
        reasoning_effort="low",
    )["receipt"]
    # 원본(/image)은 768px 축소본으로 바꿔 받고, 관제탑 참조는 관제탑 주소로 받는다.
    assert fetched == [
        "http://factory.test:43030/api/local-archive/assets/aaaa1111/thumbnail?w=768",
        "http://tower.test:41009/api/factory/jobs/job-1/history/assets/input-0/thumbnail",
    ]
    files = sorted(path.name for path in tmp_path.iterdir())
    assert files == ["aaaa1111.jpg", "bbbb2222.jpg"]
    exec_call = [call for call in calls if call[1].endswith("/api/claude-oauth/exec")][0]
    prompt = json.loads(exec_call[2]["prompt"])
    assert [item["candidateId"] for item in prompt["imageFiles"]] == ["cand-a", "cand-b"]
    assert prompt["imageFiles"][0]["path"] == str(tmp_path / "aaaa1111.jpg")
    assert "Read tool" in prompt["viewingInstruction"]
    assert receipt["imageCount"] == 2
    assert receipt["judgement"]["selectedCandidateId"] == "cand-a"


def test_judge_falls_back_to_text_when_pictures_cannot_be_fetched(tmp_path: Path) -> None:
    transport, calls = fake_transport_factory(valid_judgement("cand-a"))

    def fetch(url: str, **kwargs: Any) -> FakeImageResponse:
        return FakeImageResponse(b"", status_code=404)

    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport, fetch_fn=fetch, image_dir=tmp_path)
    receipt = judge.judge(
        decision_type="size_image", input_refs=[],
        candidates=[archive_candidate("cand-a", "aaaa1111"), archive_candidate("cand-b", "bbbb2222")],
    )["receipt"]
    exec_call = [call for call in calls if call[1].endswith("/api/claude-oauth/exec")][0]
    prompt = json.loads(exec_call[2]["prompt"])
    assert "imageFiles" not in prompt
    assert "viewingInstruction" not in prompt
    assert receipt["imageCount"] == 0
    assert list(tmp_path.iterdir()) == []


def test_judge_skips_references_it_cannot_resolve(tmp_path: Path) -> None:
    transport, calls = fake_transport_factory(valid_judgement("cand-a"))
    fetched: list[str] = []

    def fetch(url: str, **kwargs: Any) -> FakeImageResponse:
        fetched.append(url)
        return FakeImageResponse(b"\x89PNG" + b"0" * 32, content_type="image/png")

    judge = ClaudeOAuthJudge("http://hub.test", request_fn=transport, fetch_fn=fetch, image_dir=tmp_path)
    judge.judge(
        decision_type="representative_image", input_refs=[],
        candidates=[
            archive_candidate("cand-a", "aaaa1111", ref="thumb:cand-a"),
            archive_candidate("cand-b", "bbbb2222", ref="https://cdn.example.com/b.png"),
        ],
    )
    # 픽스처 참조(thumb:)는 건너뛰고, 절대 주소는 그대로 받는다. PNG 는 .png 로 둔다.
    assert fetched == ["https://cdn.example.com/b.png"]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["bbbb2222.png"]
    exec_call = [call for call in calls if call[1].endswith("/api/claude-oauth/exec")][0]
    prompt = json.loads(exec_call[2]["prompt"])
    assert [item["candidateId"] for item in prompt["imageFiles"]] == ["cand-b"]


@pytest.mark.parametrize(
    ("reference", "expected"),
    [
        ("/api/local-archive/assets/abc/image", "http://127.0.0.1:43030/api/local-archive/assets/abc/thumbnail?w=768"),
        ("/api/local-archive/assets/abc/image?x=1", "http://127.0.0.1:43030/api/local-archive/assets/abc/thumbnail?w=768"),
        ("/api/factory/jobs/j/history/assets/k/thumbnail", "http://127.0.0.1:41009/api/factory/jobs/j/history/assets/k/thumbnail"),
        ("http://127.0.0.1:5050/x.jpg", "http://127.0.0.1:5050/x.jpg"),
        ("asset:hero:1", ""),
        ("", ""),
    ],
)
def test_image_url_resolution(reference: str, expected: str) -> None:
    assert ClaudeOAuthJudge("http://hub.test")._image_url(reference) == expected
