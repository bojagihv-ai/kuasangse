from __future__ import annotations

from unittest.mock import patch

from app import create_app


def test_health_alias_allows_local_chrome_origin():
    # Given: 로컬 Chrome 앱 origin이 health alias를 요청한다.
    app = create_app()
    client = app.test_client()

    # When: 앱이 VM bridge readiness health 요청을 받는다.
    response = client.get("/health", headers={"Origin": "http://127.0.0.1:8081"})

    # Then: 브라우저가 응답 본문을 읽을 수 있는 CORS 헤더를 받는다.
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:8081"


def test_scrapling_health_exposes_optional_runtime():
    app = create_app()
    client = app.test_client()

    with patch(
        "routes.api_scrapling.scrapling_service.health",
        return_value={"ok": True, "available": True, "version": "test"},
    ):
        response = client.get("/api/scrapling/health")

    assert response.status_code == 200
    assert response.get_json()["available"] is True


def test_scrapling_detail_capture_validates_and_returns_scraped_data():
    app = create_app()
    client = app.test_client()
    result = {
        "ok": True,
        "status": "completed",
        "capture_runtime": "scrapling",
        "products": [{"id": "candidate-1", "product_url": "https://example.com/item"}],
        "scraped_data": {
            "candidate-1": {
                "status": "success",
                "image_urls": ["https://example.com/product.jpg"],
            },
        },
    }

    with patch("routes.api_scrapling.scrapling_service.capture_details", return_value=result) as capture:
        response = client.post(
            "/api/scrapling/detail-capture",
            json={
                "products": [
                    {
                        "id": "candidate-1",
                        "title": "검증 상품",
                        "platform": "test",
                        "product_url": "https://example.com/item",
                    },
                ],
            },
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["capture_runtime"] == "scrapling"
    assert payload["scraped_data"]["candidate-1"]["image_urls"]
    capture.assert_called_once()


def test_scrapling_detail_capture_rejects_missing_products():
    app = create_app()
    client = app.test_client()

    response = client.post("/api/scrapling/detail-capture", json={"products": []})

    assert response.status_code == 400
    assert response.get_json()["ok"] is False
