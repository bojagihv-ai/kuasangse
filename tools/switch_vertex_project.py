"""Vertex 프로젝트 갈아끼우기 — 한 번에, 확인까지.

왜 이 도구가 필요한가 (2026-09-04 실측):
  무료 크레딧이 끝나 이미지 생성이 통째로 막혔다. 화면에는 "이미지 API 실패" 로만 떴다.
  새 프로젝트로 옮기는 데 **다섯 가지**가 전부 필요했는데, 기존 설정 화면은 그중
  하나(프로젝트 ID)만 바꿨다. 나머지 넷을 모르면 바꿔도 계속 막힌다:

    1) 그 프로젝트를 소유한 계정으로 인증(ADC)          <- 안 하면 PERMISSION_DENIED
    2) 할당량 프로젝트 지정                              <- 안 하면 일부 API 가 거절
    3) Vertex AI API 활성화 (새 프로젝트는 기본 꺼짐)     <- 안 하면 403
    4) 설정 파일을 **쓰는 프로그램 전부** 에 반영         <- 하나만 바꾸면 다른 쪽이 옛 것을 본다
    5) 실제로 한 장 생성해서 확인                         <- 안 하면 진짜 되는지 모른다

사용법:
    python tools/switch_vertex_project.py --status
        지금 어떤 상태인지만 본다. 아무것도 안 바꾼다. 요금도 안 나간다.

    python tools/switch_vertex_project.py <프로젝트ID>
        위 1~5 를 순서대로 하고, 실패하면 이전 설정으로 되돌린다.
        마지막 확인에서 이미지 1장 요금이 나간다.

    python tools/switch_vertex_project.py <프로젝트ID> --no-verify
        확인 생성을 건너뛴다(요금 안 나감). 대신 진짜 되는지는 모른다.

    python tools/switch_vertex_project.py --login
        다른 구글 계정으로 갈아탈 때. 브라우저가 열리면 그 계정을 고르면 된다.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

# ── 이 설정을 읽는 프로그램들 ────────────────────────────────────────────
# 새 프로그램이 Vertex 를 쓰기 시작하면 여기 한 줄만 더한다.
# (예전에는 두 프로그램이 서로의 경로를 코드에 박아 놓고 덮어썼다 -
#  한쪽을 고치면 다른 쪽을 잊어버리는 구조였다.)
CONSUMERS = [
    ("상세페이지", r"C:\Users\kua\Documents\GitHub\kuasangse\backend\.local\vertex-config.json"),
    ("사쵸상세", r"C:\Users\kua\Documents\Playground\sachyosangse\apps\api\.local\vertex-config.json"),
]

BACKEND_BASE = os.environ.get("KUASANGSE_BACKEND_BASE", "http://127.0.0.1:5050")
IMAGE_MODEL = os.environ.get("KUASANGSE_IMAGE_MODEL", "gemini-3.1-flash-image")
TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def say(message: str) -> None:
    print(message, flush=True)


def pad(text: str, width: int = 14) -> str:
    """한글은 글자당 폭이 2라 :8s 로는 표가 어긋난다. 보이는 폭으로 맞춘다."""
    shown = sum(2 if ord(ch) > 0x1100 else 1 for ch in text)
    return text + ' ' * max(0, width - shown)


def resolve_executable(name: str) -> str:
    """Windows 에서 gcloud 는 gcloud.cmd 배치파일이다.

    subprocess 는 shell 없이 .cmd 를 스스로 찾지 못해 FileNotFoundError 가 난다.
    그러면 이 도구가 "토큰 없음" 이라고 잘못 말한다(실측 2026-09-04, 첫 실행에서 겪음).
    shutil.which 로 실제 경로를 찾아 넘긴다.
    """
    found = shutil.which(name)
    if found:
        return found
    for suffix in (".cmd", ".exe", ".bat"):
        found = shutil.which(name + suffix)
        if found:
            return found
    return name


def run(args: list[str], timeout: int = 120) -> tuple[int, str]:
    resolved = [resolve_executable(args[0]), *args[1:]]
    try:
        done = subprocess.run(resolved, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        return done.returncode, (done.stdout or "") + (done.stderr or "")
    except FileNotFoundError:
        return 127, f"{args[0]} 를 찾지 못했습니다"
    except subprocess.TimeoutExpired:
        return 124, "시간 초과"


def access_token() -> str:
    code, out = run(["gcloud", "auth", "application-default", "print-access-token"], timeout=60)
    return out.strip() if code == 0 else ""


def api_get(url: str, token: str, quota_project: str = "") -> tuple[int, dict]:
    request = urllib.request.Request(url)
    request.add_header("Authorization", f"Bearer {token}")
    if quota_project:
        request.add_header("x-goog-user-project", quota_project)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(body or "{}")
        except json.JSONDecodeError:
            return error.code, {"raw": body[:400]}
    except Exception as error:  # noqa: BLE001 - 진단 도구라 어떤 실패든 사람 말로 보여 준다
        return 0, {"error": {"message": str(error)}}


def api_post(url: str, token: str, payload: dict, quota_project: str = "", timeout: int = 180) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    if quota_project:
        request.add_header("x-goog-user-project", quota_project)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(body or "{}")
        except json.JSONDecodeError:
            return error.code, {"raw": body[:400]}
    except Exception as error:  # noqa: BLE001
        return 0, {"error": {"message": str(error)}}


def adc_identity(token: str) -> str:
    status, data = api_get("https://www.googleapis.com/oauth2/v3/userinfo", token)
    return str(data.get("email") or "") if status == 200 else ""


def adc_quota_project() -> str:
    path = os.path.join(os.environ.get("APPDATA", ""), "gcloud", "application_default_credentials.json")
    try:
        with io.open(path, encoding="utf-8") as handle:
            return str(json.load(handle).get("quota_project_id") or "")
    except Exception:  # noqa: BLE001
        return ""


def read_consumer(path: str) -> dict:
    try:
        with io.open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:  # noqa: BLE001
        return {}


def write_consumer(path: str, project: str, location: str) -> str:
    """원자적으로 쓴다. 실패해도 원본은 그대로 둔다."""
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        return "폴더 없음"
    temporary = f"{path}.switching.tmp"
    try:
        with io.open(temporary, "w", encoding="utf-8") as handle:
            json.dump({"project": project, "location": location}, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
        return ""
    except OSError as error:
        try:
            os.remove(temporary)
        except OSError:
            pass
        return f"{error.__class__.__name__}: {error}"


def project_number(token: str, project_id: str) -> tuple[str, str]:
    status, data = api_get(f"https://cloudresourcemanager.googleapis.com/v1/projects/{project_id}", token)
    if status != 200:
        return "", str((data.get("error") or {}).get("message") or data)[:220]
    return str(data.get("projectNumber") or ""), ""


def describe_state() -> dict:
    token = access_token()
    state = {
        "token": bool(token),
        "adcAccount": adc_identity(token) if token else "",
        "adcQuotaProject": adc_quota_project(),
        "consumers": [(label, path, read_consumer(path)) for label, path in CONSUMERS],
        "backend": {},
    }
    try:
        with urllib.request.urlopen(f"{BACKEND_BASE}/api/provider", timeout=8) as response:
            state["backend"] = json.loads(response.read().decode("utf-8") or "{}")
    except Exception:  # noqa: BLE001
        state["backend"] = {}
    return state


def print_state(state: dict) -> None:
    say("── 지금 상태 ──")
    say(f"  인증 계정(ADC) : {state['adcAccount'] or '(토큰 없음 - gcloud 로그인 필요)'}")
    say(f"  할당량 프로젝트 : {state['adcQuotaProject'] or '(없음)'}")
    backend = state.get("backend") or {}
    if backend:
        say(f"  백엔드가 쓰는 것: {backend.get('google_cloud_project') or '?'} / {backend.get('google_cloud_location') or '?'}"
            f" ({backend.get('gemini_route') or '?'})")
    else:
        say(f"  백엔드가 쓰는 것: (응답 없음 - {BACKEND_BASE} 가 꺼져 있습니다)")
    for label, path, config in state["consumers"]:
        if config:
            say(f"  {pad(label)}: {config.get('project') or '?'} / {config.get('location') or '?'}")
        else:
            say(f"  {pad(label)}: (파일 없음 또는 못 읽음) {path}")


def diagnose(project_id: str, token: str) -> list[str]:
    """바꾸기 전에 막힐 만한 것을 미리 다 본다. 문제 목록을 돌려준다."""
    problems: list[str] = []
    number, error = project_number(token, project_id)
    if not number:
        problems.append(
            f"이 계정으로는 프로젝트 {project_id} 에 접근할 수 없습니다.\n"
            f"      사유: {error}\n"
            f"      그 프로젝트를 소유한 계정으로 바꾸려면:  python {os.path.basename(__file__)} --login"
        )
        return problems

    say(f"  프로젝트 번호  : {number}")

    # 결제 조회에는 할당량 헤더를 붙이지 않는다.
    # 붙이면 그 프로젝트에 Cloud Billing API 까지 켜져 있어야 해서, 정작 멀쩡한
    # 프로젝트가 "확인 불가" 로 막힌다(실측 2026-09-04, 이 도구 첫 시험에서 겪음).
    status, billing = api_get(
        f"https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo", token
    )
    if status != 200:
        # **확인 못 한 것을 차단 사유로 쓰지 않는다.** 진짜 증거는 마지막 실제 생성이다.
        # 여기서 막으면 되는 프로젝트를 못 쓰게 된다.
        say(f"  결제           : 확인 못 함(계속 진행합니다) - {str(billing)[:120]}")
    elif not billing.get("billingEnabled"):
        problems.append(
            f"결제가 꺼져 있습니다. 이 상태로는 이미지 생성이 전부 403 으로 막힙니다.\n"
            f"      https://console.developers.google.com/billing/enable?project={project_id}"
        )
    else:
        say(f"  결제           : 켜짐 ({billing.get('billingAccountName', '')})")

    status, service = api_get(
        f"https://serviceusage.googleapis.com/v1/projects/{number}/services/aiplatform.googleapis.com",
        token, project_id,
    )
    state = str(service.get("state") or "")
    say(f"  Vertex AI API  : {state or '확인 실패'}")
    if status == 200 and state != "ENABLED":
        say("    -> 꺼져 있어 켭니다...")
        code, result = api_post(
            f"https://serviceusage.googleapis.com/v1/projects/{number}/services/aiplatform.googleapis.com:enable",
            token, {}, project_id, timeout=120,
        )
        if code != 200:
            problems.append(f"Vertex AI API 를 켜지 못했습니다: {str(result)[:200]}")
        else:
            say("    -> 켰습니다")
    elif status != 200:
        problems.append(f"Vertex AI API 상태를 확인하지 못했습니다: {str(service)[:200]}")

    return problems


def verify_generation() -> tuple[bool, str]:
    """실제로 한 장 만들어 본다. 여기까지 통과해야 '된다' 고 말할 수 있다."""
    payload = {
        "model": IMAGE_MODEL,
        "contents": [{"role": "user", "parts": [{"text": "A plain white square. Minimal test image."}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(f"{BACKEND_BASE}/api/gemini/generate-content", data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(raw or "{}")
            reasons = [
                str(item.get("reason"))
                for item in ((detail.get("error") or {}).get("details") or [])
                if isinstance(item, dict) and item.get("reason")
            ]
            message = str((detail.get("error") or {}).get("message") or raw)[:300]
            return False, f"HTTP {error.code} · {' / '.join(reasons) or '사유 없음'} · {message}"
        except json.JSONDecodeError:
            return False, f"HTTP {error.code} · {raw[:300]}"
    except Exception as error:  # noqa: BLE001
        return False, f"{error.__class__.__name__}: {error}"

    for part in ((body.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            size_kb = len(inline["data"]) * 3 / 4 / 1024
            return True, f"{inline.get('mimeType') or inline.get('mime_type') or '?'} · 약 {size_kb:.0f}KB"
    return False, f"이미지가 없습니다: {json.dumps(body)[:300]}"


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("project", nargs="?", help="갈아끼울 Vertex 프로젝트 ID")
    parser.add_argument("--location", default="global", help="리전 (기본 global)")
    parser.add_argument("--status", action="store_true", help="지금 상태만 본다. 아무것도 안 바꾼다")
    parser.add_argument("--login", action="store_true", help="다른 구글 계정으로 다시 인증한다")
    parser.add_argument("--no-verify", action="store_true", help="마지막 실제 생성 확인을 건너뛴다(요금 안 나감)")
    options = parser.parse_args()

    if options.login:
        say("브라우저가 열립니다. 그 프로젝트를 소유한 계정을 고르고 허용해 주세요.")
        code, out = run(["gcloud", "auth", "application-default", "login", "--launch-browser"], timeout=600)
        say(out.strip()[-500:])
        if code != 0:
            say("[실패] 로그인이 끝나지 않았습니다.")
            return 1
        say("[완료] 이제 프로젝트 ID 를 주고 다시 실행해주세요.")
        return 0

    state = describe_state()
    print_state(state)

    if options.status or not options.project:
        if not options.project and not options.status:
            say("")
            say("바꾸려면 프로젝트 ID 를 주세요. 예:")
            say(f"  python {os.path.basename(__file__)} project-xxxxxxxx-xxxx-xxxx-xxx")
        return 0

    if not state["token"]:
        say("[실패] gcloud 인증 토큰을 받지 못했습니다. --login 으로 먼저 인증해주세요.")
        return 1

    token = access_token()
    project = options.project.strip()
    say("")
    say(f"── {project} 로 갈아끼웁니다 ──")

    problems = diagnose(project, token)
    if problems:
        say("")
        say("[중단] 바꾸기 전에 막히는 것이 있습니다. 설정은 손대지 않았습니다.")
        for problem in problems:
            say(f"  - {problem}")
        return 1

    previous = [(label, path, read_consumer(path)) for label, path in CONSUMERS]

    code, out = run(["gcloud", "auth", "application-default", "set-quota-project", project], timeout=90)
    say(f"  할당량 프로젝트: {'지정 완료' if code == 0 else '실패 - ' + out.strip()[:160]}")

    failures = []
    for label, path in CONSUMERS:
        error = write_consumer(path, project, options.location)
        say(f"  {pad(label)}설정: {'저장 완료' if not error else '실패 - ' + error}")
        if error:
            failures.append((label, error))
    if failures:
        say("[중단] 설정 파일을 다 쓰지 못했습니다. 되돌립니다.")
        for label, path, config in previous:
            if config:
                write_consumer(path, str(config.get("project") or ""), str(config.get("location") or "global"))
        return 1

    if options.no_verify:
        say("")
        say("[주의] 확인 생성을 건너뛰었습니다. 실제로 되는지는 아직 모릅니다.")
        say("       한 장 만들어 확인하려면 --no-verify 없이 다시 실행하세요.")
        return 0

    say("  실제 생성 확인 : 한 장 만들어 봅니다(요금이 조금 나갑니다)...")
    ok, detail = verify_generation()
    if ok:
        say(f"  실제 생성 확인 : 성공 ({detail})")
        say("")
        say(f"[완료] 이제 {project} 로 이미지가 생성됩니다. 재시작 없이 바로 쓰실 수 있습니다.")
        return 0

    say(f"  실제 생성 확인 : 실패 ({detail})")
    say("  -> 이전 설정으로 되돌립니다.")
    for label, path, config in previous:
        if config:
            write_consumer(path, str(config.get("project") or ""), str(config.get("location") or "global"))
            say(f"     {label}: {config.get('project')} 로 복구")
    say("")
    say("[실패] 갈아끼우지 못했습니다. 위 사유를 보고 결제나 권한을 확인해주세요.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
