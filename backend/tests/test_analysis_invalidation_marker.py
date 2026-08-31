"""분석 결과가 사라지는 저장 — 사고로 잃은 것과 일부러 분리한 것을 가른다.

서버는 compPage.analysisResult 가 사라지는 저장을 막는다(사고로 잃는 것을 지키려고).
그런데 선택 이미지가 바뀌면 앱이 이전 분석을 "일부러" 분리한다. 그 둘을 구분하지
못하면 다 만들어 놓은 작업이 마지막 저장에서 막힌다 — 실측 2026-08-29:
factory_product_checkpoint_save_failed ... dropped protected work data: compPage.analysisResult

selectedIds 가 detailSelectionVersion 으로 하는 것과 같은 방식으로,
analysisInvalidatedAt 이 더 새로울 때만 허용한다.
"""

from __future__ import annotations

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
