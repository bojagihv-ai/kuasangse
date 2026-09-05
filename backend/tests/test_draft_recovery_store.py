"""저장 전(draft:) 작업의 복구용 사본 계약.

2026-08-31 주인님이 하루에 두 번 작업을 잃었고 되살릴 사본이 없었다.
정상 저장(/api/last-work)은 편집권(lease)을 검증하는데 그 검증이 project: 스코프에만
걸려 있어 draft 는 통과 자체가 불가능하다. 그래서 별도의 그물을 둔다.

이 저장소는 편집권을 거치지 않는다. 그러므로 **정상 저장을 대체하지 않는다** -
project: 스코프는 받지 않아야 하고, 자동 복원에도 쓰지 않는다.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import create_app  # noqa: E402


@pytest.fixture()
def client():
    return create_app().test_client()


DRAFT = "draft:lastwork_pytest_contract"


def test_saved_work_is_accepted_because_the_normal_path_can_refuse_it(client):
    # 2026-09-02 부터 project: 도 받는다. 정상 저장(/api/last-work)이 보호 사유로 거절하면
    # 그 작업이야말로 사본이 필요하기 때문이다(낙지발노리개 54건 연속 거절).
    # 뒷문이 아닌 근거: 이 저장소는 자동 복원에 쓰이지 않는다 - 아래 검사가 그것을 지킨다.
    response = client.post("/api/draft-recovery", json={
        "scopeId": "project:abc", "snapshot": {"productName": "거절된작업"}, "reason": "server-refused",
    })
    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_nonsense_scope_is_still_refused(client):
    response = client.post("/api/draft-recovery", json={"scopeId": "batch:job-1", "snapshot": {}})
    assert response.status_code == 400
    assert response.get_json()["ok"] is False


def test_recovery_store_is_never_read_by_automatic_restore():
    # 이 저장소를 자동 복원이 읽기 시작하면 편집권을 우회하는 뒷문이 된다.
    # 되살리기 버튼(restoreDraftRecoveryEntry)만 읽어야 한다.
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[2]
    callers = []
    for path in (root / "src").rglob("*.js"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "/api/draft-recovery" in text:
            callers.append(path.name)
    for path in (root / "src").rglob("*.mjs"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "/api/draft-recovery" in text:
            callers.append(path.name)
    # app-core-02: 사본 남기기(쓰기), app-core-03: 되살리기 버튼(읽기). 그 둘뿐이어야 한다.
    assert sorted(set(callers)) == ["app-core-02.js", "app-core-03.js"], sorted(set(callers))


def test_snapshot_must_be_an_object(client):
    response = client.post("/api/draft-recovery", json={"scopeId": DRAFT, "snapshot": "not-an-object"})
    assert response.status_code == 400


def test_saved_entry_can_be_read_back_with_the_listed_id(client):
    # 목록이 알려준 savedAt 으로 반드시 다시 읽을 수 있어야 한다.
    # 실측 2026-08-31: 목록이 파일 이름 대신 수정시각을 돌려줘 그 값으로는 404 가 났다.
    client.post("/api/draft-recovery", json={
        "scopeId": DRAFT,
        "snapshot": {"productName": "계약시험", "confirmedDb": {"jcode": 743}},
        "productName": "계약시험",
        "reason": "candidate-confirm",
    })
    listed = client.get(f"/api/draft-recovery?scopeId={DRAFT}").get_json()
    assert listed["ok"] is True
    assert listed["entries"], "저장했는데 목록이 비어 있습니다."
    saved_at = listed["entries"][0]["savedAt"]

    entry = client.get(f"/api/draft-recovery/entry?scopeId={DRAFT}&savedAt={saved_at}")
    assert entry.status_code == 200
    body = entry.get_json()
    assert body["ok"] is True
    assert body["snapshot"]["confirmedDb"]["jcode"] == 743
    assert body["productName"] == "계약시험"


def test_only_recent_copies_are_kept(client):
    scope = "draft:lastwork_pytest_prune"
    for index in range(8):
        client.post("/api/draft-recovery", json={"scopeId": scope, "snapshot": {"n": index}})
    entries = client.get(f"/api/draft-recovery?scopeId={scope}").get_json()["entries"]
    assert len(entries) <= 5, "무한히 쌓이면 디스크를 먹는다."
    assert entries == sorted(entries, key=lambda row: row["savedAt"], reverse=True), "최신이 먼저 와야 고르기 쉽다."


@pytest.mark.parametrize("saved_at", ["../../etc/passwd", "..", "abc", ""])
def test_entry_id_cannot_escape_the_scope_directory(client, saved_at):
    response = client.get(f"/api/draft-recovery/entry?scopeId={DRAFT}&savedAt={saved_at}")
    assert response.status_code in (400, 404)
    assert response.get_json()["ok"] is False


def test_listing_a_scope_with_no_copies_is_not_an_error(client):
    # 사본이 없는 것과 실패한 것은 다르다. 여기서 500 이 나면 화면이 또 사유를 잃는다.
    response = client.get("/api/draft-recovery?scopeId=draft:lastwork_pytest_empty")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "scopeId": "draft:lastwork_pytest_empty", "entries": []}
