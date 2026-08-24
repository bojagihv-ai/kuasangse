"""옵션 이미지를 아카이브로 내보낸 저장이 소실로 오인되지 않는지 지킨다."""

from __future__ import annotations

from routes import api_archive


def _snapshot(rows: list[dict]) -> dict:
    return {"assets": {"optionSorter": {"optionResults": rows, "slots": [], "images": [], "pool": []}}}


def _saved_row(**overrides) -> dict:
    row = {
        "id": "or_1787497463758_2q5z",
        "sourceName": "기본색",
        "optionName": "기본 정돈 · 전체 옵션표 (1개 옵션)",
        "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg",
        "splitImages": [
            {
                "order": 1,
                "optionName": "기본색",
                "fileName": "01_기본색.png",
                "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg",
                "hasImage": True,
            },
        ],
        "archiveId": "2ad0ef916da3fea2",
        "imageUrl": "/api/local-archive/assets/2ad0ef916da3fea2/image",
        "resultAssetId": "factory_options_mt5xua6t_3xd2mw",
        "hasImage": True,
    }
    row.update(overrides)
    return row


def test_archived_option_image_may_drop_its_inline_copy() -> None:
    # 아카이브에 저장한 뒤 인라인 base64 를 떼어내는 것은 정상 압축이다. 이것을 소실로
    # 세면 옵션 이미지를 실제로 만든 제품은 다음 저장부터 영원히 막힌다.
    existing = _snapshot([_saved_row()])
    incoming = _snapshot([_saved_row(
        image="",
        splitImages=[{"order": 1, "optionName": "기본색", "fileName": "01_기본색.png", "image": "", "hasImage": True}],
    )])

    assert api_archive._last_work_derived_state_drop_reason(existing, incoming) == ""


def test_option_image_without_any_reference_is_still_protected() -> None:
    # 참조도 없이 그림만 사라지면 그건 진짜 소실이다.
    existing = _snapshot([_saved_row()])
    incoming = _snapshot([
        _saved_row(image="", splitImages=[], archiveId="", imageUrl="", resultAssetId=""),
    ])

    reason = api_archive._last_work_derived_state_drop_reason(existing, incoming)
    assert reason.startswith("optionSorter.optionResults.content")
    assert "image" in reason


def test_non_image_fields_are_protected_even_when_archived() -> None:
    # 아카이브 참조가 있다고 해서 옵션 이름까지 지워도 되는 것은 아니다.
    existing = _snapshot([_saved_row()])
    incoming = _snapshot([_saved_row(image="", sourceName="")])

    reason = api_archive._last_work_derived_state_drop_reason(existing, incoming)
    assert "sourceName" in reason


def test_drop_reason_names_the_exact_field() -> None:
    # 이유가 두루뭉술하면 막힌 작업을 사람이 풀 수 없다.
    existing = _snapshot([_saved_row()])
    incoming = _snapshot([_saved_row(image="", archiveId="", imageUrl="", resultAssetId="")])

    reason = api_archive._last_work_derived_state_drop_reason(existing, incoming)
    assert "[or_1787497463758_2q5z]" in reason


def test_split_image_text_is_still_protected() -> None:
    # 잘라 낸 옵션 칸의 이름과 파일명은 그림이 아니므로 사라지면 안 된다.
    existing = _snapshot([_saved_row()])
    incoming = _snapshot([_saved_row(
        splitImages=[{"order": 1, "optionName": "", "fileName": "01_기본색.png", "image": "", "hasImage": True}],
    )])

    reason = api_archive._last_work_derived_state_drop_reason(existing, incoming)
    assert "optionName" in reason
