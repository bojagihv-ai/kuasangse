from __future__ import annotations

import sys
from typing import Final

from flask import Flask, Response, jsonify, request

from .config import ConfigurationError, ControlTowerConfig, load_config
from .cafe24_bridge import Cafe24CommandBridge, QueuedCafe24CommandBridge
from .factory_sync import FactorySyncBridge
from .gpt_oauth import GptOAuthJudge
from .pdp_client import PdpControlHttpApi
from .pdp_workbench_client import PdpWorkbenchApi, PdpWorkbenchHttpApi
from .routes import PdpApi, register_routes


SERVICE_NAME: Final = "batch-production-control"
DISPLAY_NAME: Final = "생산관제"
SERVICE_VERSION: Final = "1.0.0"
SCHEMA_VERSION: Final = "1"
SAFE_CORS_METHODS: Final = "GET, HEAD, OPTIONS"


def create_app(
    config: ControlTowerConfig | None = None,
    pdp_api: PdpApi | None = None,
    cafe24_bridge: Cafe24CommandBridge | None = None,
    workbench_api: PdpWorkbenchApi | None = None,
    factory_sync_bridge: FactorySyncBridge | None = None,
    gpt_judge: GptOAuthJudge | None = None,
) -> Flask:
    settings = config if config is not None else load_config()
    app = Flask(__name__)
    app.config["CONTROL_TOWER_CONFIG"] = settings
    register_routes(
        app,
        pdp_api or PdpControlHttpApi(settings.pdp_control_url, settings.pdp_service_key),
        cafe24_bridge=cafe24_bridge,
        factory_sync_bridge=factory_sync_bridge,
        workbench_api=workbench_api
        or PdpWorkbenchHttpApi(
            settings.pdp_assets_url,
            settings.pdp_control_url,
            settings.pdp_service_key,
        ),
        gpt_judge=gpt_judge or GptOAuthJudge(settings.api_hub_url),
    )

    @app.before_request
    def enforce_origin_boundary() -> Response | None:
        origin = request.headers.get("Origin")
        if origin is None or origin in settings.cors_origins:
            if request.method == "OPTIONS" and origin in settings.cors_origins:
                return Response(status=204)
            return None
        if request.method in {"OPTIONS", "POST", "PUT", "PATCH", "DELETE"}:
            return jsonify({"error": "origin_not_allowed", "status": "error"}), 403
        return None

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        origin = request.headers.get("Origin")
        if origin is None or origin not in settings.cors_origins:
            return response
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        if request.method == "OPTIONS":
            requested_method = request.headers.get("Access-Control-Request-Method", "")
            if requested_method == "POST":
                response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS, POST"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Control-Tower-CSRF, X-Control-Tower-Session"
            else:
                response.headers["Access-Control-Allow-Methods"] = SAFE_CORS_METHODS
                response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.get("/api/health")
    def health() -> Response:
        return jsonify(
            {
                "service": SERVICE_NAME,
                "displayName": DISPLAY_NAME,
                "status": "ready",
                "version": SERVICE_VERSION,
                "schemaVersion": SCHEMA_VERSION,
                "listen": {"host": settings.backend_host, "port": settings.backend_port},
                "links": {
                    "factoryFrontend": settings.factory_frontend_url,
                    "factoryBackend": settings.factory_backend_url,
                    "apiHub": settings.api_hub_url,
                },
            },
        )

    @app.errorhandler(404)
    def unknown_route(_error: Exception) -> tuple[Response, int]:
        return jsonify({"error": "not_found", "status": "error"}), 404

    return app


def main() -> None:
    try:
        settings = load_config()
    except ConfigurationError as error:
        print(f"configuration error: {error}", file=sys.stderr)
        raise SystemExit(2) from error
    create_app(
        settings,
        cafe24_bridge=QueuedCafe24CommandBridge(),
        factory_sync_bridge=FactorySyncBridge(),
    ).run(
        host=settings.backend_host,
        port=settings.backend_port,
        debug=False,
        use_reloader=False,
    )


if __name__ == "__main__":
    main()
