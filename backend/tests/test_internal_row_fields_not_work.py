"""행 안의 내부 기록용 필드 하나 때문에 스냅샷 전체가 거절되면 안 된다.

실측 2026-08-31: 후보 20건·이미지 1장·상세결과 4건이 모두 그대로인데
results.content[coupang_9075021207]._session_id 가 빠졌다는 이유로 저장이 계속 거절돼
「Cafe24 대상 떼기」 결과가 영영 서버에 닿지 못했다.
"""
from backend.routes.api_archive import _last_work_derived_state_drop_reason


def _snapshot(rows):
    return {"assets": {"compPage": {"marketScrape": {"searchId": "S1", "results": rows}}}}


def test_검색_기록용_필드가_빠져도_막지_않는다():
    existing = _snapshot([{
        "id": "c0", "title": "후보", "_session_id": "S1", "_search_id": "S1",
        "_source_keyword": "전통 수저집", "_source_sites": ["coupang"], "_search_runtime": "local",
    }])
    incoming = _snapshot([{"id": "c0", "title": "후보"}])
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_사람이_만든_값이_빠지면_여전히_막는다():
    existing = _snapshot([{"id": "c0", "title": "후보", "memo": "직접 적은 메모", "_session_id": "S1"}])
    incoming = _snapshot([{"id": "c0", "title": "후보", "_session_id": "S1"}])
    reason = _last_work_derived_state_drop_reason(existing, incoming)
    assert "memo" in reason, reason


def test_후보_자체가_사라지면_여전히_막는다():
    existing = _snapshot([{"id": "c0", "_session_id": "S1"}, {"id": "c1", "_session_id": "S1"}])
    incoming = _snapshot([{"id": "c0", "_session_id": "S1"}])
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")
