"""두 관문이 같은 "일부러 분리했다" 표시를 따라야 한다.

파생 보호(_last_work_derived_state_drop_reason)만 표시를 보고 no-comp-analysis 관문이
안 보면, 표시를 달아도 저장은 계속 거절된다 - 실측 2026-08-31.
"""
from backend.routes.api_archive import _last_work_analysis_invalidated_on_purpose


def _snapshot(comp_page):
    return {"assets": {"compPage": comp_page}}


def test_표시가_더_새로우면_일부러_분리한_것으로_본다():
    existing = _snapshot({"analysisResult": {"conclusion": "이전"}, "analysisInvalidatedAt": 100})
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 200})
    assert _last_work_analysis_invalidated_on_purpose(existing, incoming) is True


def test_표시가_같으면_사고로_본다():
    existing = _snapshot({"analysisResult": {"conclusion": "이전"}, "analysisInvalidatedAt": 200})
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 200})
    assert _last_work_analysis_invalidated_on_purpose(existing, incoming) is False


def test_표시가_아예_없으면_사고로_본다():
    existing = _snapshot({"analysisResult": {"conclusion": "이전"}})
    incoming = _snapshot({"analysisResult": None})
    assert _last_work_analysis_invalidated_on_purpose(existing, incoming) is False


def test_표시가_거꾸로면_사고로_본다():
    existing = _snapshot({"analysisResult": {"conclusion": "이전"}, "analysisInvalidatedAt": 300})
    incoming = _snapshot({"analysisResult": None, "analysisInvalidatedAt": 100})
    assert _last_work_analysis_invalidated_on_purpose(existing, incoming) is False


def test_compPage가_없어도_터지지_않는다():
    assert _last_work_analysis_invalidated_on_purpose({}, {}) is False
    assert _last_work_analysis_invalidated_on_purpose({"assets": {}}, {"assets": {}}) is False
