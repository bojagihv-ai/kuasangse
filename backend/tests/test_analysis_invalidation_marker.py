"""분석 결과가 사라지는 저장 — 사고로 잃은 것과 일부러 분리한 것을 가른다.

서버는 compPage.analysisResult 가 사라지는 저장을 막는다(사고로 잃는 것을 지키려고).
그런데 선택 이미지가 바뀌면 앱이 이전 분석을 "일부러" 분리한다. 그 둘을 구분하지
못하면 다 만들어 놓은 작업이 마지막 저장에서 막힌다 — 실측 2026-08-29:
factory_product_checkpoint_save_failed ... dropped protected work data: compPage.analysisResult

selectedIds 가 detailSelectionVersion 으로 하는 것과 같은 방식으로,
analysisInvalidatedAt 이 더 새로울 때만 허용한다.
"""

from __future__ import annotations

import copy
import json

import pytest

from routes.api_archive import _last_work_derived_state_drop_reason


def _snapshot(comp_page):
    return {"assets": {"compPage": comp_page}}


def test_분석이_이유없이_사라지면_막는다():
    existing = _snapshot({"analysisResult": {"conclusion": "지켜야 할 분석"}})
    incoming = _snapshot({"analysisResult": None})
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.analysisResult")


def test_일부러_분리했다는_표시가_더_새로우면_허용한다():
    existing = _snapshot({
        "analysisResult": {"conclusion": "이전 분석"},
        "analysisInvalidatedAt": 100,
    })
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 200})
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_표시가_같거나_오래되면_여전히_막는다():
    existing = _snapshot({
        "analysisResult": {"conclusion": "이전 분석"},
        "analysisInvalidatedAt": 200,
    })
    same = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 200})
    older = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 100})
    assert _last_work_derived_state_drop_reason(existing, same).startswith("compPage.analysisResult")
    assert _last_work_derived_state_drop_reason(existing, older).startswith("compPage.analysisResult")


def test_표시가_아예_없으면_보호는_그대로다():
    existing = _snapshot({"analysisResult": {"conclusion": "이전 분석"}})
    incoming = _snapshot({"analysisResult": None})
    assert _last_work_derived_state_drop_reason(existing, incoming).startswith("compPage.analysisResult")


def test_섹션계획도_같은_표시를_따른다():
    existing = _snapshot({
        "sectionPlan": {"sections": ["a", "b"]},
        "analysisInvalidatedAt": 10,
    })
    incoming = _snapshot({"sectionPlan": None, "analysisInvalidatedAt": 20})
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_분석이_그대로_남아있으면_아무것도_막지_않는다():
    kept = {"analysisResult": {"conclusion": "그대로"}}
    assert _last_work_derived_state_drop_reason(_snapshot(kept), _snapshot(kept)) == ""


def test_분석_섹션의_정확한_중복만_제거한_저장은_허용한다():
    rows = [
        {"title": "첫째", "values": [1, 2]},
        {"title": "둘째", "values": [3, 4]},
        {"title": "타입", "value": True},
        {"title": "타입", "value": 1},
    ]
    existing = _snapshot({"analysisResult": {
        "analyzedAt": 100,
        "sections_found": [*rows, *rows],
    }})
    incoming = _snapshot({"analysisResult": {
        "analyzedAt": 100,
        "sections_found": rows,
    }})

    assert _last_work_derived_state_drop_reason(existing, incoming) == ""


def test_분석_섹션_중복_정리처럼_보여도_실제_내용_감소나_변경은_막는다():
    rows = [{"title": "첫째", "body": "A"}, {"title": "둘째", "body": "B"}]
    existing = _snapshot({"analysisResult": {"sections_found": [*rows, *rows]}})

    missing = _snapshot({"analysisResult": {"sections_found": rows[:1]}})
    mutated = _snapshot({"analysisResult": {"sections_found": [rows[0], {"title": "둘째"}]}})
    reordered = _snapshot({"analysisResult": {"sections_found": list(reversed(rows))}})
    scalar_type_drop = _snapshot({"analysisResult": {"sections_found": [{"value": True}]}})
    scalar_type_existing = _snapshot({
        "analysisResult": {"sections_found": [{"value": True}, {"value": 1}] * 2},
    })
    other_array = _snapshot({"analysisResult": {"sections_found": [*rows, *rows], "other": [1]}})
    other_array_existing = _snapshot({
        "analysisResult": {"sections_found": [*rows, *rows], "other": [1, 1]},
    })

    assert "sections_found" in _last_work_derived_state_drop_reason(existing, missing)
    assert "sections_found" in _last_work_derived_state_drop_reason(existing, mutated)
    assert "sections_found" in _last_work_derived_state_drop_reason(existing, reordered)
    assert "sections_found" in _last_work_derived_state_drop_reason(scalar_type_existing, scalar_type_drop)
    assert ".other" in _last_work_derived_state_drop_reason(other_array_existing, other_array)


def test_분석_중복_정리는_후보_선택이나_사진_감소를_허용하지_않는다():
    rows = [{"title": "첫째"}, {"title": "둘째"}]
    existing = _snapshot({
        "analysisResult": {"sections_found": [*rows, *rows]},
        "marketScrape": {
            "selectedIds": ["candidate-1", "candidate-2"],
            "scrapedImages": [{"id": "photo-1"}, {"id": "photo-2"}],
        },
    })
    selected_drop = _snapshot({
        "analysisResult": {"sections_found": rows},
        "marketScrape": {
            "selectedIds": ["candidate-1"],
            "scrapedImages": [{"id": "photo-1"}, {"id": "photo-2"}],
        },
    })
    photo_drop = _snapshot({
        "analysisResult": {"sections_found": rows},
        "marketScrape": {
            "selectedIds": ["candidate-1", "candidate-2"],
            "scrapedImages": [{"id": "photo-1"}],
        },
    })

    assert "selectedIds" in _last_work_derived_state_drop_reason(existing, selected_drop)
    assert "scrapedImages" in _last_work_derived_state_drop_reason(existing, photo_drop)


@pytest.mark.parametrize("duplicate_sections", [False, True])
def test_exact_score_criteria_duplicate_cleanup_keeps_the_whole_analysis(duplicate_sections):
    from routes.api_archive import _last_work_keep_derived_analysis

    rows = [{"name": "기준", "value": True}, {"name": "기준", "value": 1}]
    original = {"sections_found": [{"title": "섹션"}], "page_score": {"total": 74, "criteria": rows}}
    stored = copy.deepcopy(original)
    stored["page_score"]["criteria"] *= 2
    if duplicate_sections:
        stored["sections_found"] *= 2
    existing = _snapshot({"analysisResult": stored})
    incoming = _snapshot({"analysisResult": copy.deepcopy(original)})

    assert _last_work_keep_derived_analysis(existing, incoming) == []
    assert _last_work_derived_state_drop_reason(existing, incoming) == ""
    assert json.dumps(incoming["assets"]["compPage"]["analysisResult"], sort_keys=True) == json.dumps(original, sort_keys=True)
    assert len(existing["assets"]["compPage"]["analysisResult"]["page_score"]["criteria"]) == 4


def test_score_criteria_cleanup_rejects_unique_loss_mutation_order_and_other_arrays():
    rows = [
        {"name": "기준", "value": True, "evidence": [1, 2]},
        {"name": "기준", "value": 1, "evidence": [1, 2]},
        {"name": "다른 기준", "value": 2, "evidence": [3, 4]},
    ]
    original = {"page_score": {"total": 74, "criteria": rows}, "other": [1, 1]}
    stored = copy.deepcopy(original)
    stored["page_score"]["criteria"] *= 2
    existing = _snapshot({"analysisResult": stored})
    for bad_rows in [
        rows[1:],
        list(reversed(rows)),
        [dict(rows[0], value=1), *rows[1:]],
        [dict(rows[0], evidence=[2, 1]), *rows[1:]],
        [{"name": "기준", "value": True}, *rows[1:]],
    ]:
        incoming = copy.deepcopy(original)
        incoming["page_score"]["criteria"] = bad_rows
        assert "page_score.criteria" in _last_work_derived_state_drop_reason(existing, _snapshot({"analysisResult": incoming}))
    for field in ["other", "criteria"]:
        current = {field: [rows[0], rows[0]]}
        incoming = {field: [rows[0]]}
        assert field in _last_work_derived_state_drop_reason(_snapshot({"analysisResult": current}), _snapshot({"analysisResult": incoming}))
    incoming = copy.deepcopy(original)
    incoming["other"] = [1]
    assert _last_work_derived_state_drop_reason(existing, _snapshot({"analysisResult": incoming}))
