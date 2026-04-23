"""
Product Detail Page Auto-Generator - Flask Backend
Main application entry point
"""
import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from routes.api import api
from config import Config


def create_app():
    app = Flask(__name__, static_folder="static")
    app.config.from_object(Config)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Ensure directories exist
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(Config.GENERATED_FOLDER, exist_ok=True)

    # Register API blueprint
    app.register_blueprint(api, url_prefix="/api")

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
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    print("\n" + "=" * 60)
    print("  Product Detail Page Auto-Generator backend starting")
    print(f"  http://localhost:{port}")
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=debug)
