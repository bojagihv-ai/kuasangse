from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

from .workfile_report import _items, _number, _record, _text, _timestamp, build_workfile_report
from .workfile_report_models import (
    JsonObject,
    PublicationReceipt,
    ReportCollectionResult,
    WorkfileReport,
)


def render_workfile_report_markdown(report: WorkfileReport) -> str:
    stopped = f"{report.stopped_at_stage_number}단계 {report.stopped_at_stage_label}에서 멈춤"
    lines = [
        f"# {report.workfile_name} 결과 리포트",
        "",
        f"- 상태: {report.status_label}",
        f"- 제품명: {report.product_name or '(미입력)'}",
        f"- 조립공장: {stopped if report.status_code != 'cafe24_registered' else '7단계 전송/저장 완료'}",
        f"- 마지막 완료 단계: {report.last_completed_stage_number}단계 {report.last_completed_stage_label}",
        f"- 생성 섹션: {report.section_count}개",
        f"- 원본 작업파일: `{report.workfile_path}`",
    ]
    if report.cafe24 is not None:
        cafe24 = report.cafe24
        relation = "등록 완료" if report.status_code == "cafe24_registered" else "선택/참조"
        lines.extend([
            "",
            "## Cafe24",
            "",
            f"- 관계: {relation}",
            f"- 상품번호: #{cafe24.product_no}",
            f"- Cafe24 상품명: {cafe24.product_name or '(확인 필요)'}",
            f"- 등록에 사용한 작업파일: `{cafe24.source_workfile_name}`",
            f"- 후속 보정 작업파일: {', '.join(cafe24.continuation_workfile_names) or '없음'}",
            f"- 옵션: {cafe24.option_group_count}그룹 / {cafe24.option_value_count}값 / {cafe24.variant_count}품목",
            f"- 진열/판매: {cafe24.display or '-'} / {cafe24.selling or '-'}",
            f"- [Cafe24 관리자 상품 화면]({cafe24.admin_url})",
            f"- [Cafe24 상품 링크]({cafe24.storefront_url})",
        ])
    return "\n".join(lines) + "\n"


def collect_workfile_reports(
    source_paths: Sequence[Path],
    *,
    receipts: Mapping[str, PublicationReceipt] | None = None,
) -> tuple[WorkfileReport, ...]:
    workfiles = sorted({
        file.resolve()
        for source in source_paths
        for file in (source.glob("*.kuasangse") if source.is_dir() else [source])
        if file.is_file()
    }, key=lambda item: item.stat().st_mtime, reverse=True)
    return tuple(build_workfile_report(path, receipts=receipts) for path in workfiles)


def generate_report_collection(
    source_paths: Sequence[Path],
    output_dir: Path,
    *,
    receipts: Mapping[str, PublicationReceipt] | None = None,
) -> ReportCollectionResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    reports = collect_workfile_reports(source_paths, receipts=receipts)
    written: list[str] = []
    for report in reports:
        stem = Path(report.workfile_name).stem
        json_path = output_dir / f"{stem}.result.json"
        markdown_path = output_dir / f"{stem}.result.md"
        json_path.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2), encoding="utf-8")
        markdown_path.write_text(render_workfile_report_markdown(report), encoding="utf-8")
        written.extend((str(json_path), str(markdown_path)))
    index_lines = [
        "# 상세페이지 작업파일 결과 리포트",
        "",
        "| 작업파일 | 상태 | 조립공장 | Cafe24 |",
        "|---|---|---|---|",
    ]
    for report in reports:
        cafe24 = "-"
        if report.cafe24:
            relation = "등록" if report.status_code == "cafe24_registered" else "참조"
            cafe24 = f"{relation} #{report.cafe24.product_no}"
        index_lines.append(
            f"| [{report.workfile_name}]({Path(report.workfile_name).stem}.result.md) "
            f"| {report.status_label} | {report.stopped_at_stage_number}단계 "
            f"{report.stopped_at_stage_label} | {cafe24} |",
        )
    index_path = output_dir / "README.md"
    index_path.write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    written.append(str(index_path))
    return ReportCollectionResult(len(reports), str(output_dir), tuple(written))


def load_publication_receipts(path: Path) -> dict[str, PublicationReceipt]:
    with path.open("r", encoding="utf-8") as handle:
        root: JsonObject = json.load(handle)
    result: dict[str, PublicationReceipt] = {}
    for product_no, raw_value in root.items():
        raw = _record(raw_value)
        result[product_no] = PublicationReceipt(
            product_no=product_no,
            product_name=_text(raw.get("product_name")),
            mall_id=_text(raw.get("mall_id")) or "bojagi1928",
            source_workfile_name=_text(raw.get("source_workfile_name")),
            registered_at=_timestamp(raw.get("registered_at")),
            option_group_count=_number(raw.get("option_group_count")),
            option_value_count=_number(raw.get("option_value_count")),
            variant_count=_number(raw.get("variant_count")),
            display=_text(raw.get("display")) or "F",
            selling=_text(raw.get("selling")) or "F",
            product_code=_text(raw.get("product_code")),
            registration_mode=_text(raw.get("registration_mode")),
            continuation_workfile_names=tuple(
                _text(item) for item in _items(raw.get("continuation_workfile_names"))
            ),
        )
    return result


def main() -> int:
    documents = Path(os.environ.get("KUASANGSE_REPORT_SOURCE", Path.home() / "Documents"))
    output = Path(
        os.environ.get(
            "KUASANGSE_REPORT_OUTPUT",
            Path.home() / "Documents" / "상세페이지 작업 리포트",
        ),
    )
    receipt_path = Path(
        os.environ.get(
            "KUASANGSE_REPORT_RECEIPTS",
            Path(__file__).parents[2] / "output" / "workfile-reports" / "publication-receipts.json",
        ),
    )
    receipts = load_publication_receipts(receipt_path) if receipt_path.is_file() else {}
    result = generate_report_collection([documents], output, receipts=receipts)
    print(json.dumps(asdict(result), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
