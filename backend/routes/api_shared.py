"""Shared Flask blueprint and helpers for API domain modules."""
"""
API Routes for the Product Detail Page Generator
"""
import os
import sys
import uuid
import json
import threading
import subprocess
import base64
import hashlib
import mimetypes
import socket
import struct
import time
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, quote, urljoin, urlparse
from flask import Blueprint, request, jsonify, send_file, send_from_directory, Response
from werkzeug.utils import secure_filename
import requests
import google.auth
from google.auth.transport.requests import Request as GoogleAuthRequest
from services.pipeline import pipeline
from services.section_definitions import get_all_sections
from config import Config

_JEPUM_DETAIL_ROOT = r"C:\JepumScraper\data\detail_pages"
_JEPUM_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
_JEPUM_ROOT = Path(r"C:\JepumScraper")
_JEPUM_MAIN = _JEPUM_ROOT / "main.py"
# JepumScraper 가 듣고 있는 포트. 스크래퍼가 포트를 옮기면 여기가 어긋나고,
# 그때 화면에는 "JepumScraper가 꺼져 있습니다" 라고만 나온다 — 멀쩡히 돌고 있는데도.
# 실측 2026-08-28: 스크래퍼는 5003 에서 정상(detail-v83)인데 여기가 5012 를 보고 있어
# 경쟁사 수집이 거부되고 모든 auto 작업이 52% 에서 죽었다. 원인을 찾는 데 한참 걸렸다.
# 그래서 (1) 기본값을 실제 포트로 맞추고 (2) 환경변수로 옮길 수 있게 하고
# (3) 아래 message 에 어느 포트를 봤는지 적는다.
_JEPUM_PORT = int(os.getenv("JEPUM_SCRAPER_PORT", "5003") or "5003")
_JEPUM_HEALTH_PATH = "/api/v1/health"
_JEPUM_START_LOCK = threading.Lock()
_JEPUM_PYTHON_CANDIDATES = (
    Path(r"C:\Users\kua\AppData\Local\Python\pythoncore-3.14-64\python.exe"),
    Path(sys.executable),
)
_IMAGE_PROXY_ALLOWED_HOSTS = {
    "03030.co.kr",
    "www.03030.co.kr",
    "thumbnail.coupangcdn.com",
    "gdimg.gmarket.co.kr",
    "sinbad-img.gmarket.com",
    "image.auction.co.kr",
    "cdn.011st.com",
    "shopping-phinf.pstatic.net",
}
_SINHWA_DB_ROOT = Path(r"C:\Users\kua\sinhwa-db-hub")
_SINHWA_DB_SCRIPT = _SINHWA_DB_ROOT / "manage_sinhwa_servers.ps1"
_SINHWA_DB_PORT = 8200
_SINHWA_DB_HEALTH_PATHS = ("/api/v1/health", "/api/health")
_CAFE24_CONTROL_ROOT = Path(r"C:\Users\kua\Documents\Playground\cafe24-control-tower")
_CAFE24_CONTROL_SCRIPT = _CAFE24_CONTROL_ROOT / "launch-cafe24-control-tower.ps1"
_CAFE24_CONTROL_PORT = 8787
_CAFE24_CONTROL_START_LOCK = threading.Lock()
_LOCAL_ACTION_ORIGIN_PORTS = {5000, 5050, 5500, 8080, 8081}


def _local_action_request_allowed():
    if request.headers.get("Sec-Fetch-Site", "").strip().lower() == "cross-site":
        return False
    origin = request.headers.get("Origin", "").strip()
    if not origin:
        return True
    try:
        parsed = urlparse(origin)
        return (
            parsed.scheme in {"http", "https"}
            and parsed.hostname in {"127.0.0.1", "localhost"}
            and parsed.port in _LOCAL_ACTION_ORIGIN_PORTS
        )
    except ValueError:
        return False

# ── Vertex Config (공용 중앙 설정) ─────────────────────────────────
_VERTEX_CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', '.local', 'vertex-config.json')
_SACHYOSANGSE_VERTEX_CONFIG_PATH = r'C:\Users\kua\Documents\Playground\sachyosangse\apps\api\.local\vertex-config.json'
_LAST_WORK_PATH = os.path.join(Config.LOCAL_STATE_FOLDER, 'pdp-last-work.json')
_LAST_WORK_BACKUP_PATH = os.path.join(Config.LOCAL_STATE_FOLDER, 'pdp-last-work.bak.json')
_MARKETPLUS_RECIPE_PATH = os.path.join(os.path.dirname(__file__), '..', '.local', 'marketplus-internal-recipes.json')
_LOCAL_ARCHIVE_INDEX_PATH = os.path.join(Config.LOCAL_ARCHIVE_FOLDER, "index.json")
_LOCAL_ARCHIVE_LOCK = threading.Lock()
_CRYSTAL_RECOVERY_IMAGE_DIR = os.path.abspath(os.path.join(
    os.path.dirname(Config.LOCAL_ARCHIVE_FOLDER),
    "recovery",
    "crystal-preview-restored",
))
def _load_vertex_config():
    """요청마다 호출 — 파일에서 읽어 재시작 없이 즉시 반영."""
    try:
        with open(_VERTEX_CONFIG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            'project': str(data.get('project') or '').strip() or Config.GOOGLE_CLOUD_PROJECT,
            'location': str(data.get('location') or '').strip() or 'us-central1',
        }
    except Exception:
        return {
            'project': Config.GOOGLE_CLOUD_PROJECT,
            'location': Config.GOOGLE_CLOUD_LOCATION or 'us-central1',
        }

def _save_vertex_config(project: str, location: str):
    """두 곳 동시 저장 (kuasangse + sachyosangse)."""
    data = {'project': project, 'location': location}
    for path in [_VERTEX_CONFIG_PATH, _SACHYOSANGSE_VERTEX_CONFIG_PATH]:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

def _mask_secret(value: str, head: int = 6, tail: int = 4) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) <= head + tail:
        return "*" * len(text)
    return f"{text[:head]}...{text[-tail:]}"

def _read_service_account_email():
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not path:
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return str(data.get("client_email") or "").strip()
    except Exception:
        return ""

def _read_gcloud_active_account():
    try:
        out = subprocess.check_output(
            ["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        return (out or "").strip().splitlines()[0].strip()
    except Exception:
        return ""

def _get_vertex_auth_info():
    info = {
        "authEmail": "",
        "authType": "",
        "authProject": "",
        "authNote": "",
    }
    try:
        credentials, project_id = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        info["authProject"] = project_id or ""
        email = (
            getattr(credentials, "service_account_email", "")
            or getattr(credentials, "_service_account_email", "")
            or _read_service_account_email()
            or _read_gcloud_active_account()
        )
        info["authEmail"] = email or ""
        info["authType"] = credentials.__class__.__name__
        if not email:
            info["authNote"] = "ADC 인증은 확인됐지만 이메일은 인증 객체에서 제공되지 않습니다."
    except Exception as e:
        info["authNote"] = f"ADC 인증 정보 확인 실패: {str(e)}"
    return info

api = Blueprint("api", __name__)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}


def _atomic_write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    for attempt in range(6):
        try:
            os.replace(tmp_path, path)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.05 * (attempt + 1))


def _load_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _has_text(value):
    return bool(str(value or "").strip())


def _list_len(value):
    return len(value) if isinstance(value, list) else 0


def _sinhwa_db_port_open(timeout=0.8):
    try:
        with socket.create_connection(("127.0.0.1", _SINHWA_DB_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def _sinhwa_db_status_payload():
    port_open = _sinhwa_db_port_open()
    health_ok = False
    health_detail = ""
    if port_open:
        for path in _SINHWA_DB_HEALTH_PATHS:
            try:
                resp = requests.get(f"http://127.0.0.1:{_SINHWA_DB_PORT}{path}", timeout=2)
                if resp.ok:
                    health_ok = True
                    health_detail = path
                    break
                health_detail = f"{path} HTTP {resp.status_code}"
            except requests.RequestException as exc:
                health_detail = f"{path} {exc.__class__.__name__}"
    running = port_open and health_ok
    port_conflict = port_open and not health_ok
    return {
        "ok": True,
        "running": running,
        "portOpen": port_open,
        "portConflict": port_conflict,
        "healthOk": health_ok,
        "healthDetail": health_detail,
        "port": _SINHWA_DB_PORT,
        "root": str(_SINHWA_DB_ROOT),
        "scriptExists": _SINHWA_DB_SCRIPT.is_file(),
        "message": "신화사DB 프로그램이 실행 중입니다." if running else "신화사DB 프로그램이 꺼져 있습니다.",
    }


def _cafe24_control_port_open(timeout=0.8):
    try:
        with socket.create_connection(("127.0.0.1", _CAFE24_CONTROL_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def _cafe24_control_status_payload():
    port_open = _cafe24_control_port_open()
    health_ok = False
    health_detail = ""
    if port_open:
        try:
            response = requests.get(
                f"http://127.0.0.1:{_CAFE24_CONTROL_PORT}/api/setup/status",
                params={"include_secrets": 0},
                timeout=2,
            )
            health_ok = response.ok
            health_detail = f"HTTP {response.status_code}"
        except requests.RequestException as exc:
            health_detail = exc.__class__.__name__
    running = port_open and health_ok
    port_conflict = port_open and not health_ok
    return {
        "ok": True,
        "running": running,
        "portOpen": port_open,
        "portConflict": port_conflict,
        "healthOk": health_ok,
        "healthDetail": health_detail,
        "port": _CAFE24_CONTROL_PORT,
        "root": str(_CAFE24_CONTROL_ROOT),
        "scriptExists": _CAFE24_CONTROL_SCRIPT.is_file(),
        "message": (
            "Cafe24 Control Tower가 실행 중입니다. API Hub 후보 수집을 계속합니다."
            if running
            else "Cafe24 Control Tower가 꺼져 있습니다."
        ),
    }


def _jepum_scraper_port_open(timeout=0.8):
    try:
        with socket.create_connection(("127.0.0.1", _JEPUM_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def _jepum_scraper_python_executable():
    for candidate in _JEPUM_PYTHON_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _jepum_scraper_status_payload():
    port_open = _jepum_scraper_port_open()
    health_ok = False
    health_detail = ""
    if port_open:
        try:
            resp = requests.get(
                f"http://127.0.0.1:{_JEPUM_PORT}{_JEPUM_HEALTH_PATH}",
                timeout=2,
            )
            payload = resp.json() if "json" in resp.headers.get("content-type", "").lower() else {}
            expected_auth_guard = (
                resp.status_code == 401
                and isinstance(payload, dict)
                and payload.get("code") == "unauthorized"
            )
            health_ok = resp.ok or expected_auth_guard
            health_detail = (
                _JEPUM_HEALTH_PATH
                if health_ok
                else f"{_JEPUM_HEALTH_PATH} HTTP {resp.status_code}"
            )
        except (requests.RequestException, ValueError) as exc:
            health_detail = f"{_JEPUM_HEALTH_PATH} {exc.__class__.__name__}"
    running = port_open and health_ok
    port_conflict = port_open and not health_ok
    python_path = _jepum_scraper_python_executable()
    return {
        "ok": True,
        "running": running,
        "portOpen": port_open,
        "portConflict": port_conflict,
        "healthOk": health_ok,
        "healthDetail": health_detail,
        "port": _JEPUM_PORT,
        "root": str(_JEPUM_ROOT),
        "mainExists": _JEPUM_MAIN.is_file(),
        "pythonExists": bool(python_path),
        # 어느 포트를 봤는지 말한다. 이 한 줄이 없어서 "꺼져 있습니다" 만 보고
        # 멀쩡히 돌고 있는 서비스를 한참 찾아다녔다.
        "message": (
            f"JepumScraper가 실행 중입니다. (포트 {_JEPUM_PORT})"
            if running
            else f"JepumScraper가 포트 {_JEPUM_PORT} 에 없습니다. "
                 "스크래퍼가 다른 포트에 떠 있으면 JEPUM_SCRAPER_PORT 로 알려 주세요."
        ),
    }


def _snapshot_comp_page(snapshot):
    if not isinstance(snapshot, dict):
        return {}
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), dict) else snapshot
    comp_page = assets.get("compPage") if isinstance(assets.get("compPage"), dict) else {}
    return comp_page


def _snapshot_has_comp_analysis(snapshot):
    comp_page = _snapshot_comp_page(snapshot)
    return isinstance(comp_page.get("analysisResult"), dict) and bool(comp_page.get("analysisResult"))


def _snapshot_comp_analysis_time(snapshot):
    comp_page = _snapshot_comp_page(snapshot)
    analysis = comp_page.get("analysisResult") if isinstance(comp_page.get("analysisResult"), dict) else {}
    try:
        return float(analysis.get("analyzedAt") or comp_page.get("savedAt") or 0)
    except Exception:
        return 0


def _last_work_score(snapshot):
    """Richer snapshots should not be overwritten by empty reload states."""
    if not isinstance(snapshot, dict):
        return 0
    lightweight = snapshot.get("lightweight") if isinstance(snapshot.get("lightweight"), dict) else {}
    assets = snapshot.get("assets") if isinstance(snapshot.get("assets"), dict) else {}
    factory = assets.get("factory") if isinstance(assets.get("factory"), dict) else {}
    product = factory.get("product") if isinstance(factory.get("product"), dict) else {}
    def _section_content_count(value):
        if not isinstance(value, dict):
            return 0
        keys = ("headline", "subheadline", "body_text", "cta_text", "layout_suggestion")
        count = 0
        for item in value.values():
            if not isinstance(item, dict):
                continue
            if any(_has_text(item.get(key)) for key in keys):
                count += 1
                continue
            extra = item.get("extra_elements")
            if isinstance(extra, list) and any(_has_text(v) for v in extra):
                count += 1
        return count
    def _displayable_image_count(value):
        if not isinstance(value, dict):
            return 0
        total = 0
        for item in value.values():
            text = item if isinstance(item, str) else ""
            if text.startswith("data:image/") or text.startswith("http://") or text.startswith("https://") or text.startswith("blob:"):
                total += 1
        return total
    def _stored_marker_count(value):
        if not isinstance(value, dict):
            return 0
        return sum(1 for item in value.values() if item == "__stored_in_indexeddb__")
    def _detail_image_block_count(value):
        if not isinstance(value, list):
            return 0
        return sum(1 for item in value if isinstance(item, dict) and _has_text(item.get("dataUrl")) and str(item.get("dataUrl")).startswith("data:image/"))
    def _section_variant_content_count(value):
        if not isinstance(value, dict):
            return 0
        total = 0
        for variants in value.values():
            if not isinstance(variants, list):
                continue
            if _section_content_count({str(i): (variant.get("content") if isinstance(variant, dict) else {}) for i, variant in enumerate(variants)}):
                total += 1
        return total
    score = 0
    for source in (lightweight, assets, product):
        if _has_text(source.get("productName")):
            score += 3
            break
    if _has_text(assets.get("imagePreview")) or _has_text(product.get("imagePreview")) or _has_text(assets.get("imageBase64")) or _has_text(product.get("imageBase64")):
        score += 3
    score += min(_list_len(assets.get("analysisImages")), 5)
    score += min(_list_len(product.get("inputImages")), 5)
    section_contents = assets.get("sectionContents") if isinstance(assets.get("sectionContents"), dict) else lightweight.get("sectionContents")
    score += min(_section_content_count(section_contents), 20)
    score += min(_displayable_image_count(assets.get("sectionImages")) * 3, 20)
    score += min(_stored_marker_count(assets.get("sectionImages")), 6)
    score += min(_detail_image_block_count(assets.get("detailImageBlocks")) * 2, 10)
    score += min(_section_variant_content_count(assets.get("sectionVariants")), 10)
    if isinstance(product.get("confirmedDb"), dict) and product.get("confirmedDb"):
        score += 4
    if isinstance(product.get("finalDb"), dict) and product.get("finalDb"):
        score += 3
    if isinstance(product.get("cafe24Product"), dict) and product.get("cafe24Product"):
        score += 4
    if isinstance(product.get("dbCandidates"), list) and product.get("dbCandidates"):
        score += min(len(product.get("dbCandidates")), 5)
    if isinstance(product.get("cafe24Candidates"), list) and product.get("cafe24Candidates"):
        score += min(len(product.get("cafe24Candidates")), 5)
    cafe24_field_view = assets.get("cafe24FieldViewStorage")
    if not isinstance(cafe24_field_view, dict):
        cafe24_field_view = factory.get("cafe24FieldView") if isinstance(factory.get("cafe24FieldView"), dict) else {}
    score += min(_list_len(cafe24_field_view.get("hiddenFieldIds")), 4)
    score += min(_list_len(cafe24_field_view.get("presets")) * 2, 6)
    if cafe24_field_view.get("defaultSavedAt"):
        score += 1
    cuts = assets.get("cuts") if isinstance(assets.get("cuts"), dict) else {}
    score += min(_list_len(cuts.get("prompts")), 6)
    score += min(_list_len(cuts.get("results")), 8)
    comp_page = assets.get("compPage") if isinstance(assets.get("compPage"), dict) else {}
    if isinstance(comp_page.get("analysisResult"), dict) and comp_page.get("analysisResult"):
        score += 10
    if isinstance(comp_page.get("sectionPlan"), dict) and comp_page.get("sectionPlan"):
        score += 4
    score += min(_list_len(comp_page.get("analyzeLogs")), 4)
    market_scrape = comp_page.get("marketScrape") if isinstance(comp_page.get("marketScrape"), dict) else {}
    score += min(_list_len(market_scrape.get("scrapedImages")), 6)
    score += min(_list_len(market_scrape.get("selectedImageIds")), 4)
    option_sorter = assets.get("optionSorter") if isinstance(assets.get("optionSorter"), dict) else {}
    score += min(_list_len(option_sorter.get("images")), 8)
    score += min(_list_len(option_sorter.get("optionResults")), 8)
    return score


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS



