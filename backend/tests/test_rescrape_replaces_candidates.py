"""재검색으로 후보가 바뀌었을 때 저장이 막히지 않아야 한다.

실측 2026-08-31: 재검색한 작업의 저장이 70건 연속 거절됐고, 사유는 모두
compPage.marketScrape.results.content[...].missing 이었다. 화면은 아무 말도 하지 않고
워커만 10초마다 "replica already contains a newer revision" 을 반복했다.
보호 자체는 남겨야 한다 - 검색 세션이 그대로인데 후보가 사라지는 것은 여전히 사고다.
"""
from backend.routes.api_archive import _last_work_derived_state_drop_reason


def _snapshot(search_id, ids):
    return {
        "assets": {
            "compPage": {
                "marketScrape": {
                    "searchId": search_id,
                    "results": [{"id": item, "title": item} for item in ids],
                }
            }
        }
    }


def test_검색이_바뀌면_후보_교체를_허용한다():
    existing = _snapshot("search_old", ["coupang_1", "coupang_2"])
    incoming = _snapshot("search_new", ["naver_9"])
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_같은_검색에서_후보가_사라지면_여전히_막는다():
    existing = _snapshot("search_same", ["coupang_1", "coupang_2"])
    incoming = _snapshot("search_same", ["coupang_1"])
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")


def test_새_검색이어도_후보가_비면_막는다():
    existing = _snapshot("search_old", ["coupang_1", "coupang_2"])
    incoming = _snapshot("search_new", [])
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")


def test_검색값이_없으면_보호는_그대로다():
    existing = _snapshot("", ["coupang_1", "coupang_2"])
    incoming = _snapshot("", ["coupang_1"])
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")


def test_들어온_쪽에만_검색값이_있어도_보호는_그대로다():
    existing = _snapshot("", ["coupang_1", "coupang_2"])
    incoming = _snapshot("search_new", ["coupang_1"])
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")
