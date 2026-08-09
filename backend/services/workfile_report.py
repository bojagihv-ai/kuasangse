from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Mapping

from .workfile_report_models import (
    Cafe24Result,
    JsonObject,
    JsonValue,
    PublicationReceipt,
    WorkfileReport,
)

STAGES = (
    (1, "시작"),
    (2, "DB 확정"),
    (3, "필수값"),
    (4, "경쟁사"),
    (5, "생성컷 선택"),
    (6, "섹션 생성"),
    (7, "전송/저장"),
)
TAB_STAGE = {
    "start": 1,
    "db": 2,
    "fields": 3,
    "competitor": 4,
    "competitors": 4,
    "assets": 5,
    "hero": 5,
    "size": 5,
    "options": 5,
    "cuts": 5,
    "sections": 6,
    "detail": 6,
    "publish": 7,
    "send": 7,
    "export": 7,
}

def _record(value: JsonValue | None) -> JsonObject:
    return value if isinstance(value, dict) else {}


def _items(value: JsonValue | None) -> list[JsonValue]:
    return value if isinstance(value, list) else []


def _text(value: JsonValue | None) -> str:
    return str(value if value is not None else "").strip()


def _number(value: JsonValue | None) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float):
        return int(value)
    text = _text(value)
    return int(float(text)) if text else 0


def _timestamp(value: JsonValue | None) -> int:
    try:
        return _number(value)
    except ValueError:
        parsed = datetime.fromisoformat(_text(value).replace("Z", "+00:00"))
        return int(parsed.timestamp() * 1000)


def _stage(number: int) -> tuple[int, str]:
    return next((stage for stage in STAGES if stage[0] == number), STAGES[0])


def _local_progress(
    payload: JsonObject,
    factory: JsonObject,
    product: JsonObject,
    summary: JsonObject,
) -> tuple[int, int]:
    stages = _record(factory.get("stages"))
    automation = _record(factory.get("automation"))
    parallel = _record(automation.get("parallelProgress"))
    product_name = _text(
        product.get("userProductName")
        or product.get("productName")
        or payload.get("productName"),
    )
    last_completed = 1 if product_name or payload.get("imagePreview") else 0
    if _text(_record(stages.get("db")).get("status")) == "done":
        last_completed = max(last_completed, 2)
    if len(_record(product.get("finalDb"))) >= 4:
        last_completed = max(last_completed, 3)
    if _text(_record(parallel.get("vm")).get("status")) == "done":
        last_completed = max(last_completed, 4)
    if all(
        _text(_record(stages.get(key)).get("status")) == "done"
        for key in ("hero", "size", "options", "cuts")
    ):
        last_completed = max(last_completed, 5)
    if _text(_record(stages.get("detail")).get("status")) == "done":
        last_completed = max(last_completed, 6)
    active_tab = _text(automation.get("activeTab") or factory.get("activeStage")).lower()
    active_stage = TAB_STAGE.get(active_tab, 1)
    return max(last_completed, active_stage - 1), active_stage


def _receipt_from_embedded(product: JsonObject) -> PublicationReceipt | None:
    value = _record(product.get("cafe24PublicationReceipt"))
    product_no = _text(value.get("productNo"))
    if not product_no:
        return None
    continuations = tuple(_text(item) for item in _items(value.get("continuationWorkfileNames")))
    return PublicationReceipt(
        product_no=product_no,
        product_name=_text(value.get("productName")),
        mall_id=_text(value.get("mallId")) or "bojagi1928",
        source_workfile_name=_text(value.get("sourceWorkfileName")),
        registered_at=_timestamp(value.get("registeredAt")),
        option_group_count=_number(value.get("optionGroupCount")),
        option_value_count=_number(value.get("optionValueCount")),
        variant_count=_number(value.get("variantCount")),
        display=_text(value.get("display")) or "F",
        selling=_text(value.get("selling")) or "F",
        product_code=_text(value.get("productCode")),
        registration_mode=_text(value.get("registrationMode")),
        continuation_workfile_names=continuations,
    )


def build_workfile_report(
    path: Path,
    *,
    receipts: Mapping[str, PublicationReceipt] | None = None,
) -> WorkfileReport:
    with path.open("r", encoding="utf-8") as handle:
        root: JsonObject = json.load(handle)
    project = _record(root.get("project"))
    payload = _record(project.get("payload") or root.get("payload"))
    factory = _record(payload.get("factory"))
    product = _record(factory.get("product"))
    final_db = _record(product.get("finalDb"))
    sync = _record(factory.get("openMarketSync"))
    summary = _record(root.get("summary"))
    product_no = _text(final_db.get("product_no") or final_db.get("cafe24_product_no"))
    receipt = (receipts or {}).get(product_no) or _receipt_from_embedded(product)
    final_status = _text(sync.get("finalRegistrationStatus") or product.get("cafe24ApiStatus"))
    registered = bool(
        product_no
        and (receipt is not None or any(token in final_status for token in ("최종 등록 완료", "새 상품 등록 완료")))
    )
    failed = "실패" in final_status
    last_completed, active_stage = _local_progress(payload, factory, product, summary)
    if registered:
        last_completed = 7
    stopped_at = 7 if registered else max(active_stage, min(7, max(1, last_completed + 1)))
    status_code = (
        "cafe24_registered"
        if registered
        else "failed"
        if failed
        else "factory_in_progress"
        if last_completed > 0
        else "not_started"
    )
    status_labels = {
        "cafe24_registered": "Cafe24 등록 완료",
        "failed": "실패 후 중단",
        "factory_in_progress": "조립공장 진행 중",
        "not_started": "작업 시작 전",
    }
    product_name = _text(
        product.get("userProductName")
        or product.get("productName")
        or payload.get("productName"),
    )
    cafe24 = None
    if product_no:
        mall_id = receipt.mall_id if receipt else "bojagi1928"
        groups = _items(product.get("cafe24OptionGroupsDraft"))
        option_values = sum(
            len(_items(_record(group).get("values") or _record(group).get("option_value")))
            for group in groups
        )
        cafe24 = Cafe24Result(
            product_no=product_no,
            product_code=(receipt.product_code if receipt else "") or _text(final_db.get("product_code")),
            product_name=(receipt.product_name if receipt else "")
            or _text(final_db.get("cafe24_product_name") or final_db.get("product_name")),
            workfile_product_name=product_name,
            mall_id=mall_id,
            source_workfile_name=(receipt.source_workfile_name if receipt else "") or path.name,
            continuation_workfile_names=receipt.continuation_workfile_names if receipt else (),
            registered_at=receipt.registered_at if receipt else _timestamp(sync.get("finalRegistrationUpdatedAt")),
            display=(receipt.display if receipt else "") or _text(final_db.get("display_status")),
            selling=(receipt.selling if receipt else "") or _text(final_db.get("selling_status")),
            registration_mode=(receipt.registration_mode if receipt else "")
            or _text(sync.get("cafe24RegistrationMode")),
            option_group_count=receipt.option_group_count if receipt else len(groups),
            option_value_count=receipt.option_value_count if receipt else option_values,
            variant_count=receipt.variant_count if receipt else len(_items(product.get("cafe24Variants"))),
            admin_url=f"https://{mall_id}.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no={product_no}",
            storefront_url=f"https://{mall_id}.cafe24.com/product/detail.html?product_no={product_no}",
            final_status=final_status,
        )
    last_stage = _stage(last_completed)
    stopped_stage = _stage(stopped_at)
    return WorkfileReport(
        schema="kuasangse.workfile-result-report",
        version=1,
        generated_at=int(datetime.now().timestamp() * 1000),
        workfile_path=str(path.resolve()),
        workfile_name=path.name,
        project_id=_text(project.get("id") or root.get("currentProjectId")),
        project_name=_text(project.get("name") or payload.get("currentProjectName") or path.stem),
        product_name=product_name,
        exported_at=_timestamp(root.get("exportedAt")),
        status_code=status_code,
        status_label=status_labels[status_code],
        last_completed_stage_number=last_stage[0],
        last_completed_stage_label=last_stage[1],
        stopped_at_stage_number=stopped_stage[0],
        stopped_at_stage_label=stopped_stage[1],
        active_tab=_text(_record(factory.get("automation")).get("activeTab")),
        section_count=_number(summary.get("sections")),
        cafe24=cafe24,
    )
