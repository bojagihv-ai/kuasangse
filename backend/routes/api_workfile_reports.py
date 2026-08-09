from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from flask import jsonify

from routes.api_shared import _local_action_request_allowed, api
from services.workfile_report_output import (
    collect_workfile_reports,
    generate_report_collection,
    load_publication_receipts,
)


def _source_path() -> Path:
    return Path(os.environ.get("KUASANGSE_REPORT_SOURCE", Path.home() / "Documents"))


def _output_path() -> Path:
    return Path(
        os.environ.get(
            "KUASANGSE_REPORT_OUTPUT",
            Path.home() / "Documents" / "상세페이지 작업 리포트",
        ),
    )


def _receipt_path() -> Path:
    return Path(
        os.environ.get(
            "KUASANGSE_REPORT_RECEIPTS",
            Path(__file__).parents[2]
            / "output"
            / "workfile-reports"
            / "publication-receipts.json",
        ),
    )


def _open_report_folder(path: Path) -> None:
    getattr(os, "startfile")(str(path))


@api.route("/workfile-reports", methods=["GET"])
def get_workfile_reports():
    source = _source_path()
    output = _output_path()
    receipt_path = _receipt_path()
    receipts = load_publication_receipts(receipt_path) if receipt_path.is_file() else {}
    reports = collect_workfile_reports([source], receipts=receipts)
    registered_count = sum(
        report.status_code == "cafe24_registered" for report in reports
    )
    return jsonify({
        "ok": True,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "outputDir": str(output),
        "count": len(reports),
        "registeredCount": registered_count,
        "inProgressCount": len(reports) - registered_count,
        "reports": [asdict(report) for report in reports],
    })


@api.route("/workfile-reports/folder/open", methods=["POST"])
def open_workfile_report_folder():
    if not _local_action_request_allowed():
        return jsonify({"ok": False, "error": "LOCAL_ACTION_ORIGIN_REQUIRED"}), 403
    output = _output_path()
    receipt_path = _receipt_path()
    receipts = load_publication_receipts(receipt_path) if receipt_path.is_file() else {}
    try:
        generate_report_collection([_source_path()], output, receipts=receipts)
        _open_report_folder(output)
    except OSError as error:
        return jsonify({"ok": False, "error": str(error)}), 500
    return jsonify({"ok": True, "outputDir": str(output)})
