from __future__ import annotations

import base64
import json
from pathlib import Path

from services.local_asset_library import (
    LIBRARY_FOLDER_NAMES,
    LibraryBuildRequest,
    LibraryIdentity,
    build_workfile_library,
)


def _data_url(payload: bytes, mime: str = "image/png") -> str:
    encoded = base64.b64encode(payload).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def test_workfile_library_materializes_inputs_candidates_outputs_and_selections(
    tmp_path: Path,
) -> None:
    # Given: 현재 작업 스냅샷과 과거 draft에 남은 생성 이미지 원본을 준비한다.
    canonical_image = tmp_path / "canonical" / "hero.png"
    canonical_image.parent.mkdir(parents=True)
    canonical_image.write_bytes(b"canonical-hero")
    identity = LibraryIdentity(
        workspace_id="project-a",
        product_name="모시바둑파우치",
        product_key="모시바둑파우치",
        input_image_fingerprint="image-a",
    )
    snapshot = {
        "assets": {
            "currentProjectId": "project-a",
            "productName": "모시바둑파우치",
            "sectionWorkScope": {
                "productKey": "모시바둑파우치",
                "inputImageFingerprint": "image-a",
            },
            "sectionImages": {"header": _data_url(b"section-header")},
            "optionSorter": {
                "images": [{"id": "color-input", "name": "색상 원본", "base64": _data_url(b"color-input")}],
                "optionResults": [{"id": "option-a", "title": "색상컷", "image": _data_url(b"option-output")}],
            },
            "competitors": {
                "compPage": {
                    "marketScrape": {
                        "results": [
                            {"id": "comp-a", "title": "경쟁사 A", "image": _data_url(b"competitor-a")},
                        ],
                        "selectedIds": ["comp-a"],
                        "scrapedImages": [
                            {
                                "id": "detail-a",
                                "candidateId": "comp-a",
                                "title": "경쟁사 상세 A",
                                "src": _data_url(b"competitor-detail-a"),
                            },
                        ],
                        "selectedImageIds": ["detail-a"],
                    },
                },
            },
            "factory": {
                "product": {
                    "productName": "모시바둑파우치",
                    "productKey": "모시바둑파우치",
                    "inputImageFingerprint": "image-a",
                    "inputImages": [
                        {"id": "main-input", "name": "기본 이미지", "base64": _data_url(b"main-input")},
                    ],
                    "cafe24Candidates": [
                        {
                            "product_no": "24",
                            "product_name": "Cafe24 후보",
                            "image": _data_url(b"cafe24-a"),
                        },
                    ],
                    "selectedCafe24CandidateKey": "24",
                    "dbCandidates": [
                        {"jcode": "db-a", "product_name": "신화사 후보", "image": _data_url(b"db-a")},
                    ],
                    "selectedDbCandidateKey": "db-a",
                },
            },
        },
    }
    archive_records = (
        {
            "archiveId": "hero-old",
            "workspaceId": "draft:last-work",
            "productKey": "모시바둑파우치",
            "inputImageFingerprint": "image-a",
            "stageId": "hero",
            "title": "과거 대표 이미지",
            "files": {"imagePath": str(canonical_image), "imageMime": "image/png"},
        },
    )

    # When: 작업파일별 로컬 자료함을 두 번 같은 입력으로 정리한다.
    request = LibraryBuildRequest(
        archive_root=tmp_path / "local-archive",
        identity=identity,
        snapshot=snapshot,
        archive_records=archive_records,
    )
    first = build_workfile_library(request)
    stale_copy = first.root / "09_OUTPUT_대표이미지" / "stale-copy.png"
    stale_copy.write_bytes(b"stale")
    second = build_workfile_library(request)

    # Then: 14개 고정 폴더에 입력/후보/선택/생성물이 나뉘고 재실행해도 중복되지 않는다.
    assert {path.name for path in first.root.iterdir() if path.is_dir()} == set(LIBRARY_FOLDER_NAMES)
    assert first.category_counts["01_INPUT_기본이미지"] == 1
    assert first.category_counts["02_INPUT_색상옵션"] == 1
    assert first.category_counts["03_OUTPUT_경쟁사후보"] >= 2
    assert first.category_counts["04_OUTPUT_경쟁사선택"] >= 2
    assert first.category_counts["05_OUTPUT_Cafe24후보"] == 1
    assert first.category_counts["06_OUTPUT_Cafe24선택"] == 1
    assert first.category_counts["07_OUTPUT_신화사DB후보"] == 1
    assert first.category_counts["08_OUTPUT_신화사DB선택"] == 1
    assert first.category_counts["09_OUTPUT_대표이미지"] == 1
    assert first.category_counts["12_OUTPUT_색상옵션컷"] == 1
    assert first.category_counts["13_OUTPUT_섹션이미지"] == 1
    assert first.category_counts["14_OUTPUT_최종선택"] >= 4
    assert second.category_counts == first.category_counts
    assert second.file_count == first.file_count
    assert not stale_copy.exists()
    assert canonical_image.read_bytes() == b"canonical-hero"
    assert (first.root / "manifest.json").is_file()
    assert (first.root / "README.txt").is_file()


def test_workfile_library_downloads_remote_candidate_through_injected_fetcher(
    tmp_path: Path,
) -> None:
    # Given: 이미지 URL만 있는 Cafe24 후보와 테스트용 다운로드 함수를 준비한다.
    fetched: list[str] = []

    def fetch_image(url: str) -> tuple[str, bytes] | None:
        fetched.append(url)
        return "image/jpeg", b"remote-candidate"

    request = LibraryBuildRequest(
        archive_root=tmp_path / "local-archive",
        identity=LibraryIdentity(
            workspace_id="project-b",
            product_name="방울수저집",
            product_key="방울수저집",
            input_image_fingerprint="image-b",
        ),
        snapshot={
            "assets": {
                "factory": {
                    "product": {
                        "cafe24Candidates": [
                            {
                                "product_no": "2994",
                                "product_name": "방울수저집",
                                "image": "https://example.test/cafe24.jpg",
                            },
                        ],
                    },
                },
            },
        },
        archive_records=(),
        fetch_image=fetch_image,
    )

    # When: URL 후보까지 포함해 자료함을 정리한다.
    result = build_workfile_library(request)
    repeated = build_workfile_library(request)

    # Then: URL은 한 번만 내려받아 Cafe24 후보 폴더의 실제 파일로 남아야 한다.
    assert fetched == ["https://example.test/cafe24.jpg"]
    assert result.category_counts["05_OUTPUT_Cafe24후보"] == 1
    assert repeated.category_counts == result.category_counts
    candidate_files = list((result.root / "05_OUTPUT_Cafe24후보").glob("*.jpg"))
    assert len(candidate_files) == 1
    assert candidate_files[0].read_bytes() == b"remote-candidate"


def test_workfile_library_recovers_legacy_assets_beyond_archive_index(
    tmp_path: Path,
) -> None:
    # Given: 목록 API의 상한 밖에 있는 과거 draft 섹션 이미지를 정규 보관소에 준비한다.
    archive_root = tmp_path / "local-archive"
    asset_dir = (
        archive_root
        / "workfiles"
        / "draft_last-work__hash"
        / "assets"
        / "모시바둑파우치"
        / "factory_work_run"
        / "fingerprint"
        / "section-images"
        / "section_header"
        / "archived"
    )
    asset_dir.mkdir(parents=True)
    archived_image = asset_dir / "image.png"
    archived_image.write_bytes(b"archived-section")
    (asset_dir / "metadata.json").write_text(
        json.dumps(
            {
                "identity": {
                    "workspaceId": "draft:last-work",
                    "productName": "모시바둑파우치",
                    "productKey": "모시바둑파우치",
                    "inputImageFingerprint": "image-a",
                },
                "stageId": "section_header",
                "category": "section-images",
                "title": "과거 헤더",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    request = LibraryBuildRequest(
        archive_root=archive_root,
        identity=LibraryIdentity(
            workspace_id="project-a",
            product_name="모시바둑파우치",
            product_key="모시바둑파우치",
            input_image_fingerprint="image-a",
        ),
        snapshot={
            "assets": {
                "sectionImages": {
                    "header": _data_url(b"archived-section"),
                },
            },
        },
        archive_records=(),
    )

    # When: 인덱스 레코드 없이 작업파일별 자료함을 정리한다.
    result = build_workfile_library(request)

    # Then: 정규 보관소를 직접 복구해 섹션 및 최종선택 폴더에 함께 남겨야 한다.
    assert result.category_counts["13_OUTPUT_섹션이미지"] == 1
    assert result.category_counts["14_OUTPUT_최종선택"] == 1
    assert archived_image.read_bytes() == b"archived-section"
