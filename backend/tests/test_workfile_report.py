from __future__ import annotations

import json
from pathlib import Path

from services.workfile_report import build_workfile_report
from services.workfile_report_models import PublicationReceipt
from services.workfile_report_output import (
    generate_report_collection,
    render_workfile_report_markdown,
)


def _write_workfile(path: Path, *, registered: bool) -> None:
    status = "최종 등록 완료: Cafe24까지만 처리했습니다." if registered else ""
    product_no = 2996 if registered else ""
    path.write_text(
        json.dumps(
            {
                "format": "kuasangse-project",
                "exportedAt": 100,
                "project": {
                    "id": "project-test",
                    "name": path.stem,
                    "payload": {
                        "step": "factory",
                        "factory": {
                            "activeStage": "size",
                            "stages": {
                                "db": {"status": "done"},
                                "hero": {"status": "done"},
                                "size": {"status": "idle"},
                            },
                            "automation": {"activeTab": "fields"},
                            "openMarketSync": {
                                "finalRegistrationStatus": status,
                                "finalRegistrationUpdatedAt": 200,
                            },
                            "product": {
                                "productName": "모시바둑파우치",
                                "finalDb": {
                                    "product_no": product_no,
                                    "product_code": "P0000ELG" if registered else "",
                                },
                            },
                        },
                    },
                },
                "summary": {"sections": 3},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_build_workfile_report_uses_verified_publication_receipt(tmp_path: Path) -> None:
    workfile = tmp_path / "등록원본.kuasangse"
    _write_workfile(workfile, registered=True)
    receipt = PublicationReceipt(
        product_no="2996",
        product_name="모시바둑파우치",
        mall_id="bojagi1928",
        source_workfile_name=workfile.name,
        registered_at=200,
        option_group_count=1,
        option_value_count=14,
        variant_count=14,
        display="F",
        selling="F",
    )

    report = build_workfile_report(workfile, receipts={"2996": receipt})

    assert report.status_code == "cafe24_registered"
    assert report.cafe24 is not None
    assert report.cafe24.product_no == "2996"
    assert report.cafe24.option_value_count == 14
    assert report.cafe24.source_workfile_name == workfile.name
    assert report.cafe24.admin_url.endswith("product_no=2996")


def test_render_workfile_report_names_partial_factory_stage(tmp_path: Path) -> None:
    workfile = tmp_path / "부분작업.kuasangse"
    _write_workfile(workfile, registered=False)

    report = build_workfile_report(workfile)
    markdown = render_workfile_report_markdown(report)

    assert report.status_code == "factory_in_progress"
    assert report.last_completed_stage_number == 2
    assert report.stopped_at_stage_number == 3
    assert "3단계 필수값에서 멈춤" in markdown


def test_generate_report_collection_writes_flat_index_and_sidecars(tmp_path: Path) -> None:
    source = tmp_path / "workfiles"
    output = tmp_path / "reports"
    source.mkdir()
    _write_workfile(source / "첫작업.kuasangse", registered=False)
    _write_workfile(source / "등록작업.kuasangse", registered=True)

    result = generate_report_collection([source], output)

    assert result.report_count == 2
    assert (output / "README.md").is_file()
    assert (output / "첫작업.result.json").is_file()
    assert (output / "첫작업.result.md").is_file()
    assert (output / "등록작업.result.json").is_file()


def test_build_workfile_report_accepts_iso_export_timestamp(tmp_path: Path) -> None:
    workfile = tmp_path / "구형시간형식.kuasangse"
    _write_workfile(workfile, registered=False)
    payload = json.loads(workfile.read_text(encoding="utf-8"))
    payload["exportedAt"] = "2026-07-26T12:50:17.798Z"
    workfile.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    report = build_workfile_report(workfile)

    assert report.exported_at == 1785070217798
