from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

JsonValue: TypeAlias = (
    str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
)
JsonObject: TypeAlias = dict[str, JsonValue]


@dataclass(frozen=True, slots=True)
class PublicationReceipt:
    product_no: str
    product_name: str
    mall_id: str
    source_workfile_name: str
    registered_at: int
    option_group_count: int = 0
    option_value_count: int = 0
    variant_count: int = 0
    display: str = "F"
    selling: str = "F"
    product_code: str = ""
    registration_mode: str = ""
    continuation_workfile_names: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Cafe24Result:
    product_no: str
    product_code: str
    product_name: str
    workfile_product_name: str
    mall_id: str
    source_workfile_name: str
    continuation_workfile_names: tuple[str, ...]
    registered_at: int
    display: str
    selling: str
    registration_mode: str
    option_group_count: int
    option_value_count: int
    variant_count: int
    admin_url: str
    storefront_url: str
    final_status: str


@dataclass(frozen=True, slots=True)
class WorkfileReport:
    schema: str
    version: int
    generated_at: int
    workfile_path: str
    workfile_name: str
    project_id: str
    project_name: str
    product_name: str
    exported_at: int
    status_code: str
    status_label: str
    last_completed_stage_number: int
    last_completed_stage_label: str
    stopped_at_stage_number: int
    stopped_at_stage_label: str
    active_tab: str
    section_count: int
    cafe24: Cafe24Result | None


@dataclass(frozen=True, slots=True)
class ReportCollectionResult:
    report_count: int
    output_dir: str
    report_files: tuple[str, ...]
