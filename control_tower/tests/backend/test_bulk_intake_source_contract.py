from __future__ import annotations

from control_tower.backend.factory_sync import _normalize_product_job_payload


def test_bulk_selected_source_preserves_weight_without_authorizing_update() -> None:
    payload = _normalize_product_job_payload(
        {
            "batchId": "bulk-source-contract",
            "idempotencyKey": "bulk-source-contract-1",
            "mode": "manual",
            "source": {"kind": "direct", "selectionId": "3000"},
            "productName": "선택 상품",
            "workfileName": "선택 상품.kuasangse",
            "requiredValues": {"weight": "5.3g", "optionMode": "none"},
            "inputImages": [],
        }
    )

    assert payload["source"] == {"kind": "direct", "selectionId": "3000"}
    assert payload["requiredValues"]["weight"] == "5.3g"
    assert "updateProductNo" not in payload
