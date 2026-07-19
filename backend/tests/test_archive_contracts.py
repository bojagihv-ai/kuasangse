from __future__ import annotations

from routes import api_archive


def _complete_identity() -> dict[str, str]:
    return {
        "workspaceId": "workspace-a",
        "productKey": "나비수저집",
        "currentRunId": "run-a",
        "inputImageFingerprint": "image-a",
        "stageId": "hero",
    }


def test_safe_name_removes_windows_invalid_characters_and_uses_fallback() -> None:
    # Given: Windows 파일명에 쓸 수 없는 문자와 빈 문자열을 준비한다.
    # When: 실제 로컬 아카이브 파일명 정리 함수를 호출한다.
    sanitized = api_archive._local_archive_safe_name(' 나비/수저:*?"<>|\n집 ')
    fallback = api_archive._local_archive_safe_name("", "asset")
    # Then: 금지 문자는 밑줄로 정리되고 빈 값은 기본 이름이 되어야 한다.
    assert sanitized == "나비_수저_집"
    assert fallback == "asset"


def test_scope_requires_all_five_identity_fields() -> None:
    # Given: 완전한 작업 식별값과 필드가 하나씩 빠진 식별값을 준비한다.
    identity = _complete_identity()
    # When: 실제 아카이브 범위 완전성 검사를 수행한다.
    missing_results = {
        field: api_archive._local_archive_scope_is_complete({**identity, field: ""})
        for field in identity
    }
    # Then: 다섯 값이 모두 있을 때만 작업파일 폴더에 저장할 수 있어야 한다.
    assert api_archive._local_archive_scope_is_complete(identity) is True
    assert api_archive._local_archive_scope_is_complete(None) is False
    assert missing_results == {field: False for field in identity}


def test_workfile_folder_name_is_stable_and_workspace_specific() -> None:
    # Given: 같은 작업파일 ID 두 번과 다른 작업파일 ID를 준비한다.
    # When: 실제 작업파일 로컬 폴더명 생성 함수를 호출한다.
    first = api_archive._local_archive_workfile_folder_name("project-a")
    repeated = api_archive._local_archive_workfile_folder_name("project-a")
    other = api_archive._local_archive_workfile_folder_name("project-b")
    # Then: 같은 ID는 같은 폴더, 다른 ID는 다른 폴더가 되어야 한다.
    assert first == repeated
    assert first != other
    assert api_archive._local_archive_workfile_folder_name("") == ""


def test_manifest_scope_rejects_any_current_work_identity_mismatch() -> None:
    # Given: 현재 작업 범위와 동일한 아카이브 레코드를 준비한다.
    record = _complete_identity()
    scope = {key: record[key] for key in (
        "workspaceId", "productKey", "currentRunId", "inputImageFingerprint"
    )}
    # When: 정상 범위와 네 핵심 값이 각각 다른 범위를 비교한다.
    mismatched = {
        field: api_archive._local_archive_manifest_matches_scope(
            record,
            {**scope, field: f"different-{field}"},
        )
        for field in scope
    }
    # Then: 네 값 중 하나라도 다르면 현재 작업 복원 대상으로 선택되면 안 된다.
    assert api_archive._local_archive_manifest_matches_scope(record, scope) is True
    assert mismatched == {field: False for field in scope}


def test_data_url_decoder_handles_base64_urlencoded_and_invalid_values() -> None:
    # Given: base64 이미지, URL 인코딩 텍스트, 데이터 URL이 아닌 값을 준비한다.
    # When: 실제 로컬 아카이브 데이터 URL 디코더를 호출한다.
    base64_result = api_archive._local_archive_decode_data_url(
        "data:image/png;base64,aGVsbG8="
    )
    text_result = api_archive._local_archive_decode_data_url(
        "data:text/plain,%ED%95%9C%EA%B8%80"
    )
    invalid_result = api_archive._local_archive_decode_data_url("not-a-data-url")
    # Then: 정상 값은 MIME과 바이트로 풀리고 잘못된 형식은 거부되어야 한다.
    assert base64_result == ("image/png", b"hello")
    assert text_result == ("text/plain", "한글".encode())
    assert invalid_result is None


def test_stage_classifier_maps_every_generated_image_usage() -> None:
    # Given: 조립공장의 대표/사이즈/옵션/이미지컷/섹션/상세 단계명을 준비한다.
    stages = ["hero", "size", "options", "cuts", "section_header", "detail"]
    # When: 실제 로컬 아카이브 용도 분류 함수를 호출한다.
    kinds = [
        api_archive._local_archive_kind_for_stage(stage)["assetKind"]
        for stage in stages
    ]
    # Then: 모든 생성물은 복원 가능한 고유 용도로 분류되어야 한다.
    assert kinds == ["hero", "size", "option", "cut", "section", "detail"]


def test_asset_identity_prefers_explicit_request_scope_and_trims_values() -> None:
    # Given: 자산 내부 값과 요청 본문의 현재 작업 값이 서로 다른 입력을 준비한다.
    asset = {
        "productKey": "old-product",
        "metadata": {"currentRunId": "old-run", "stageId": "size"},
        "sourceMap": {"workspaceId": "old-workspace", "inputImageFingerprint": "old-image"},
    }
    body = {
        "workspaceId": " workspace-a ",
        "productKey": " 나비수저집 ",
        "currentRunId": " run-a ",
        "inputImageFingerprint": " image-a ",
        "stageId": " hero ",
    }
    # When: 실제 저장 범위 식별자 추출 함수를 호출한다.
    identity = api_archive._local_archive_asset_identity(asset, body)
    # Then: 현재 요청의 명시적 범위가 우선되고 공백이 제거되어야 한다.
    assert identity == {**_complete_identity(), "productName": ""}


def test_same_asset_deduplication_requires_every_scope_field() -> None:
    # Given: 동일 내용 해시와 완전한 작업 범위를 가진 저장 레코드를 준비한다.
    identity = _complete_identity()
    record = {**identity, "contentHash": "hash-a"}
    # When: 정상 레코드와 범위가 하나씩 다른 레코드를 중복 검사한다.
    changed = {
        field: api_archive._local_archive_same_asset_record(
            {**record, field: f"different-{field}"},
            identity,
            identity["stageId"],
            "hash-a",
        )
        for field in ("workspaceId", "productKey", "currentRunId", "inputImageFingerprint")
    }
    # Then: 내용과 네 범위 및 단계가 모두 같을 때만 같은 자산이어야 한다.
    assert api_archive._local_archive_same_asset_record(
        record, identity, identity["stageId"], "hash-a"
    ) is True
    assert changed == {field: False for field in changed}
    assert api_archive._local_archive_same_asset_record(
        record, identity, "size", "hash-a"
    ) is False


def test_competitor_archive_reports_missing_mismatched_and_wrong_stage_scope() -> None:
    # Given: 완전한 경쟁사 범위, 필드 누락, 상충 값, 잘못된 단계를 준비한다.
    complete_body = {**_complete_identity(), "stageId": "competitors"}
    complete_identity = api_archive._local_archive_asset_identity({}, complete_body)
    missing_stage = {key: value for key, value in complete_body.items() if key != "stageId"}
    mismatched_asset = {"productKey": "다른상품", "stageId": "competitors"}
    wrong_stage = {**complete_body, "stageId": "hero", "source": "competitor"}
    # When: 실제 경쟁사 아카이브 식별 오류 함수를 호출한다.
    valid_error = api_archive._local_archive_competitor_identity_error(
        {}, complete_body, complete_identity
    )
    missing_error = api_archive._local_archive_competitor_identity_error(
        {}, missing_stage, api_archive._local_archive_asset_identity({}, missing_stage)
    )
    mismatch_error = api_archive._local_archive_competitor_identity_error(
        mismatched_asset,
        complete_body,
        api_archive._local_archive_asset_identity(mismatched_asset, complete_body),
    )
    wrong_stage_error = api_archive._local_archive_competitor_identity_error(
        {}, wrong_stage, api_archive._local_archive_asset_identity({}, wrong_stage)
    )
    # Then: 정상만 통과하고 누락/상충/단계 오류는 구체적인 필드명으로 실패해야 한다.
    assert valid_error == ""
    assert missing_error == "competitor archive identity required: stageId"
    assert mismatch_error == "competitor archive identity mismatch: productKey"
    assert wrong_stage_error == "competitor archive identity mismatch: stageId must be competitors"


def _last_work_snapshot(
    product_key: str,
    active_assets: int,
    *,
    run_id: str = "run-a",
    section_count: int = 15,
) -> dict:
    assets = [
        {
            "id": f"asset-{index}",
            "stageId": "hero",
            "workspaceId": "project-a",
            "productKey": product_key,
            "currentRunId": run_id,
            "inputImageFingerprint": "image-a",
            "rejected": index >= active_assets,
        }
        for index in range(15)
    ]
    return {
        "workspaceId": "project:project-a",
        "assets": {
            "sectionImages": {
                f"section-{index}": f"data:image/png;base64,section-{index}"
                for index in range(section_count)
            },
            "sectionContents": {
                f"section-{index}": {"title": f"section-{index}"}
                for index in range(section_count)
            },
            "factory": {
                "workspace": {"id": "project-a"},
                "product": {
                    "productKey": product_key,
                    "currentRunId": run_id,
                    "inputImageFingerprint": "image-a",
                },
                "assets": assets,
            },
        },
    }


def test_last_work_rejects_product_identity_drift_that_quarantines_current_assets() -> None:
    # Given: 같은 실행과 입력 이미지에서 제품키만 바뀌며 활성 이미지가 15개에서 5개로 줄었다.
    existing = _last_work_snapshot("슬라브나비수저집", 15)
    incoming = _last_work_snapshot("슬라브나비수저집테스트", 5)
    # When: 실제 마지막 작업 저장 보호 판정을 수행한다.
    rejected = api_archive._last_work_has_destructive_identity_drift(existing, incoming)
    # Then: Cafe24 등록명이 작업 식별자로 번져 이미지를 격리한 저장은 거부해야 한다.
    assert rejected is True


def test_last_work_rejects_identity_drift_that_drops_section_images() -> None:
    # Given: 같은 실행과 입력 이미지에서 제품키가 바뀌고 섹션 이미지가 15개에서 1개로 줄었다.
    existing = _last_work_snapshot("슬라브나비수저집", 15, section_count=15)
    incoming = _last_work_snapshot("슬라브나비수저집테스트", 15, section_count=1)
    # When: 실제 마지막 작업 저장 보호 판정을 수행한다.
    rejected = api_archive._last_work_has_destructive_identity_drift(existing, incoming)
    # Then: 공장 자산 수가 같아도 섹션을 잃은 저장은 거부해야 한다.
    assert rejected is True


def test_last_work_rejects_same_identity_save_that_drops_sections() -> None:
    # Given: 같은 작업 기준을 유지하지만 섹션 이미지와 콘텐츠만 15개에서 1개로 줄었다.
    existing = _last_work_snapshot("슬라브나비수저집", 15, section_count=15)
    incoming = _last_work_snapshot("슬라브나비수저집", 15, section_count=1)
    # When: 실제 마지막 작업 저장 보호 판정을 수행한다.
    rejected = api_archive._last_work_has_destructive_identity_drift(existing, incoming)
    # Then: 제품키가 같더라도 섹션 손실 저장은 거부해야 한다.
    assert rejected is True


def test_last_work_rejects_incomplete_bootstrap_save_over_completed_work() -> None:
    # Given: 15개 섹션이 있는 현재 작업 위로 초기 부팅 중인 빈 상태가 저장을 시도한다.
    existing = _last_work_snapshot("슬라브나비수저집", 15, section_count=15)
    incoming = _last_work_snapshot("", 0, section_count=0)
    incoming["assets"]["factory"]["product"] = {}
    # When: 실제 마지막 작업 저장 보호 판정을 수행한다.
    rejected = api_archive._last_work_has_destructive_identity_drift(existing, incoming)
    # Then: 제품 기준이 아직 복원되지 않은 빈 부팅 상태는 완성 작업을 덮어쓸 수 없어야 한다.
    assert rejected is True


def test_last_work_allows_new_run_or_non_destructive_same_identity_save() -> None:
    # Given: 제품 기준이 같은 정상 저장과 명시적으로 새로 시작한 다른 실행을 준비한다.
    existing = _last_work_snapshot("슬라브나비수저집", 15)
    same_identity = _last_work_snapshot("슬라브나비수저집", 15)
    new_run = _last_work_snapshot("다른제품", 0, run_id="run-b")
    # When: 실제 마지막 작업 저장 보호 판정을 수행한다.
    same_identity_rejected = api_archive._last_work_has_destructive_identity_drift(existing, same_identity)
    new_run_rejected = api_archive._last_work_has_destructive_identity_drift(existing, new_run)
    # Then: 정상 자동저장과 새 작업 실행은 막지 않아야 한다.
    assert same_identity_rejected is False
    assert new_run_rejected is False
