from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias


JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]

_IMAGE_KEYS = (
    "base64", "dataUrl", "data_url", "imageBase64", "imagePreview", "image",
    "imageUrl", "image_url", "src", "preview", "thumbnail", "thumbnailUrl",
    "small_image", "list_image", "tiny_image", "big_image",
)
_TITLE_KEYS = ("title", "label", "name", "product_name", "productName", "site")
_ID_KEYS = ("id", "candidateId", "key", "product_no", "jcode", "imageId")


@dataclass(frozen=True, slots=True)
class LibraryIdentity:
    workspace_id: str
    product_name: str
    product_key: str
    input_image_fingerprint: str


@dataclass(frozen=True, slots=True)
class ImageSource:
    category: str
    title: str
    value: str
    source: str


def json_object(value: JsonValue | None) -> JsonObject:
    return value if isinstance(value, dict) else {}


def json_array(value: JsonValue | None) -> list[JsonValue]:
    return value if isinstance(value, list) else []


def json_text(value: JsonValue | None) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_text(item: JsonObject, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = json_text(item.get(key))
        if value:
            return value
    raw = json_object(item.get("raw"))
    for key in keys:
        value = json_text(raw.get(key))
        if value:
            return value
    return ""


def _image_value(item: JsonObject) -> str:
    value = _first_text(item, _IMAGE_KEYS)
    if value:
        return value
    return _first_text(json_object(item.get("images")), _IMAGE_KEYS)


def _identity_value(item: JsonObject) -> str:
    return _first_text(item, _ID_KEYS)


def _title(item: JsonObject, fallback: str) -> str:
    return _first_text(item, _TITLE_KEYS) or fallback


def _source(
    category: str,
    title: str,
    item: JsonObject,
    origin: str,
) -> ImageSource | None:
    value = _image_value(item)
    return ImageSource(category, title, value, origin) if value else None


def _selected_values(container: JsonObject) -> set[str]:
    selected: set[str] = set()
    for key in ("selectedIds", "selectedImageIds"):
        selected.update(json_text(value) for value in json_array(container.get(key)))
    for value in json_array(container.get("selectedCandidates")):
        selected.add(_identity_value(json_object(value)))
    return {value for value in selected if value}


def _candidate_lists(container: JsonObject) -> list[JsonObject]:
    candidates: list[JsonObject] = []
    for key in ("results", "vmResults", "candidates", "scrapedImages"):
        candidates.extend(json_object(value) for value in json_array(container.get(key)))
    for values in json_object(container.get("groupedResults")).values():
        candidates.extend(json_object(value) for value in json_array(values))
    return [item for item in candidates if item]


def _candidate_sources(
    candidates: list[JsonObject],
    categories: tuple[str, str],
    selected_keys: set[str],
    origin: str,
) -> list[ImageSource]:
    candidate_category, selected_category = categories
    sources: list[ImageSource] = []
    for index, item in enumerate(candidates, start=1):
        title = _title(item, f"후보 {index}")
        candidate = _source(candidate_category, title, item, origin)
        if candidate is None:
            continue
        sources.append(candidate)
        item_keys = {
            _identity_value(item),
            json_text(item.get("candidateId")),
            json_text(item.get("imageId")),
        }
        if any(key and key in selected_keys for key in item_keys):
            sources.append(ImageSource(selected_category, title, candidate.value, origin))
            sources.append(ImageSource("14_OUTPUT_최종선택", title, candidate.value, origin))
    return sources


def collect_snapshot_sources(snapshot: JsonObject) -> list[ImageSource]:
    assets = json_object(snapshot.get("assets")) or snapshot
    factory = json_object(assets.get("factory"))
    product = json_object(factory.get("product"))
    sources: list[ImageSource] = []

    for index, value in enumerate(json_array(product.get("inputImages")), start=1):
        item = json_object(value)
        found = _source(
            "01_INPUT_기본이미지",
            _title(item, f"기본 이미지 {index}"),
            item,
            "factory.product.inputImages",
        )
        if found:
            sources.append(found)
    direct_input = _source("01_INPUT_기본이미지", "기본 이미지", product, "factory.product")
    if direct_input:
        sources.append(direct_input)

    option_sorter = json_object(assets.get("optionSorter"))
    for index, value in enumerate(json_array(option_sorter.get("images")), start=1):
        item = json_object(value)
        found = _source(
            "02_INPUT_색상옵션",
            _title(item, f"색상옵션 원본 {index}"),
            item,
            "optionSorter.images",
        )
        if found:
            sources.append(found)
    for index, value in enumerate(json_array(option_sorter.get("optionResults")), start=1):
        item = json_object(value)
        found = _source(
            "12_OUTPUT_색상옵션컷",
            _title(item, f"색상옵션 결과 {index}"),
            item,
            "optionSorter.optionResults",
        )
        if found:
            sources.extend((
                found,
                ImageSource("14_OUTPUT_최종선택", found.title, found.value, found.source),
            ))

    comp_page = json_object(assets.get("compPage"))
    if not comp_page:
        comp_page = json_object(json_object(assets.get("competitors")).get("compPage"))
    market = json_object(comp_page.get("marketScrape"))
    sources.extend(_candidate_sources(
        _candidate_lists(market),
        ("03_OUTPUT_경쟁사후보", "04_OUTPUT_경쟁사선택"),
        _selected_values(market),
        "compPage.marketScrape",
    ))

    cafe_candidates = [
        json_object(value) for value in json_array(product.get("cafe24Candidates"))
    ]
    sources.extend(_candidate_sources(
        cafe_candidates,
        ("05_OUTPUT_Cafe24후보", "06_OUTPUT_Cafe24선택"),
        {json_text(product.get("selectedCafe24CandidateKey"))},
        "factory.product.cafe24Candidates",
    ))
    db_candidates = [
        json_object(value) for value in json_array(product.get("dbCandidates"))
    ]
    sources.extend(_candidate_sources(
        db_candidates,
        ("07_OUTPUT_신화사DB후보", "08_OUTPUT_신화사DB선택"),
        {json_text(product.get("selectedDbCandidateKey"))},
        "factory.product.dbCandidates",
    ))

    for section_id, image_value in json_object(assets.get("sectionImages")).items():
        image = json_text(image_value)
        if not image:
            continue
        title = f"섹션 {section_id}"
        sources.extend((
            ImageSource("13_OUTPUT_섹션이미지", title, image, "sectionImages"),
            ImageSource("14_OUTPUT_최종선택", title, image, "sectionImages"),
        ))
    return sources


def _record_category(record: JsonObject) -> str:
    stage = json_text(record.get("stageId")).lower()
    archived_category = json_text(record.get("category")).lower()
    category_map = {
        "input-images": "01_INPUT_기본이미지",
        "hero-images": "09_OUTPUT_대표이미지",
        "cut-images": "10_OUTPUT_이미지컷",
        "size-images": "11_OUTPUT_사이즈컷",
        "option-images": "12_OUTPUT_색상옵션컷",
        "section-images": "13_OUTPUT_섹션이미지",
        "detail-page-files": "13_OUTPUT_섹션이미지",
    }
    if stage == "hero":
        return "09_OUTPUT_대표이미지"
    if stage == "size":
        return "11_OUTPUT_사이즈컷"
    if stage == "options":
        return "12_OUTPUT_색상옵션컷"
    if stage == "cuts" or stage.startswith("cuts_"):
        return "10_OUTPUT_이미지컷"
    if stage.startswith("section_") or stage.startswith("detail"):
        return "13_OUTPUT_섹션이미지"
    if stage == "input":
        return "01_INPUT_기본이미지"
    return category_map.get(archived_category, "")


def collect_record_sources(
    records: tuple[JsonObject, ...],
    identity: LibraryIdentity,
) -> list[ImageSource]:
    sources: list[ImageSource] = []
    for record in records:
        workspace = json_text(record.get("workspaceId"))
        same_workspace = workspace == identity.workspace_id
        matching_draft = (
            workspace.startswith("draft:")
            and json_text(record.get("productKey")) == identity.product_key
            and json_text(record.get("inputImageFingerprint"))
            == identity.input_image_fingerprint
        )
        category = _record_category(record)
        image_path = json_text(json_object(record.get("files")).get("imagePath"))
        if not category or not image_path or not (same_workspace or matching_draft):
            continue
        title = json_text(record.get("title")) or Path(image_path).stem
        sources.append(ImageSource(
            category,
            title,
            image_path,
            "local-archive.index",
        ))
        if category in {
            "09_OUTPUT_대표이미지",
            "12_OUTPUT_색상옵션컷",
            "13_OUTPUT_섹션이미지",
        }:
            sources.append(ImageSource(
                "14_OUTPUT_최종선택",
                title,
                image_path,
                "local-archive.index",
            ))
    return sources
