"""분석 묶음이 비어 들어오면 스냅샷 전체를 거절하지 말고 지킬 값만 되살려야 한다.

보호의 목적은 "분석을 잃지 않는 것" 이다. 그런데 그 하나 때문에 스냅샷 전체를 거절하면
같은 저장에 실려 온 다른 작업까지 함께 막힌다 - 실측 2026-08-31:
「Cafe24 대상 떼기」 결과가 이 이유로 몇 번을 눌러도 서버에 닿지 못했다.
"""
import copy

from routes.api_archive import (
    _last_work_derived_state_drop_reason,
    _last_work_keep_derived_analysis,
)

ANALYSIS = {"page_title": "전통 수저집", "sections_found": ["a", "b"]}


def _snapshot(comp):
    return {"assets": {"compPage": comp}}


def test_비어_들어온_분석은_되살리고_나머지는_받는다():
    existing = _snapshot({"analysisResult": ANALYSIS, "analysisInvalidatedAt": 0})
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 0, "새작업": "떼기 완료"})
    kept = _last_work_keep_derived_analysis(existing, incoming)
    assert kept == ["analysisResult"]
    assert incoming["assets"]["compPage"]["analysisResult"] == ANALYSIS
    assert incoming["assets"]["compPage"]["새작업"] == "떼기 완료"
    # 되살렸으니 더 이상 거절 사유가 아니다.
    assert "analysisResult" not in _last_work_derived_state_drop_reason(existing, incoming)


def test_섹션계획과_편집본도_되살린다():
    existing = _snapshot({"sectionPlan": {"sections": ["s1"]}, "planEdits": {"s1": "고침"}})
    incoming = _snapshot({"sectionPlan": None, "planEdits": None})
    kept = _last_work_keep_derived_analysis(existing, incoming)
    assert set(kept) == {"sectionPlan", "planEdits"}
    assert incoming["assets"]["compPage"]["sectionPlan"] == {"sections": ["s1"]}


def test_일부러_분리했으면_되살리지_않는다():
    existing = _snapshot({"analysisResult": ANALYSIS, "analysisInvalidatedAt": 100})
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 200})
    assert _last_work_keep_derived_analysis(existing, incoming) == []
    assert incoming["assets"]["compPage"]["analysisResult"] is None


def test_새_분석이_와도_그_값은_그대로_이긴다():
    # 계약: 들어온 값이 있는 자리는 절대 덮지 않는다. 없는 자리만 저장된 값으로 채운다.
    # 통째로 거절하면 새 분석 자체가 저장되지 못하므로, 채워 넣고 받는 쪽을 택했다.
    fresh = {"page_title": "새 분석"}
    existing = _snapshot({"analysisResult": ANALYSIS})
    incoming = _snapshot({"analysisResult": dict(fresh)})
    _last_work_keep_derived_analysis(existing, incoming)
    result = incoming["assets"]["compPage"]["analysisResult"]
    assert result["page_title"] == "새 분석"
    assert result["sections_found"] == ANALYSIS["sections_found"]


def test_다른_보호는_그대로다():
    # 후보가 사라지는 것은 여전히 막아야 한다 — 되살리기는 분석 묶음에만 적용된다.
    existing = {"assets": {"compPage": {
        "analysisResult": ANALYSIS,
        "marketScrape": {"searchId": "S1", "results": [{"id": "c0"}, {"id": "c1"}]},
    }}}
    incoming = copy.deepcopy(existing)
    incoming["assets"]["compPage"]["analysisResult"] = None
    incoming["assets"]["compPage"]["marketScrape"]["results"] = [{"id": "c0"}]
    _last_work_keep_derived_analysis(existing, incoming)
    reason = _last_work_derived_state_drop_reason(existing, incoming)
    assert reason.startswith("compPage.marketScrape.results"), reason


def test_구조가_이상해도_터지지_않는다():
    assert _last_work_keep_derived_analysis({}, {}) == []
    assert _last_work_keep_derived_analysis(None, None) == []
    assert _last_work_keep_derived_analysis({"assets": {}}, {"assets": {}}) == []


# 실측 2026-08-31: 분석은 양쪽 다 있는데 하위 항목 cta_patterns 하나가 빠졌다는 이유로
# 스냅샷 전체가 거절돼 「Cafe24 대상 떼기」 가 서버에 닿지 못했다.

def test_하위_항목_하나가_빠지면_그것만_되살린다():
    existing = _snapshot({"analysisResult": {
        "page_title": "전통 수저집", "cta_patterns": ["지금 구매", "장바구니"],
    }})
    incoming = _snapshot({"analysisResult": {"page_title": "전통 수저집 (수정)"}, "새작업": "떼기 완료"})
    kept = _last_work_keep_derived_analysis(existing, incoming)
    assert kept == ["analysisResult"]
    result = incoming["assets"]["compPage"]["analysisResult"]
    # 들어온 값은 그대로 이기고, 빠진 자리만 채워진다.
    assert result["page_title"] == "전통 수저집 (수정)"
    assert result["cta_patterns"] == ["지금 구매", "장바구니"]
    assert incoming["assets"]["compPage"]["새작업"] == "떼기 완료"
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_들어온_값이_있으면_절대_덮지_않는다():
    existing = _snapshot({"analysisResult": {"cta_patterns": ["옛것"], "tone": "차분"}})
    incoming = _snapshot({"analysisResult": {"cta_patterns": ["새것"]}})
    _last_work_keep_derived_analysis(existing, incoming)
    result = incoming["assets"]["compPage"]["analysisResult"]
    assert result["cta_patterns"] == ["새것"]
    assert result["tone"] == "차분"


def test_목록은_줄어든_꼬리만_되살린다():
    existing = _snapshot({"analysisResult": {"sections": ["a", "b", "c"]}})
    incoming = _snapshot({"analysisResult": {"sections": ["A"]}})
    _last_work_keep_derived_analysis(existing, incoming)
    assert incoming["assets"]["compPage"]["analysisResult"]["sections"] == ["A", "b", "c"]


def test_바뀐_것이_없으면_되살렸다고_하지_않는다():
    same = {"analysisResult": {"page_title": "전통 수저집"}}
    existing = _snapshot(dict(same))
    incoming = _snapshot(dict(same))
    assert _last_work_keep_derived_analysis(existing, incoming) == []


def test_목록_원소_안쪽의_빠진_자리도_되살린다():
    # 실측 2026-08-31: analysisResult.page_score.criteria[9].issues 하나 때문에 거절됐다.
    existing = _snapshot({"analysisResult": {"page_score": {"criteria": [
        {"name": "가독성", "issues": ["줄간격"]},
        {"name": "구성", "issues": ["순서"]},
    ]}}})
    incoming = _snapshot({"analysisResult": {"page_score": {"criteria": [
        {"name": "가독성", "issues": ["줄간격"]},
        {"name": "구성"},
    ]}}})
    kept = _last_work_keep_derived_analysis(existing, incoming)
    assert kept == ["analysisResult"]
    criteria = incoming["assets"]["compPage"]["analysisResult"]["page_score"]["criteria"]
    assert criteria[1]["issues"] == ["순서"]
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_목록_원소의_있는_값은_덮지_않는다():
    existing = _snapshot({"analysisResult": {"rows": [{"a": "옛것", "b": "지킬것"}]}})
    incoming = _snapshot({"analysisResult": {"rows": [{"a": "새것"}]}})
    _last_work_keep_derived_analysis(existing, incoming)
    rows = incoming["assets"]["compPage"]["analysisResult"]["rows"]
    assert rows[0]["a"] == "새것"
    assert rows[0]["b"] == "지킬것"


# 실측 2026-08-31: results.content[coupang_9075021207].match_tier 하나 때문에
# 「Cafe24 대상 떼기」 결과가 저장되지 못했다. 행은 그대로 있고 필드 하나만 빠진 경우다.

def _market_snapshot(rows, search_id="S1"):
    return {"assets": {"compPage": {"marketScrape": {"searchId": search_id, "results": rows}}}}


def test_후보_행의_빠진_점수_필드는_되살린다():
    existing = _market_snapshot([{"id": "c0", "title": "후보", "match_tier": 3, "match_score": 158}])
    incoming = _market_snapshot([{"id": "c0", "title": "후보"}])
    kept = _last_work_keep_derived_analysis(existing, incoming)
    assert "marketScrape.rows" in kept
    row = incoming["assets"]["compPage"]["marketScrape"]["results"][0]
    assert row["match_tier"] == 3 and row["match_score"] == 158
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_후보_행의_있는_값은_덮지_않는다():
    existing = _market_snapshot([{"id": "c0", "match_tier": 3}])
    incoming = _market_snapshot([{"id": "c0", "match_tier": 1}])
    _last_work_keep_derived_analysis(existing, incoming)
    assert incoming["assets"]["compPage"]["marketScrape"]["results"][0]["match_tier"] == 1


def test_후보_행이_사라진_것은_되살리지_않는다():
    # 행 자체가 없어지는 것은 여전히 보호 대상이다.
    existing = _market_snapshot([{"id": "c0"}, {"id": "c1"}])
    incoming = _market_snapshot([{"id": "c0"}])
    _last_work_keep_derived_analysis(existing, incoming)
    rows = incoming["assets"]["compPage"]["marketScrape"]["results"]
    assert len(rows) == 1
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.marketScrape.results")
