"""계약: 사람이 일부러 지운 옵션 원본은 '보호할 데이터가 사라졌다' 로 보지 않는다.

주인님 2026-09-02: "컷들을 생성하고 필수값을 선정하고 vm을 선정하고 하던게 날아가지않는것,
날아가는경우는 새 작업을 시작한경우에만 해당"

실측: 옵션 이미지를 하나 지우면 assets.optionSorter.images 개수가 줄고,
_last_work_derived_state_drop_reason 이 'optionSorter.images.length' 로 거절한다.
한 번 거절이 시작되면 그 작업의 **모든** 저장이 같은 이유로 막힌다 —
낙지발노리개 작업(project:project_mt2jaj93_ilrs1e)은 2026-08-31 21:37 ~ 09-01 15:20
사이 도착한 54건이 전부 이 사유로 거절됐고 서버 사본이 08-21 에 멈춰 있었다.

프런트는 지운 것을 optionSourceDeletedArchiveIds 에 남긴다
(src/menus/optionsorter-image-bindings.mjs:40, src/app-core-02.js:7818에서 병합).
백엔드가 그걸 읽지 않아서 '일부러 지운 것' 과 '사고로 사라진 것' 을 구별하지 못했다.

marketScrape 는 searchId, selectedIds 는 detailSelectionVersion, analysisResult 는
analysisInvalidatedAt 으로 이미 같은 종류의 탈출구를 갖고 있다. optionSorter 에만 없었다.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from routes.api_archive import _last_work_derived_state_drop_reason  # noqa: E402


def snapshot(images, deleted=None, **extra):
    options = {"images": list(images)}
    if deleted is not None:
        options["optionSourceDeletedArchiveIds"] = list(deleted)
    options.update(extra)
    return {"assets": {"optionSorter": options}}


def test_shrink_without_a_deletion_marker_is_still_refused():
    # 사고로 사라진 것은 그대로 막아야 한다. 이 보호가 느슨해지면 진짜 손실을 놓친다.
    existing = snapshot(["a", "b", "c"])
    incoming = snapshot(["a", "b"])
    assert _last_work_derived_state_drop_reason(existing, incoming) == "optionSorter.images.length"


def test_deliberate_deletion_passes():
    # 하나를 일부러 지웠다고 표시했으면 하나 줄어든 것은 손실이 아니다.
    existing = snapshot(["a", "b", "c"], deleted=[])
    incoming = snapshot(["a", "b"], deleted=["c"])
    assert not _last_work_derived_state_drop_reason(existing, incoming)


def test_deleting_more_than_marked_is_refused():
    # 하나만 지웠다고 해놓고 둘이 사라졌으면 그건 설명되지 않는다.
    existing = snapshot(["a", "b", "c", "d"], deleted=[])
    incoming = snapshot(["a"], deleted=["d"])
    assert _last_work_derived_state_drop_reason(existing, incoming) == "optionSorter.images.length"


def test_marker_carried_over_from_a_previous_save_does_not_grant_new_deletions():
    # 지난번에 지운 표식이 남아 있다고 이번에 또 지울 권한이 생기면 안 된다.
    existing = snapshot(["a", "b", "c"], deleted=["z"])
    incoming = snapshot(["a", "b"], deleted=["z"])
    assert _last_work_derived_state_drop_reason(existing, incoming) == "optionSorter.images.length"


def test_deleting_after_a_previous_deletion_passes():
    existing = snapshot(["a", "b", "c"], deleted=["z"])
    incoming = snapshot(["a", "b"], deleted=["z", "c"])
    assert not _last_work_derived_state_drop_reason(existing, incoming)


@pytest.mark.parametrize("key", ["pool", "optionResults", "slots"])
def test_other_option_lists_keep_their_protection(key):
    # 삭제 표식은 원본 이미지에 대한 것이다. 나머지 목록의 보호는 그대로 둔다.
    existing = {"assets": {"optionSorter": {key: [1, 2, 3], "optionSourceDeletedArchiveIds": []}}}
    incoming = {"assets": {"optionSorter": {key: [1, 2], "optionSourceDeletedArchiveIds": ["x"]}}}
    assert _last_work_derived_state_drop_reason(existing, incoming) == f"optionSorter.{key}.length"


def test_no_option_sorter_at_all_is_unaffected():
    assert not _last_work_derived_state_drop_reason({"assets": {}}, {"assets": {}})
