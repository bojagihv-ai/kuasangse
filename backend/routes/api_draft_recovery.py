"""저장 버튼을 누르기 전(draft:) 작업의 **복구용 사본**.

왜 필요한가 - 실측 2026-08-31:
    기존 서버 저장(/api/last-work)은 project: 스코프만 받는다. 프런트가
    `if (!scopeId.startsWith('project:')) return false` 로 조용히 건너뛰고,
    백엔드도 편집권(lease) 검증이 project: 스코프에만 걸려 있어 draft 는 통과할 수 없다.

    그래서 저장을 누르기 전 작업은 **브라우저 안에 사본이 딱 하나**뿐이다.
    이날 주인님이 DB/Cafe24 확정을 잃었을 때 되살릴 사본이 하나도 없었고,
    분석이 왜 실패했는지조차 서버에서 읽을 수 없었다.

이 저장소는 그 그물이다. 편집권을 거치지 않는다 - draft 에는 lease 자체가 없다.
그러므로 **자동으로 복원하지 않는다.** 사람이 되살리기를 누를 때만 쓰는 참고본이다.
last-work 와 파일도 디렉터리도 분리해 두어, 정상 저장 경로를 절대 건드리지 않는다.
"""
import hashlib
import json
import os
import time

from flask import jsonify, request

from .api_shared import Config, api

_DRAFT_RECOVERY_DIR = os.path.join(Config.LOCAL_STATE_FOLDER, "pdp-draft-recovery")

# 한 스코프당 남길 사본 수. 너무 적으면 되살릴 지점이 없고, 너무 많으면 디스크를 먹는다.
_KEEP_PER_SCOPE = 5
# 사람이 만들 수 있는 작업파일 크기의 상한. 이미지 원본은 여기 담지 않는다.
_MAX_BYTES = 24 * 1024 * 1024


def _scope_digest(scope_id: str) -> str:
    return hashlib.sha256(scope_id.encode("utf-8")).hexdigest()


def _scope_dir(scope_id: str) -> str:
    path = os.path.join(_DRAFT_RECOVERY_DIR, _scope_digest(scope_id))
    os.makedirs(path, exist_ok=True)
    return path


def _is_draft_scope(value: str) -> bool:
    return str(value or "").strip().lower().startswith("draft:")


def _entries(scope_id: str):
    directory = os.path.join(_DRAFT_RECOVERY_DIR, _scope_digest(scope_id))
    if not os.path.isdir(directory):
        return []
    rows = []
    for name in os.listdir(directory):
        if not name.endswith(".json"):
            continue
        # savedAt 은 **파일 이름**이 정답이다. 수정시각(mtime)을 쓰면 목록이 알려준 값으로
        # 다시 읽을 수 없다 - 실측 2026-08-31: 목록은 1788182884160 을 줬는데 파일은 다른 이름이라 404.
        stem = name[: -len(".json")]
        if not stem.isdigit():
            continue
        rows.append({"name": name, "path": os.path.join(directory, name), "savedAt": int(stem)})
    rows.sort(key=lambda row: row["savedAt"], reverse=True)
    return rows


def _prune(scope_id: str) -> None:
    for row in _entries(scope_id)[_KEEP_PER_SCOPE:]:
        try:
            os.remove(row["path"])
        except OSError:
            pass


@api.route("/draft-recovery", methods=["POST"])
def save_draft_recovery():
    body = request.get_json(silent=True) or {}
    scope_id = str(body.get("scopeId") or "").strip()
    snapshot = body.get("snapshot")
    if not _is_draft_scope(scope_id):
        # project: 는 정상 저장 경로(/api/last-work)가 편집권까지 검증해 받는다.
        # 여기로 들어오면 그 검증을 우회하는 셈이라 받지 않는다.
        return jsonify({"ok": False, "error": "draft: 스코프만 받습니다."}), 400
    if not isinstance(snapshot, dict):
        return jsonify({"ok": False, "error": "snapshot must be an object"}), 400
    payload = {
        "scopeId": scope_id,
        "savedAt": int(time.time() * 1000),
        "reason": str(body.get("reason") or ""),
        "productName": str(body.get("productName") or ""),
        "snapshot": snapshot,
    }
    encoded = json.dumps(payload, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > _MAX_BYTES:
        return jsonify({"ok": False, "error": "복구본이 너무 큽니다."}), 413
    directory = _scope_dir(scope_id)
    path = os.path.join(directory, f"{payload['savedAt']}.json")
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(encoded)
    os.replace(tmp, path)
    _prune(scope_id)
    return jsonify({"ok": True, "scopeId": scope_id, "savedAt": payload["savedAt"], "kept": len(_entries(scope_id))})


@api.route("/draft-recovery", methods=["GET"])
def list_draft_recovery():
    """되살릴 수 있는 사본 목록. 본문은 주지 않는다 - 사람이 하나를 고른 뒤에 읽는다."""
    scope_id = str(request.args.get("scopeId") or "").strip()
    if not _is_draft_scope(scope_id):
        return jsonify({"ok": False, "error": "draft: 스코프만 받습니다."}), 400
    rows = []
    for row in _entries(scope_id):
        item = {"savedAt": row["savedAt"]}
        try:
            with open(row["path"], "r", encoding="utf-8") as handle:
                stored = json.load(handle)
            item["productName"] = str(stored.get("productName") or "")
            item["reason"] = str(stored.get("reason") or "")
        except (OSError, ValueError):
            item["productName"] = ""
            item["reason"] = "읽을 수 없는 사본"
        rows.append(item)
    return jsonify({"ok": True, "scopeId": scope_id, "entries": rows})


@api.route("/draft-recovery/entry", methods=["GET"])
def read_draft_recovery_entry():
    """사람이 고른 사본 하나를 읽는다. 자동 복원 경로에서는 호출하지 않는다."""
    scope_id = str(request.args.get("scopeId") or "").strip()
    saved_at = str(request.args.get("savedAt") or "").strip()
    if not _is_draft_scope(scope_id):
        return jsonify({"ok": False, "error": "draft: 스코프만 받습니다."}), 400
    if not saved_at.isdigit():
        return jsonify({"ok": False, "error": "savedAt 이 필요합니다."}), 400
    path = os.path.join(_DRAFT_RECOVERY_DIR, _scope_digest(scope_id), f"{saved_at}.json")
    # 경로 조작 방지: 반드시 이 스코프 디렉터리 안이어야 한다.
    root = os.path.realpath(os.path.join(_DRAFT_RECOVERY_DIR, _scope_digest(scope_id)))
    if os.path.realpath(os.path.dirname(path)) != root or not os.path.isfile(path):
        return jsonify({"ok": False, "error": "해당 사본이 없습니다."}), 404
    with open(path, "r", encoding="utf-8") as handle:
        stored = json.load(handle)
    return jsonify({"ok": True, **stored})
