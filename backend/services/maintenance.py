"""
Background disk retention for generated images and old last-work backups.

Automatic deletion is opt-in. The default preserves generated images, recovery files,
uploads, and the local archive without age-based cleanup.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from config import Config


def _as_bool(value, default=True):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _as_int(value, default, min_v=0, max_v=3650):
    try:
        n = int(str(value).strip())
    except Exception:
        n = default
    return max(min_v, min(max_v, n))


def _delete_older_files(root: Path, days: int, patterns=None, keep_names=None):
    """Delete files under root older than days. Returns (count, bytes)."""
    if days <= 0 or not root.exists():
        return 0, 0
    cutoff = datetime.now() - timedelta(days=days)
    keep = set(keep_names or [])
    count = 0
    total = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.name in keep:
            continue
        if patterns:
            if not any(path.match(p) or path.name.endswith(p.replace("*", "")) for p in patterns):
                # simple suffix/glob: if pattern starts with * use endswith
                ok = False
                for p in patterns:
                    if p.startswith("*") and path.name.endswith(p[1:]):
                        ok = True
                        break
                    if path.name == p:
                        ok = True
                        break
                if not ok:
                    continue
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
        except OSError:
            continue
        if mtime >= cutoff:
            continue
        try:
            size = path.stat().st_size
            path.unlink(missing_ok=True)
            count += 1
            total += size
        except OSError:
            continue
    return count, total


_LAST_WORK_LIVE_NAMES = {"pdp-last-work.json", "pdp-last-work.bak.json"}
_LAST_WORK_SCOPED_DIRNAME = "pdp-last-work-scoped"


def _last_work_backup_candidates(local_dir: Path):
    """지워도 되는 last-work 백업만 고른다. 살아 있는 저장본(복원에 쓰는 것)은 절대 안 돌려준다.

    - 상태 폴더 바로 아래: pdp-last-work.<날짜꼬리>.json 같은 날짜 백업. 라이브 두 개는 제외.
    - pdp-last-work-scoped/ 아래: <해시>.bak.json 만. <해시>.json 은 작업별 라이브 저장본이라 제외.

    왜 (묶음 G6 빠진 것 #1, 실측 2026-09-02): 예전 glob("pdp-last-work*.json") 은 하위 폴더를
    내려가지 않아 scoped 아래 .bak.json 3,819개(전체 8,227 파일)가 영영 안 지워졌다.
    """
    for path in local_dir.glob("pdp-last-work*.json"):
        if not path.is_file() or path.name in _LAST_WORK_LIVE_NAMES:
            continue
        yield path
    scoped = local_dir / _LAST_WORK_SCOPED_DIRNAME
    if scoped.is_dir():
        for path in scoped.rglob("*.bak.json"):
            if path.is_file():
                yield path


def run_retention_once(log=print):
    generated_days = _as_int(os.getenv("KUASANGSE_GENERATED_RETENTION_DAYS", "30"), 30, 1, 3650)
    lastwork_backup_days = _as_int(os.getenv("KUASANGSE_LASTWORK_BACKUP_RETENTION_DAYS", "14"), 14, 1, 3650)
    recovery_days = _as_int(os.getenv("KUASANGSE_RECOVERY_RETENTION_DAYS", "60"), 60, 1, 3650)

    generated_root = Path(Config.GENERATED_FOLDER)
    # last-work 파일이 실제로 있는 곳은 Config.LOCAL_STATE_FOLDER 다(api_shared._LAST_WORK_PATH 와 같은 기준).
    # 예전엔 backend/.local 을 고정으로 봐서 상태 폴더를 옮긴 런타임에서는 엉뚱한 곳을 청소했다.
    local_dir = Path(Config.LOCAL_STATE_FOLDER)
    recovery_root = Path(Config.LOCAL_ARCHIVE_FOLDER).parent / "recovery"

    g_count, g_bytes = _delete_older_files(generated_root, generated_days)
    # Only backup-like last-work files; never pdp-last-work.json live file
    lw_count, lw_bytes = 0, 0
    if local_dir.exists():
        cutoff = datetime.now() - timedelta(days=lastwork_backup_days)
        for path in _last_work_backup_candidates(local_dir):
            try:
                mtime = datetime.fromtimestamp(path.stat().st_mtime)
                if mtime < cutoff:
                    size = path.stat().st_size
                    path.unlink(missing_ok=True)
                    lw_count += 1
                    lw_bytes += size
            except OSError:
                pass

    r_count, r_bytes = _delete_older_files(recovery_root, recovery_days)

    if g_count or lw_count or r_count:
        log(
            f"[maintenance] retention cleaned "
            f"generated={g_count}({g_bytes/1e6:.1f}MB) "
            f"lastwork_backups={lw_count}({lw_bytes/1e6:.1f}MB) "
            f"recovery={r_count}({r_bytes/1e6:.1f}MB)"
        )
    else:
        log("[maintenance] retention: nothing to clean")
    return {
        "generated": {"count": g_count, "bytes": g_bytes, "days": generated_days},
        "lastwork_backups": {"count": lw_count, "bytes": lw_bytes, "days": lastwork_backup_days},
        "recovery": {"count": r_count, "bytes": r_bytes, "days": recovery_days},
    }


_started = False
_lock = threading.Lock()


def start_maintenance_scheduler():
    global _started
    if not _as_bool(os.getenv("KUASANGSE_MAINTENANCE", "0"), False):
        print("[maintenance] disabled (KUASANGSE_MAINTENANCE=0)", flush=True)
        return
    with _lock:
        if _started:
            return
        _started = True

    def _loop():
        # delay so first requests are not competing with cleanup I/O
        time.sleep(_as_int(os.getenv("KUASANGSE_MAINTENANCE_START_DELAY_SEC", "20"), 20, 0, 600))
        while True:
            try:
                run_retention_once(log=lambda m: print(m, flush=True))
            except Exception as e:
                print(f"[maintenance] error: {e}", flush=True)
            # once per day
            time.sleep(24 * 3600)

    t = threading.Thread(target=_loop, name="kuasangse-maintenance", daemon=True)
    t.start()
    print("[maintenance] scheduler started", flush=True)
