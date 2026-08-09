from __future__ import annotations

import json
from pathlib import Path

from flask import Flask

from routes import api_workfile_reports
from routes.api_shared import api

from test_workfile_report import _write_workfile


def _client():
    app = Flask(__name__)
    app.register_blueprint(api, url_prefix="/api")
    return app.test_client()


def test_workfile_report_api_lists_registered_and_partial_work(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "workfiles"
    output = tmp_path / "reports"
    receipts = tmp_path / "publication-receipts.json"
    source.mkdir()
    registered = source / "등록원본.kuasangse"
    partial = source / "부분작업.kuasangse"
    _write_workfile(registered, registered=True)
    _write_workfile(partial, registered=False)
    receipts.write_text(
        json.dumps(
            {
                "2996": {
                    "product_name": "모시바둑파우치찐",
                    "mall_id": "bojagi1928",
                    "source_workfile_name": registered.name,
                    "registered_at": 200,
                    "option_group_count": 1,
                    "option_value_count": 14,
                    "variant_count": 14,
                    "display": "F",
                    "selling": "F",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("KUASANGSE_REPORT_SOURCE", str(source))
    monkeypatch.setenv("KUASANGSE_REPORT_OUTPUT", str(output))
    monkeypatch.setenv("KUASANGSE_REPORT_RECEIPTS", str(receipts))

    response = _client().get("/api/workfile-reports")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["count"] == 2
    assert payload["registeredCount"] == 1
    assert payload["inProgressCount"] == 1
    assert Path(payload["outputDir"]) == output
    assert not output.exists()
    registered_report = next(
        report for report in payload["reports"]
        if report["status_code"] == "cafe24_registered"
    )
    partial_report = next(
        report for report in payload["reports"]
        if report["status_code"] == "factory_in_progress"
    )
    assert registered_report["cafe24"]["product_no"] == "2996"
    assert registered_report["cafe24"]["option_value_count"] == 14
    assert partial_report["stopped_at_stage_number"] == 3
    assert partial_report["stopped_at_stage_label"] == "필수값"


def test_workfile_report_api_opens_only_configured_report_folder(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "workfiles"
    output = tmp_path / "reports"
    opened: list[Path] = []
    source.mkdir()
    _write_workfile(source / "부분작업.kuasangse", registered=False)
    monkeypatch.setenv("KUASANGSE_REPORT_SOURCE", str(source))
    monkeypatch.setenv("KUASANGSE_REPORT_OUTPUT", str(output))
    monkeypatch.setattr(
        api_workfile_reports,
        "_open_report_folder",
        lambda path: opened.append(path),
    )

    response = _client().post("/api/workfile-reports/folder/open")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload == {"ok": True, "outputDir": str(output)}
    assert opened == [output]
    assert (output / "README.md").is_file()
