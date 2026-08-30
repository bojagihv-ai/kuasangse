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


def _with_details(search_id, ids, details):
    snapshot = _snapshot(search_id, ids)
    snapshot["assets"]["compPage"]["marketScrape"]["detailResults"] = details
    return snapshot


def test_재검색하면_사라진_후보의_상세결과는_버려도_된다():
    existing = _with_details("search_old", ["coupang_1"], {"coupang_1": {"images": ["a.png"]}})
    incoming = _with_details("search_new", ["naver_9"], {})
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_재검색이어도_살아남은_후보의_상세결과는_지킨다():
    existing = _with_details("search_old", ["coupang_1"], {"coupang_1": {"images": ["a.png"]}})
    # 새 검색이지만 coupang_1 은 여전히 후보에 있다. 그 상세 결과를 지우는 것은 사고다.
    incoming = _with_details("search_new", ["coupang_1", "naver_9"], {})
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.detailResults")


def test_같은_검색이면_상세결과_보호는_그대로다():
    existing = _with_details("search_same", ["coupang_1"], {"coupang_1": {"images": ["a.png"]}})
    incoming = _with_details("search_same", ["coupang_1"], {})
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.detailResults")


# 적대적 검증(2026-08-31)이 실제로 실행해서 찾아낸 구멍. 탈출구가 근거보다 넓어,
# 앱이 재검색 때 **일부러 보존하는** 값까지 서버 보호가 꺼졌다.
# 앱이 비우는 것은 results/groupedResults/selectedIds/searchId 뿐이다
# (src/app-core-06.js:4755-4763 preservedMarket).

def _market(search_id, ids, **extra_fields):
    snapshot = _snapshot(search_id, ids)
    snapshot["assets"]["compPage"]["marketScrape"].update(extra_fields)
    return snapshot


def test_재검색이어도_상세캡처_이미지는_지킨다():
    existing = _market("search_old", ["c0", "c1"], scrapedImages=[{"id": "img1"}, {"id": "img2"}])
    incoming = _market("search_new", ["c9"], scrapedImages=[])
    reason = _last_work_derived_state_drop_reason(existing, incoming)
    assert reason.startswith("compPage.marketScrape.scrapedImages"), reason


def test_재검색이어도_본컴_결과는_지킨다():
    existing = _market("search_old", ["c0", "c1"], localResults=[{"id": "c0"}, {"id": "c1"}])
    incoming = _market("search_new", ["c9"], localResults=[])
    reason = _last_work_derived_state_drop_reason(existing, incoming)
    assert reason.startswith("compPage.marketScrape.localResults"), reason


def test_재검색이어도_VM_결과는_지킨다():
    existing = _market("search_old", ["c0"], vmResults=[{"id": "c0"}])
    incoming = _market("search_new", ["c9"], vmResults=[])
    reason = _last_work_derived_state_drop_reason(existing, incoming)
    assert reason.startswith("compPage.marketScrape.vmResults"), reason


def test_보존하는_값이_그대로면_재검색은_통과한다():
    kept = {"scrapedImages": [{"id": "img1"}], "localResults": [{"id": "c0"}], "vmResults": []}
    existing = _market("search_old", ["c0", "c1"], **kept)
    incoming = _market("search_new", ["c9"], **kept)
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""
