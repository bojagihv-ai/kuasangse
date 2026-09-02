"""계약: 묶음 G6 에서 고친 백엔드 견고성 네 가지가 실제로 그렇게 동작한다.

  1. 자료함 원격 이미지: 302 로 루프백을 가리키면 **따라가지 않는다** (#20)
  2. 저장 요청이 한도를 넘으면 한국어 JSON 413 (413 처리)
  3. 청소 작업이 scoped 하위 폴더의 백업까지 본다. 살아 있는 저장본은 절대 안 건드린다 (#빠진것1)
  4. last-work 흔적 로그는 상한을 넘으면 밀리고, 격리 런타임에서는 아예 안 쓴다 (#31)
  5. 프로세스·창을 여는 라우트는 남의 사이트에서 못 누른다 (#21)

전부 "조용히 잘못되는" 자리다 - 화면에는 아무 표시도 안 난다.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import Config  # noqa: E402
from routes import api_archive, api_shared  # noqa: E402
from services import maintenance  # noqa: E402


# ---------------------------------------------------------------- 1) 리다이렉트

class _FakeResponse:
    def __init__(self, status_code, headers=None, body=b""):
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def iter_bytes(self):
        yield self._body


class _FakeClient:
    """URL 마다 정해둔 응답을 준다. 어디를 실제로 열었는지 기록한다."""

    def __init__(self, plan):
        self.plan = plan
        self.visited = []

    def stream(self, method, url):
        self.visited.append(url)
        if url not in self.plan:
            raise AssertionError(f"검사가 예상하지 않은 주소에 접속했습니다: {url}")
        return self.plan[url]


def test_redirect_to_loopback_is_not_followed(monkeypatch):
    """공개 주소로 시작해 302 로 127.0.0.1 을 가리키는 고전 수법.

    예전에는 httpx 의 follow_redirects=True 가 조용히 따라가서, 첫 홉 검사가 무의미했다.
    """
    monkeypatch.setattr(api_archive, "_local_asset_remote_url_is_public",
                        lambda url: "127.0.0.1" not in str(url) and "localhost" not in str(url))
    client = _FakeClient({
        "https://example.com/a.png": _FakeResponse(302, {"location": "http://127.0.0.1:8200/secret"}),
    })
    assert api_archive._local_asset_fetch_remote_image(client, "https://example.com/a.png") is None
    assert client.visited == ["https://example.com/a.png"], \
        f"루프백 주소를 실제로 열었습니다: {client.visited}"


def test_public_redirect_chain_is_followed_and_returns_image(monkeypatch):
    # 정상 리다이렉트까지 막으면 멀쩡한 이미지가 안 들어온다 - 그것도 회귀다.
    monkeypatch.setattr(api_archive, "_local_asset_remote_url_is_public", lambda url: True)
    client = _FakeClient({
        "https://example.com/a.png": _FakeResponse(302, {"location": "https://cdn.example.com/b.png"}),
        "https://cdn.example.com/b.png": _FakeResponse(200, {"content-type": "image/png"}, b"\x89PNG-body"),
    })
    result = api_archive._local_asset_fetch_remote_image(client, "https://example.com/a.png")
    assert result is not None, "공개 주소끼리의 리다이렉트는 따라가야 합니다"
    assert client.visited == ["https://example.com/a.png", "https://cdn.example.com/b.png"]


def test_redirect_loop_stops(monkeypatch):
    monkeypatch.setattr(api_archive, "_local_asset_remote_url_is_public", lambda url: True)
    client = _FakeClient({
        "https://example.com/loop": _FakeResponse(302, {"location": "https://example.com/loop"}),
    })
    assert api_archive._local_asset_fetch_remote_image(client, "https://example.com/loop") is None
    assert len(client.visited) <= api_archive._LOCAL_ASSET_MAX_REDIRECT_HOPS + 1


# ---------------------------------------------------------------- 2) 413

def test_oversized_save_answers_in_korean_json():
    """예전 Flask 기본 응답은 영어 HTML 이라, 화면은 "세션 저장에 실패했습니다" 로만 뭉뚱그렸다.

    무엇이 크고 무엇을 하면 되는지 사람 말로 나와야 한다.
    """
    from app import create_app

    client = create_app().test_client()
    too_big = b"x" * (int(Config.MAX_CONTENT_LENGTH) + 1024)
    result = client.post("/api/last-work?workspaceId=project:oversize",
                         data=too_big, content_type="application/json")
    assert result.status_code == 413
    payload = result.get_json()
    assert payload["code"] == "PAYLOAD_TOO_LARGE"
    assert payload["limitBytes"] == int(Config.MAX_CONTENT_LENGTH)
    assert "MB" in payload["error"] and "정리" in payload["error"], \
        f"무엇을 하면 되는지가 없습니다: {payload['error']}"


# ---------------------------------------------------------------- 3) 청소

def test_retention_sees_scoped_backups_but_never_live_copies(tmp_path):
    """scoped 하위 폴더의 .bak.json 3,819개가 영영 안 지워지던 자리.

    그리고 **살아 있는 저장본은 절대 후보가 아니다** - 이게 뒤집히면 작업이 통째로 사라진다.
    """
    local = tmp_path / ".local"
    scoped = local / "pdp-last-work-scoped"
    scoped.mkdir(parents=True)
    live_root = local / "pdp-last-work.json"
    live_bak = local / "pdp-last-work.bak.json"
    dated = local / "pdp-last-work.2026-08-01.json"
    scoped_live = scoped / "abc123.json"
    scoped_bak = scoped / "abc123.bak.json"
    nested_bak = scoped / "sub" / "def456.bak.json"
    nested_bak.parent.mkdir()
    for path in (live_root, live_bak, dated, scoped_live, scoped_bak, nested_bak):
        path.write_text("{}", encoding="utf-8")

    candidates = {p.name for p in maintenance._last_work_backup_candidates(local)}
    assert "pdp-last-work.2026-08-01.json" in candidates, "날짜 백업은 지울 수 있어야 합니다"
    assert "abc123.bak.json" in candidates, "scoped 백업이 후보에서 빠져 영영 안 지워지던 자리입니다"
    assert "def456.bak.json" in candidates, "하위 폴더까지 내려가야 합니다"

    assert "pdp-last-work.json" not in candidates, "살아 있는 저장본입니다"
    assert "pdp-last-work.bak.json" not in candidates, "마지막 되살리기용 한 벌입니다"
    assert "abc123.json" not in candidates, "작업별 라이브 저장본입니다 - 지우면 그 작업이 사라집니다"


def test_retention_reads_the_configured_state_folder(monkeypatch, tmp_path):
    """상태 폴더를 옮긴 런타임에서 엉뚱한 곳을 청소하던 자리."""
    moved = tmp_path / "moved-state"
    moved.mkdir()
    monkeypatch.setattr(Config, "LOCAL_STATE_FOLDER", str(moved), raising=False)
    source = Path(maintenance.__file__).read_text(encoding="utf-8")
    assert "Config.LOCAL_STATE_FOLDER" in source, \
        "청소 대상 폴더를 backend/.local 로 고정하면 옮긴 런타임에서 엉뚱한 곳을 지웁니다"


# ---------------------------------------------------------------- 4) 흔적 로그

def test_trace_log_is_silent_in_an_isolated_runtime(monkeypatch, tmp_path):
    """회귀 검사·진단 VM 의 저장 요청이 사장님 로그에 섞여 들어오던 자리."""
    monkeypatch.setattr(Config, "LOCAL_STATE_FOLDER", str(tmp_path / "isolated"), raising=False)
    assert api_archive._last_work_trace_path() is None


def test_trace_log_rotates_at_the_limit(monkeypatch, tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setattr(api_archive, "_DEFAULT_LOCAL_STATE_FOLDER", str(state))
    monkeypatch.setattr(Config, "LOCAL_STATE_FOLDER", str(state), raising=False)
    path = api_archive._last_work_trace_path()
    assert path is not None, "기본 상태 폴더에서는 기록해야 합니다"

    Path(path).write_bytes(b"x" * (api_archive._LAST_WORK_TRACE_MAX_BYTES + 1))
    api_archive._last_work_trace_rotate(path)
    assert not Path(path).exists(), "상한을 넘으면 현재 파일은 밀려나야 합니다"
    assert Path(f"{path}.1").exists(), "밀어 둔 한 벌은 남아야 합니다"

    # 상한 아래면 건드리지 않는다.
    Path(path).write_bytes(b"small")
    api_archive._last_work_trace_rotate(path)
    assert Path(path).read_bytes() == b"small"


# ---------------------------------------------------------------- 5) 교차 사이트

@pytest.mark.parametrize("route", [
    "/api/marketplus/open-admin",
    "/api/marketplus/open-normal-browser",
    "/api/marketplus/launch-debug-chrome",
])
def test_process_launching_routes_reject_other_sites(route):
    """백엔드가 127.0.0.1 에만 들어도, 브라우저가 대신 눌러 주면 그 벽은 없다.

    아무 사이트나 fetch() 한 줄로 사장님 PC 의 Chrome 을 띄울 수 있었다.
    """
    from app import create_app

    client = create_app().test_client()
    result = client.post(route, json={},
                         headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"})
    assert result.status_code == 403, f"{route} 가 남의 사이트 요청을 받았습니다"
    assert result.get_json()["code"] == "LOCAL_ACTION_ORIGIN_REQUIRED"


def test_the_guard_is_actually_wired_not_just_defined():
    """데코레이터가 정의만 되고 안 붙어 있으면 아무것도 막지 못한다.

    이름만 맞고 배선이 빠진 채 통과하는 함정을 2026-09-02 에 한 번 겪었다.
    """
    source = Path(api_shared.__file__).with_name("api_marketplus.py").read_text(encoding="utf-8")
    for route in ("open-admin", "open-normal-browser", "launch-debug-chrome"):
        index = source.index(f'"/marketplus/{route}"')
        window = source[index:index + 400]
        assert "@_require_local_action" in window, f"{route} 에 검사가 안 붙어 있습니다"


# ---------------------------------------------------------------- 6) Vertex 설정 저장

def test_failed_vertex_save_keeps_the_old_file_and_tells_the_truth(monkeypatch, tmp_path):
    """예전엔 open('w') 로 먼저 비운 뒤 실패해도 except: pass 였다 (#22).

    결과: 원본이 0바이트로 날아가고, 화면은 ok:true 를 받고,
    다음 요청부터 조용히 .env 기본값으로 되돌아갔다. 사람은 설정이 바뀐 줄 모른다.
    """
    good = tmp_path / "vertex-config.json"
    good.write_text(json.dumps({"project": "예전프로젝트", "location": "us-central1"}), encoding="utf-8")
    # 같은 이름의 폴더를 만들어 두면 os.replace 가 반드시 실패한다.
    # (_atomic_write_json 은 상위 폴더를 스스로 만들므로 "없는 폴더" 로는 실패하지 않는다)
    unwritable = tmp_path / "blocked" / "vertex-config.json"
    unwritable.mkdir(parents=True)

    monkeypatch.setattr(api_shared, "_VERTEX_CONFIG_PATH", str(good))
    monkeypatch.setattr(api_shared, "_SACHYOSANGSE_VERTEX_CONFIG_PATH", str(unwritable))

    with pytest.raises(api_shared.VertexConfigSaveError) as caught:
        api_shared._save_vertex_config("새프로젝트", "asia-northeast3")

    # 실패를 삼키지 않는다. 어느 파일이 왜 안 됐는지 들고 올라온다.
    assert str(unwritable) in str(caught.value)

    # 그리고 원본은 살아 있다 - 0바이트가 되지 않는다.
    kept = json.loads(good.read_text(encoding="utf-8"))
    assert kept["project"] in {"새프로젝트", "예전프로젝트"}, f"원본이 망가졌습니다: {kept}"
    assert good.stat().st_size > 0, "원본이 0바이트로 날아갔습니다"


def test_successful_vertex_save_writes_both_places(monkeypatch, tmp_path):
    first = tmp_path / "a" / "vertex-config.json"
    second = tmp_path / "b" / "vertex-config.json"
    first.parent.mkdir()
    second.parent.mkdir()
    monkeypatch.setattr(api_shared, "_VERTEX_CONFIG_PATH", str(first))
    monkeypatch.setattr(api_shared, "_SACHYOSANGSE_VERTEX_CONFIG_PATH", str(second))

    api_shared._save_vertex_config("프로젝트X", "asia-northeast3")
    for path in (first, second):
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data == {"project": "프로젝트X", "location": "asia-northeast3"}
