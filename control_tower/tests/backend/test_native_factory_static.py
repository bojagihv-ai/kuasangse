from email.message import Message
from io import BytesIO
from pathlib import Path

import pytest

from control_tower.tools.static_server import NoStoreHandler

ROOT = Path(__file__).resolve().parents[3]


class QuietHandler(NoStoreHandler):
    def log_message(self, format: str, *args: str) -> None:
        return None


def read_path(url: str) -> tuple[bytes, bytes]:
    handler = QuietHandler.__new__(QuietHandler)
    handler.directory = str(ROOT / "control_tower/frontend")
    handler.path = url
    handler.command = "GET"
    handler.request_version = "HTTP/1.1"
    handler.requestline = f"GET {url} HTTP/1.1"
    handler.headers = Message()
    handler.wfile = BytesIO()
    result = handler.send_head()
    body = b""
    if result is not None:
        with result:
            body = result.read()
    return handler.wfile.getvalue(), body


def test_baseline_existing_frontend_keeps_no_store() -> None:
    headers, body = read_path("/control-tower.html")
    assert b"200 OK" in headers
    assert b"Cache-Control: no-store" in headers
    assert body == (ROOT / "control_tower/frontend/control-tower.html").read_bytes()


@pytest.mark.parametrize("file", [
    "app.html", "src/app-loader.js", "src/runtime-manifest.json",
    "src/menus/factory/factory-menu-shell.mjs", "dist/app-runtime.bundle.js",
])
def test_native_serves_exact_original_public_bytes(file: str) -> None:
    headers, body = read_path(f"/factory-native/{file}?v=proof")
    assert b"200 OK" in headers
    assert body == (ROOT / file).read_bytes()


@pytest.mark.parametrize("url", [
    "/factory-native/", "/factory-native/.git/config", "/factory-native/backend/server.py",
    "/factory-native/src/", "/factory-native/src/runtime-manifest.json/../app-loader.js",
    "/factory-native/%2e%2e/AGENTS.md", "/factory-native/src/%2e%2e/%2e%2e/AGENTS.md",
    "/factory-native/src%5c..%5c..%5cAGENTS.md", "/factory-native/src/app-loader.js:stream",
    "/factory-native/output/batch-control/factory-product-jobs.json",
])
def test_native_refuses_private_paths_and_traversal(url: str) -> None:
    headers, _ = read_path(url)
    assert b"404" in headers or b"403" in headers
