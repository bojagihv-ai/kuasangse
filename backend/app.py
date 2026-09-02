"""
Product Detail Page Auto-Generator - Flask Backend
Main application entry point
"""
import logging
import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from routes.api import api
from routes.automation import auto_bp, start_automation_scheduler
from routes.public_api import health as public_health
from routes.public_api import openapi_document, public_api
from config import Config
from services.maintenance import start_maintenance_scheduler


def _cors_origins():
    if os.getenv("KUASANGSE_ALLOW_ALL_CORS", "").strip().lower() in {"1", "true", "yes", "on"}:
        return "*"
    defaults = [
        "http://127.0.0.1:5000",
        "http://localhost:5000",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:8081",
        "http://localhost:8081",
    ]
    raw = os.getenv("KUASANGSE_CORS_ORIGINS", "")
    extra = [item.strip() for item in raw.split(",") if item.strip()]
    return list(dict.fromkeys(defaults + extra))


def create_app():
    app = Flask(__name__, static_folder="static")
    app.config.from_object(Config)
    cors_origins = _cors_origins()

    CORS(app, resources={
        r"/api/*": {"origins": cors_origins},
        r"/pdp/*": {"origins": cors_origins},
        r"/health": {"origins": cors_origins},
        r"/openapi.json": {"origins": cors_origins},
    })

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    # 키 없이 뜬 백엔드는 살아 있지만 쓸 수 없다 - 크게 말한다.
    #
    # 실측 2026-08-31/09-02: 공식 기동 경로 셋(start-backend.bat, start-all.bat,
    # tools/launch_public_api.ps1)이 키 없이 백엔드를 띄웠고, launcher.ps1 도 키 로드에
    # 실패하면 말없이 키 없이 띄운 뒤 /api/sections 만 보고 'Backend ready' 를 찍었다.
    # 그러면 /api/sections 는 200 인데 신화사 조회는 전부 service_key_missing 으로 막히고,
    # 화면에는 'DB 후보 0건' 만 보인다 - 하루에 두 번 이걸로 사고가 났다.
    if not str(os.environ.get("SINHWA_PDP_SERVICE_KEY", "")).strip():
        logging.getLogger(__name__).warning(
            "SINHWA_PDP_SERVICE_KEY 가 없이 백엔드가 시작됩니다. "
            "신화사 상세페이지 자산 조회·동기화가 전부 막히고 화면에는 'DB 후보 0건' 으로만 보입니다. "
            "이 창을 닫고 launcher.ps1 로 다시 실행해주세요."
        )

    # Ensure directories exist
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(Config.GENERATED_FOLDER, exist_ok=True)
    os.makedirs(Config.LOCAL_ARCHIVE_FOLDER, exist_ok=True)

    # Register API blueprint
    app.register_blueprint(api, url_prefix="/api")
    app.register_blueprint(public_api, url_prefix="/api/v1")

    @app.route("/health")
    def public_health_alias():
        return public_health()

    @app.route("/openapi.json")
    def public_openapi_alias():
        return openapi_document()

    # Register automation blueprint at /pdp
    app.register_blueprint(auto_bp, url_prefix="/pdp")
    start_automation_scheduler()
    # Disk retention (generated/backups) — opt-out with KUASANGSE_MAINTENANCE=0
    start_maintenance_scheduler()

    # Serve static files
    @app.route("/static/uploads/<path:filename>")
    def serve_upload(filename):
        return send_from_directory(Config.UPLOAD_FOLDER, filename)

    @app.route("/static/generated/<path:filename>")
    def serve_generated(filename):
        return send_from_directory(Config.GENERATED_FOLDER, filename)

    # Serve frontend (production)
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
        if path and os.path.exists(os.path.join(frontend_dir, path)):
            return send_from_directory(frontend_dir, path)
        return send_from_directory(frontend_dir, "index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.getenv("PORT", "5000"))
    host = os.getenv("KUASANGSE_HOST", "127.0.0.1").strip() or "127.0.0.1"
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    print("\n" + "=" * 60)
    print("  Product Detail Page Auto-Generator backend starting")
    print(f"  http://{host}:{port}")
    print("=" * 60 + "\n")
    app.run(host=host, port=port, debug=debug, use_reloader=debug)
