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
# 2026-08-30 또 같은 사고가 났다. 이번엔 5003 이 **이메일통합**에 영구 배정되어
# 스크래퍼가 43000 으로 옮겨간 것이었다(포트 관리국 기록). 앱은 여전히 5003 을 보고,
# 거기 있는 메일 프로그램을 "남의 프로그램" 으로 판정해 수집을 통째로 막았다.
# 숫자를 또 고쳐 넣는 것으로는 세 번째 사고를 못 막는다. 그래서 **외우지 않고 찾는다.**
_JEPUM_HEALTH_PATH = "/api/v1/health"
_JEPUM_API_HUB_BASE = os.getenv("KUA_API_HUB_BASE", "http://127.0.0.1:4321").rstrip("/")
# 마지막으로 확인된 자리들. 환경변수 → 지난번 찾은 포트 → 허브가 아는 주소 → 알려진 후보 순.
_JEPUM_FALLBACK_PORTS = (43000, 5003)
_JEPUM_PORT_CACHE = {"port": None, "checked_at": 0.0}
_JEPUM_PORT_CACHE_TTL = 30.0
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


def _parse_cafe24_setup_status(body):
    """Control Tower 의 setup/status 본문을 읽어 **쓸 수 있는가** 를 답한다.

    켜져 있는 것과 쓸 수 있는 것은 다르다 - 전수 진단 #16.
    예전에는 HTTP 200 이면 running=True 로 끝냈다. 그래서 OAuth 가 끊겼거나 토큰이 만료돼도
    준비 카드는 '준비 완료' 를 찍고, 수집은 첫 요청에서 401 로 죽었다.

    본문 형태(실측 2026-09-02, /api/setup/status?include_secrets=0):
      {"ok":true,"data":{"missing_scopes":[...],
                         "checks":[{"id":"mall-connection","status":"pass"},
                                   {"id":"scopes",...},{"id":"token-keeper",...}]}}
    checks[].status 는 pass | warn | fail | info.

    읽을 수 없는 본문(옛 판 Control Tower, 깨진 응답)에는 usable=None 을 돌려준다.
    모르는 것을 '쓸 수 없다' 로 단정해 막으면, 멀쩡한 환경에서 수집을 못 하게 된다.
    """
    unknown = {
        "usable": None,
        "oauthState": "unknown",
        "missingScopes": [],
        "tokenMessage": "",
        "problem": "",
    }
    if not isinstance(body, dict):
        return unknown
    data = body.get("data")
    if not isinstance(data, dict):
        return unknown
    checks = data.get("checks")
    if not isinstance(checks, list):
        return unknown
    by_id = {}
    for check in checks:
        if isinstance(check, dict) and check.get("id"):
            by_id[str(check["id"])] = check
    mall = by_id.get("mall-connection")
    scopes = by_id.get("scopes")
    token = by_id.get("token-keeper")
    if mall is None and scopes is None and token is None:
        return unknown

    def status_of(check):
        return str((check or {}).get("status") or "").strip().lower()

    missing = [str(item) for item in (data.get("missing_scopes") or []) if str(item).strip()]
    token_message = str((token or {}).get("message") or "")

    if status_of(mall) == "fail":
        return {
            "usable": False,
            "oauthState": "disconnected",
            "missingScopes": missing,
            "tokenMessage": token_message,
            "problem": "Cafe24 OAuth 연결이 끊겼습니다. Control Tower 에서 다시 연결해주세요.",
        }
    if status_of(token) == "fail":
        return {
            "usable": False,
            "oauthState": "reauth_required",
            "missingScopes": missing,
            "tokenMessage": token_message,
            "problem": "Cafe24 토큰이 만료됐습니다. Control Tower 에서 다시 로그인해주세요.",
        }
    if missing or status_of(scopes) in {"fail", "warn"}:
        named = ", ".join(missing) if missing else "일부 권한"
        return {
            "usable": False,
            "oauthState": "scopes_missing",
            "missingScopes": missing,
            "tokenMessage": token_message,
            "problem": f"Cafe24 권한이 모자랍니다({named}). Control Tower 에서 권한을 다시 승인해주세요.",
        }
    if status_of(token) == "warn":
        # 곧 만료되지만 지금은 쓸 수 있다. 막지 않고 알리기만 한다.
        return {
            "usable": True,
            "oauthState": "expiring",
            "missingScopes": [],
            "tokenMessage": token_message,
            "problem": "",
        }
    return {
        "usable": True,
        "oauthState": "connected",
        "missingScopes": [],
        "tokenMessage": token_message,
        "problem": "",
    }


def _cafe24_control_status_payload():
    port_open = _cafe24_control_port_open()
    health_ok = False
    health_detail = ""
    verdict = {"usable": None, "oauthState": "unknown", "missingScopes": [], "tokenMessage": "", "problem": ""}
    if port_open:
        try:
            response = requests.get(
                f"http://127.0.0.1:{_CAFE24_CONTROL_PORT}/api/setup/status",
                params={"include_secrets": 0},
                timeout=2,
            )
            health_ok = response.ok
            health_detail = f"HTTP {response.status_code}"
            # 본문을 버리지 않는다. 토큰·연결·권한 검사표가 여기 들어 있다.
            try:
                verdict = _parse_cafe24_setup_status(response.json())
            except Exception:
                verdict = {"usable": None, "oauthState": "unknown", "missingScopes": [], "tokenMessage": "", "problem": ""}
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
        # 꺼져 있으면 쓸 수 없는 것이 확실하다(False). 켜져 있는데 본문을 못 읽으면 모르는 것(None) -
        # 모르는 것을 '쓸 수 없다' 로 단정해 막으면 멀쩡한 환경에서 수집을 못 하게 된다.
        "usable": (verdict["usable"] if verdict["usable"] is None else bool(verdict["usable"])) if running else False,
        # 꺼져 있으면 OAuth 가 어떤 상태인지는 정말 모른다. usable 은 False 로 확실하지만
        # oauthState 까지 단정하지 않는다 - '재로그인 필요' 같은 틀린 안내를 하게 된다.
        "oauthState": verdict["oauthState"] if running else "unknown",
        "missingScopes": verdict["missingScopes"],
        "tokenMessage": verdict["tokenMessage"],
        "message": (
            "Cafe24 Control Tower가 꺼져 있습니다."
            if not running
            else verdict["problem"]
            or "Cafe24 Control Tower가 실행 중입니다. API Hub 후보 수집을 계속합니다."
        ),
    }


def _jepum_port_health_ok(port, timeout=1.5):
    """그 포트에 있는 것이 **스크래퍼 본인인지** 검진으로 확인한다.

    포트가 열려 있다는 것만으로는 아무것도 모른다. 실제로 5003 에는 메일 프로그램이
    열려 있었고, 그걸 스크래퍼로 착각하거나 침입자로 몰면 둘 다 사고가 된다.
    """
    try:
        resp = requests.get(f"http://127.0.0.1:{port}{_JEPUM_HEALTH_PATH}", timeout=timeout)
    except (requests.RequestException, ValueError):
        return False
    if resp.ok:
        return True
    # 인증이 켜져 있으면 401 로 막지만, 그건 스크래퍼가 살아 있다는 뜻이다.
    try:
        payload = resp.json() if "json" in resp.headers.get("content-type", "").lower() else {}
    except ValueError:
        payload = {}
    return resp.status_code == 401 and isinstance(payload, dict) and payload.get("code") == "unauthorized"


def _jepum_port_from_api_hub(timeout=1.5):
    """API 허브에 스크래퍼가 지금 어디 있는지 묻는다.

    주인님 규칙: "항상 API를 얻어올땐 우선은 API허브를통해얻어와".
    허브는 커넥터의 baseUrl 을 알고 있으므로, 포트가 옮겨져도 허브만 최신이면 따라간다.
    """
    try:
        resp = requests.get(f"{_JEPUM_API_HUB_BASE}/api/connectors", timeout=timeout)
        items = resp.json()
    except (requests.RequestException, ValueError):
        return None
    if isinstance(items, dict):
        items = items.get("connectors") or items.get("items") or []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        if "jepumscraper" not in str(item.get("id") or "").lower():
            continue
        base = str(item.get("baseUrl") or item.get("base_url") or "").strip()
        if not base:
            continue
        try:
            return urlparse(base).port or (443 if base.startswith("https") else 80)
        except ValueError:
            return None
    return None


def _jepum_scraper_port(force=False):
    """스크래퍼가 실제로 듣고 있는 포트를 찾아낸다. 30초간 기억한다."""
    env_port = os.getenv("JEPUM_SCRAPER_PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass
    now = time.time()
    cached = _JEPUM_PORT_CACHE.get("port")
    if not force and cached and (now - _JEPUM_PORT_CACHE.get("checked_at", 0.0)) < _JEPUM_PORT_CACHE_TTL:
        return cached
    candidates = []
    if cached:
        candidates.append(cached)
    hub_port = _jepum_port_from_api_hub()
    if hub_port:
        candidates.append(hub_port)
    candidates.extend(_JEPUM_FALLBACK_PORTS)
    seen = set()
    for port in candidates:
        if not port or port in seen:
            continue
        seen.add(port)
        if _jepum_port_health_ok(port):
            _JEPUM_PORT_CACHE["port"] = port
            _JEPUM_PORT_CACHE["checked_at"] = now
            return port
    # 아무 데서도 못 찾았다. 마지막으로 알던 자리를 답해 메시지에 포트를 적을 수 있게 한다.
    return cached or hub_port or _JEPUM_FALLBACK_PORTS[0]


def _jepum_scraper_port_open(timeout=0.8, port=None):
    try:
        with socket.create_connection(("127.0.0.1", port or _jepum_scraper_port()), timeout=timeout):
            return True
    except OSError:
        return False


def _jepum_scraper_python_executable():
    for candidate in _JEPUM_PYTHON_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _jepum_watcher_verdict():
    """VM 안 후보 수집 watcher 가 살아 있는가.

    호스트 스크래퍼 포트가 열려 있는 것과, 실제로 후보검색을 처리하는 VM 안 watcher 가
    살아 있는 것은 다르다 - 전수 진단 #5. watcher 만 죽은 고장이 흔하다
    (2026-08-31 에 41시간, 09-02 전수 진단 중에도 26분).
    """
    from services.vm_candidate_bridge import watcher_readiness
    return watcher_readiness()


def _jepum_scraper_status_payload():
    # 어느 포트를 볼지부터 찾는다. 외운 번호를 믿다가 두 번 사고가 났다.
    port = _jepum_scraper_port()
    port_open = _jepum_scraper_port_open(port=port)
    health_ok = False
    health_detail = ""
    if port_open:
        try:
            resp = requests.get(
                f"http://127.0.0.1:{port}{_JEPUM_HEALTH_PATH}",
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
    # 켜져 있는 것(running)과 쓸 수 있는 것(usable)을 가른다.
    # watcher 를 못 물어봤으면 모르는 것(None)으로 둔다 - 모르는 것을 '쓸 수 없다' 로
    # 단정해 막으면 멀쩡한 환경에서 수집을 못 하게 된다.
    watcher_alive = None
    heartbeat_age = None
    try:
        verdict = _jepum_watcher_verdict()
        if isinstance(verdict, dict):
            watcher_alive = verdict.get("candidateWatcherAlive")
            heartbeat_age = verdict.get("heartbeatAgeSeconds")
    except Exception:
        watcher_alive = None
        heartbeat_age = None
    if not running:
        usable = False
    elif watcher_alive is None:
        usable = None
    else:
        usable = bool(watcher_alive)
    if running and watcher_alive is False:
        minutes = int(round((heartbeat_age or 0) / 60))
        watcher_note = (
            f"JepumScraper는 포트 {port} 에서 실행 중이지만, VM 안 후보 수집 watcher 가 응답하지 않습니다"
            f"(마지막 응답 {minutes}분 전). VM 안에서 후보 수집 watcher 를 다시 실행해주세요."
        )
    else:
        watcher_note = ""
    return {
        "ok": True,
        "running": running,
        "portOpen": port_open,
        "portConflict": port_conflict,
        "healthOk": health_ok,
        "healthDetail": health_detail,
        "port": port,
        "root": str(_JEPUM_ROOT),
        "mainExists": _JEPUM_MAIN.is_file(),
        "pythonExists": bool(python_path),
        # 어느 포트를 봤는지 말한다. 이 한 줄이 없어서 "꺼져 있습니다" 만 보고
        # 멀쩡히 돌고 있는 서비스를 한참 찾아다녔다.
        "usable": usable,
        "candidateWatcherAlive": watcher_alive,
        "heartbeatAgeSeconds": heartbeat_age,
        "message": (
            watcher_note
            or f"JepumScraper가 실행 중입니다. (포트 {port})"
            if running
            else f"JepumScraper가 포트 {port} 에 없습니다. "
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



