"""
PDP Automation Routes ??/pdp/automation/*
Handles server-side Google Drive automation for image-cuts and detail-page generation.
Uses the browser's OAuth token (driveToken) for all Drive API calls.
"""
import os
import json
import uuid
import time
import threading
import traceback
import copy
import math
import base64
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from services.gemini_service import GeminiService
from services.drive_service import DriveService
from services.sinhwa_service import SinhwaLookupError, attach_sinhwa_context, lookup_sinhwa_product
from services.section_definitions import get_all_sections
from config import Config

auto_bp = Blueprint('automation', __name__)

# ?? ?곸냽 ???寃쎈줈 ????????????????????????????????????????????????
_PROFILES_FILE = os.path.join(os.path.dirname(__file__), '..', '.local', 'pdp-drive-automation.json')
_USAGE_FILE = os.path.join(os.path.dirname(__file__), '..', '.local', 'pdp-usage-meter.json')
_PROFILE_SAVE_DEBOUNCE_SECONDS = 2.0
_USAGE_SAVE_DEBOUNCE_SECONDS = 2.0
DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview'
SUPPORTED_IMAGE_MODELS = {
    DEFAULT_IMAGE_MODEL,
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
}
SUPPORTED_OUTPUT_IMAGE_SIZES = {'1K', '2K', '4K'}
SUPPORTED_LIMIT_BASIS = {'files', 'images'}
DEFAULT_KRW_PER_USD = 1460.0

# Official standard Gemini 3.1 Flash Image Preview output image prices.
# Source: Google Gemini API pricing page. These are estimates only; billing reports are authoritative.
IMAGE_PRICE_USD = {
    'gemini-3.1-flash-image-preview': {
        '0.5K': 0.045,
        '1K': 0.067,
        '2K': 0.101,
        '4K': 0.151,
    },
    'gemini-3-pro-image-preview': {
        '1K': 0.134,
        '2K': 0.134,
        '4K': 0.240,
    },
    'gemini-2.5-flash-image': {
        '1K': 0.039,
        '2K': 0.039,
        '4K': 0.039,
    },
}

# User-facing KRW overrides for the model/resolution combinations we actually use most.
# These take priority over USD x exchange-rate estimates in the app and automation logs.
IMAGE_PRICE_KRW = {
    'gemini-3.1-flash-image-preview': {
        '1K': 110,
        '2K': 160,
    },
}

# ?? In-memory state ??????????????????????????????????????????????
_auto_lock = threading.Lock()
_profile_save_lock = threading.Lock()
_usage_save_lock = threading.Lock()
_last_profile_save_at = 0.0
_last_usage_save_at = 0.0

def _default_automation_progress():
    return {
        'startedAt': None,
        'filesCompleted': 0,
        'cutsGenerated': 0,
        'estimatedKrw': 0,
        'lastStopReason': None,
    }


def _default_profile(mode):
    # 湲곕낯媛믪뿉 ?ㅼ젣 ?대뜑 ID ?ы븿 (理쒖큹 ?ㅽ뻾 ??or ?뚯씪 ?놁쓣 ???ъ슜)
    defaults = {
        'image-cuts': {
            'enabled': False,
            'inputFolderId': '1VRe2u4ewOoizVM8IKysy7BQ1VkaE8FA3',
            'sourceDoneFolderId': '1WYWOd97mOqNfO7evkTRqyx6LjPBaXBf6',
            'outputFolderId': '1SHXhlK_7oPiB2w_0canrG5k9DUseDov9',
            'pollIntervalSeconds': 120,
            'maxFilesPerRun': 1,
            'runLimitBasis': 'files',
            'maxImagesPerRun': 8,
            'stopAfterFiles': 0,
            'stopAfterCuts': 0,
            'stopAfterKrw': 0,
            'automationProgress': _default_automation_progress(),
            'imageModel': DEFAULT_IMAGE_MODEL,
            'outputImageSize': None,
            'customCuts': [
                {'label': '대리석', 'prompt': '대리석 바닥에 제품을 배치한 고급스러운 제품 이미지'},
                *[{'label': '', 'prompt': ''} for _ in range(9)],
            ],
        },
        'detail-page': {
            'enabled': False,
            'inputFolderId': '1o30GGLX3UGHSkwJmCOMEkBdO0SHvZ9rd',
            'sourceDoneFolderId': '1tDqhWiz0gtnxYMRMwgry1vo3D1HLNH22',
            'outputFolderId': '1P2hIJ4h0YnBI-t-uztdNmQyoJbIhwUiH',
            'pollIntervalSeconds': 180,
            'maxFilesPerRun': 1,
            'runLimitBasis': 'files',
            'maxImagesPerRun': 1,
            'stopAfterFiles': 0,
            'stopAfterCuts': 0,
            'stopAfterKrw': 0,
            'automationProgress': _default_automation_progress(),
            'imageModel': DEFAULT_IMAGE_MODEL,
            'outputImageSize': None,
            'sinhwaDbEnabled': False,
        },
    }
    return defaults.get(mode, {
        'enabled': False,
        'inputFolderId': '',
        'sourceDoneFolderId': '',
        'outputFolderId': '',
        'pollIntervalSeconds': 120,
        'maxFilesPerRun': 1,
        'runLimitBasis': 'files',
        'maxImagesPerRun': 1,
        'stopAfterFiles': 0,
        'stopAfterCuts': 0,
        'stopAfterKrw': 0,
        'automationProgress': _default_automation_progress(),
        'imageModel': DEFAULT_IMAGE_MODEL,
        'outputImageSize': None,
        'sinhwaDbEnabled': False,
    })


def _load_profiles_from_file():
    """JSON ?뚯씪?먯꽌 ?꾨줈?뚯씪 濡쒕뱶. ?놁쑝硫?湲곕낯媛?諛섑솚."""
    try:
        if os.path.exists(_PROFILES_FILE):
            with open(_PROFILES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            profiles = data.get('profiles', {})
            # ??紐⑤뱶 紐⑤몢 ?덈뒗吏 ?뺤씤, ?놁쑝硫?湲곕낯媛믪쑝濡?梨꾩?
            for mode in ('image-cuts', 'detail-page'):
                if mode not in profiles:
                    profiles[mode] = _default_profile(mode)
                profiles[mode]['imageModel'] = _normalize_image_model(profiles[mode].get('imageModel'))
                profiles[mode]['outputImageSize'] = _normalize_output_image_size(
                    profiles[mode].get('outputImageSize')
                )
                profiles[mode]['runLimitBasis'] = _normalize_limit_basis(profiles[mode].get('runLimitBasis'))
                profiles[mode]['maxFilesPerRun'] = _bounded_int(profiles[mode].get('maxFilesPerRun'), 1, 1, 20)
                profiles[mode]['maxImagesPerRun'] = _bounded_int(profiles[mode].get('maxImagesPerRun'), 1, 1, 200)
                profiles[mode]['sinhwaDbEnabled'] = str(
                    profiles[mode].get('sinhwaDbEnabled') or ''
                ).strip().lower() in {'1', 'true', 'yes', 'on'}
                _normalize_profile_limits(profiles[mode])
            return profiles
    except Exception as e:
        print(f'[automation] Failed to load profile file: {e}', flush=True)
    return {
        'image-cuts': _normalize_profile_limits(_default_profile('image-cuts')),
        'detail-page': _normalize_profile_limits(_default_profile('detail-page')),
    }


def _atomic_json_dump(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f'{path}.{uuid.uuid4().hex}.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _should_flush_save(kind, debounce_seconds, force=False):
    if force:
        return True
    now = time.monotonic()
    global _last_profile_save_at, _last_usage_save_at
    if kind == 'profiles':
        with _profile_save_lock:
            if now - _last_profile_save_at < debounce_seconds:
                return False
            _last_profile_save_at = now
            return True
    with _usage_save_lock:
        if now - _last_usage_save_at < debounce_seconds:
            return False
        _last_usage_save_at = now
        return True


def _save_profiles_to_file(profiles, force=False):
    """JSON ?뚯씪???꾨줈?뚯씪 ???"""
    if not _should_flush_save('profiles', _PROFILE_SAVE_DEBOUNCE_SECONDS, force=force):
        return
    try:
        _atomic_json_dump(_PROFILES_FILE, {'profiles': profiles})
    except Exception as e:
        print(f'[automation] Failed to save profile file: {e}', flush=True)


def _normalize_image_model(model):
    model = (model or '').strip()
    if model in SUPPORTED_IMAGE_MODELS:
        return model
    if not model:
        return DEFAULT_IMAGE_MODEL
    return DEFAULT_IMAGE_MODEL


def _normalize_output_image_size(value):
    size = str(value or '').strip().upper()
    return size if size in SUPPORTED_OUTPUT_IMAGE_SIZES else None


def _normalize_limit_basis(value):
    basis = str(value or '').strip().lower()
    return basis if basis in SUPPORTED_LIMIT_BASIS else 'files'


def _bounded_int(value, fallback, min_value, max_value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = fallback
    return max(min_value, min(max_value, n))


def _normalize_automation_progress(value):
    progress = _default_automation_progress()
    if isinstance(value, dict):
        progress.update({
            'startedAt': value.get('startedAt') or None,
            'lastStopReason': value.get('lastStopReason') or None,
        })
        progress['filesCompleted'] = _bounded_int(value.get('filesCompleted'), 0, 0, 1_000_000)
        progress['cutsGenerated'] = _bounded_int(value.get('cutsGenerated'), 0, 0, 10_000_000)
        progress['estimatedKrw'] = _bounded_int(value.get('estimatedKrw'), 0, 0, 10_000_000_000)
    return progress


def _normalize_profile_limits(profile):
    profile['stopAfterFiles'] = _bounded_int(profile.get('stopAfterFiles'), 0, 0, 1_000_000)
    profile['stopAfterCuts'] = _bounded_int(profile.get('stopAfterCuts'), 0, 0, 10_000_000)
    profile['stopAfterKrw'] = _bounded_int(profile.get('stopAfterKrw'), 0, 0, 10_000_000_000)
    profile['automationProgress'] = _normalize_automation_progress(profile.get('automationProgress'))
    return profile


def _normalize_cost_resolution(value):
    size = str(value or '').strip().upper()
    if size in ('512', '0.5K'):
        return '0.5K'
    if size in ('1K', '2K', '4K'):
        return size
    return '1K'


def _unit_image_usd(model, resolution):
    price_table = IMAGE_PRICE_USD.get(model) or IMAGE_PRICE_USD.get(DEFAULT_IMAGE_MODEL)
    resolution = _normalize_cost_resolution(resolution)
    return float(price_table.get(resolution) or price_table.get('1K') or 0.0)


def _unit_image_prices(model, resolution, krw_per_usd):
    resolution = _normalize_cost_resolution(resolution)
    krw_table = IMAGE_PRICE_KRW.get(model) or {}
    if resolution in krw_table:
        unit_krw = int(krw_table[resolution])
        unit_usd = round(unit_krw / float(krw_per_usd or DEFAULT_KRW_PER_USD), 6)
        return unit_usd, unit_krw
    unit_usd = _unit_image_usd(model, resolution)
    unit_krw = int(round(unit_usd * float(krw_per_usd or DEFAULT_KRW_PER_USD)))
    return unit_usd, unit_krw


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _make_usage_meter():
    now = _utc_now_iso()
    return {
        'startedAt': now,
        'lastUpdatedAt': now,
        'krwPerUsd': DEFAULT_KRW_PER_USD,
        'source': 'Google API pricing estimate + configurable USD/KRW rate',
        'totals': {
            'generatedImages': 0,
            'estimatedUsd': 0.0,
            'estimatedKrw': 0,
            'byResolution': {},
            'byMode': {},
        },
        'events': [],
    }


def _load_usage_meter():
    try:
        if os.path.exists(_USAGE_FILE):
            with open(_USAGE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            base = _make_usage_meter()
            base.update(data if isinstance(data, dict) else {})
            base.setdefault('totals', _make_usage_meter()['totals'])
            base.setdefault('events', [])
            base['krwPerUsd'] = float(base.get('krwPerUsd') or DEFAULT_KRW_PER_USD)
            return base
    except Exception as e:
        print(f'[automation] Failed to load usage meter: {e}', flush=True)
    return _make_usage_meter()


def _save_usage_meter(force=False, payload=None):
    if not _should_flush_save('usage', _USAGE_SAVE_DEBOUNCE_SECONDS, force=force):
        return
    try:
        _atomic_json_dump(_USAGE_FILE, payload if payload is not None else _usage_meter)
    except Exception as e:
        print(f'[automation] Failed to save usage meter: {e}', flush=True)


def _record_image_usage(
    mode,
    model,
    resolution,
    file_name=None,
    output_name=None,
    actual_width=None,
    actual_height=None,
    force_save=False,
):
    resolution = _normalize_cost_resolution(resolution)
    model = _normalize_image_model(model)
    payload = None
    with _auto_lock:
        krw_per_usd = float(_usage_meter.get('krwPerUsd') or DEFAULT_KRW_PER_USD)
        unit_usd, unit_krw = _unit_image_prices(model, resolution, krw_per_usd)
        totals = _usage_meter.setdefault('totals', {})
        totals['generatedImages'] = int(totals.get('generatedImages') or 0) + 1
        totals['estimatedUsd'] = round(float(totals.get('estimatedUsd') or 0.0) + unit_usd, 6)
        totals['estimatedKrw'] = int(totals.get('estimatedKrw') or 0) + unit_krw
        by_resolution = totals.setdefault('byResolution', {})
        res_item = by_resolution.setdefault(resolution, {'count': 0, 'usd': 0.0, 'krw': 0})
        res_item['count'] = int(res_item.get('count') or 0) + 1
        res_item['usd'] = round(float(res_item.get('usd') or 0.0) + unit_usd, 6)
        res_item['krw'] = int(res_item.get('krw') or 0) + unit_krw
        by_mode = totals.setdefault('byMode', {})
        mode_item = by_mode.setdefault(mode, {'count': 0, 'usd': 0.0, 'krw': 0})
        mode_item['count'] = int(mode_item.get('count') or 0) + 1
        mode_item['usd'] = round(float(mode_item.get('usd') or 0.0) + unit_usd, 6)
        mode_item['krw'] = int(mode_item.get('krw') or 0) + unit_krw
        event = {
            'timestamp': _utc_now_iso(),
            'mode': mode,
            'model': model,
            'resolution': resolution,
            'unitUsd': unit_usd,
            'unitKrw': unit_krw,
        }
        if file_name:
            event['fileName'] = file_name
        if output_name:
            event['outputName'] = output_name
        if actual_width and actual_height:
            event['actualWidth'] = int(actual_width)
            event['actualHeight'] = int(actual_height)
            event['actualPixels'] = f'{int(actual_width)}x{int(actual_height)}'
        events = _usage_meter.setdefault('events', [])
        events.insert(0, event)
        if len(events) > 1000:
            del events[1000:]
        _usage_meter['lastUpdatedAt'] = event['timestamp']
        payload = copy.deepcopy(_usage_meter)
    _save_usage_meter(force=force_save, payload=payload)
    return unit_usd, unit_krw


_auto_config = {
    'profiles': _load_profiles_from_file()
}

_usage_meter = _load_usage_meter()

_auto_status = {
    'byMode': {
        'image-cuts': {
            'isRunning': False,
            'lastError': None,
            'lastSummary': None,
            'lastStartedAt': None,
            'autoStoppedAt': None,
            'drainStopRequested': False,
            'limitStopReason': None,
            'progress': _normalize_automation_progress(
                _auto_config['profiles'].get('image-cuts', {}).get('automationProgress')
            ),
        },
        'detail-page': {
            'isRunning': False,
            'lastError': None,
            'lastSummary': None,
            'lastStartedAt': None,
            'autoStoppedAt': None,
            'drainStopRequested': False,
            'limitStopReason': None,
            'progress': _normalize_automation_progress(
                _auto_config['profiles'].get('detail-page', {}).get('automationProgress')
            ),
        },
    },
    'recentEvents': [],
}

_scheduler_lock = threading.Lock()
_scheduler_started = False
_scheduler_last_run_at = {}
SCHEDULER_TICK_SECONDS = 5

# ?? ?꾩뿭 Rate Limiter (?ㅻ젅??怨듭쑀) ???????????????????????????????
_image_api_call_lock = threading.Lock()
_image_api_last_call_at = 0.0
# Adaptive gap: base interval, expands after 429, shrinks slowly after success.
# Defaults keep previous sequential safety (concurrency=1). Optional KUASANGSE_IMAGE_API_CONCURRENCY=2.
try:
    _IMAGE_API_MIN_GAP_BASE = float(os.environ.get('KUASANGSE_IMAGE_API_MIN_GAP', '28') or 28)
except Exception:
    _IMAGE_API_MIN_GAP_BASE = 28.0
_IMAGE_API_MIN_GAP_BASE = max(8.0, min(120.0, _IMAGE_API_MIN_GAP_BASE))
_IMAGE_API_MIN_GAP = _IMAGE_API_MIN_GAP_BASE
try:
    _IMAGE_API_CONCURRENCY = int(os.environ.get('KUASANGSE_IMAGE_API_CONCURRENCY', '1') or 1)
except Exception:
    _IMAGE_API_CONCURRENCY = 1
_IMAGE_API_CONCURRENCY = max(1, min(3, _IMAGE_API_CONCURRENCY))
_image_api_semaphore = threading.Semaphore(_IMAGE_API_CONCURRENCY)


def _image_api_note_success():
    """Slightly recover toward base gap after successful image call."""
    global _IMAGE_API_MIN_GAP
    with _image_api_call_lock:
        if _IMAGE_API_MIN_GAP > _IMAGE_API_MIN_GAP_BASE:
            _IMAGE_API_MIN_GAP = max(_IMAGE_API_MIN_GAP_BASE, _IMAGE_API_MIN_GAP * 0.85)


def _image_api_note_rate_limit():
    """Back off after 429 so we do not hammer the API."""
    global _IMAGE_API_MIN_GAP
    with _image_api_call_lock:
        _IMAGE_API_MIN_GAP = min(120.0, max(_IMAGE_API_MIN_GAP * 1.5, _IMAGE_API_MIN_GAP_BASE * 1.5))


def _image_api_rate_wait(mode=None):
    """Global min gap between image API starts. Lock held briefly; sleep outside lock."""
    global _image_api_last_call_at
    while True:
        with _image_api_call_lock:
            now = time.time()
            gap = now - _image_api_last_call_at
            need = _IMAGE_API_MIN_GAP
            if gap >= need:
                _image_api_last_call_at = time.time()
                return True
            wait_needed = need - gap
        slept = 0.0
        while slept < wait_needed:
            if mode and _is_cancelled(mode):
                return False
            chunk = min(1.0, wait_needed - slept)
            time.sleep(chunk)
            slept += chunk

# ?? Cancel ?뚮옒洹??????????????????????????????????????????????????
_cancel_flags = {'image-cuts': False, 'detail-page': False}
_drain_stop_flags = {'image-cuts': False, 'detail-page': False}

def _is_cancelled(mode):
    with _auto_lock:
        return _cancel_flags.get(mode, False)

def _set_cancel(mode, value):
    with _auto_lock:
        _cancel_flags[mode] = value


def _set_drain_stop(mode, value):
    with _auto_lock:
        _drain_stop_flags[mode] = value
        _auto_status['byMode'][mode]['drainStopRequested'] = value


def _sync_status_progress_locked(mode):
    profile = _auto_config['profiles'].get(mode, {})
    _auto_status['byMode'][mode]['progress'] = copy.deepcopy(
        _normalize_automation_progress(profile.get('automationProgress'))
    )


def _reset_automation_progress_locked(mode):
    progress = _default_automation_progress()
    progress['startedAt'] = _now_iso()
    _auto_config['profiles'][mode]['automationProgress'] = progress
    _auto_status['byMode'][mode]['progress'] = copy.deepcopy(progress)
    _auto_status['byMode'][mode]['limitStopReason'] = None
    _auto_status['byMode'][mode]['autoStoppedAt'] = None


def _stop_limit_reason_locked(mode, next_cut_krw=0):
    profile = _auto_config['profiles'].get(mode, {})
    progress = _normalize_automation_progress(profile.get('automationProgress'))
    stop_files = _bounded_int(profile.get('stopAfterFiles'), 0, 0, 1_000_000)
    stop_cuts = _bounded_int(profile.get('stopAfterCuts'), 0, 0, 10_000_000)
    stop_krw = _bounded_int(profile.get('stopAfterKrw'), 0, 0, 10_000_000_000)
    if stop_files and progress['filesCompleted'] >= stop_files:
        return f'사진 {stop_files}장 완료 제한에 도달했습니다.'
    if stop_cuts and progress['cutsGenerated'] >= stop_cuts:
        return f'총 cut {stop_cuts}장 생성 제한에 도달했습니다.'
    if stop_krw and progress['estimatedKrw'] >= stop_krw:
        return f'예상 비용 {stop_krw:,}원 제한에 도달했습니다.'
    if next_cut_krw and stop_krw and progress['estimatedKrw'] + int(next_cut_krw) > stop_krw:
        return (
            f'다음 cut 예상 비용까지 더하면 {stop_krw:,}원 제한을 넘어서 '
            f'자동화를 멈췄습니다.'
        )
    return None


def _disable_mode_for_limit(mode, reason):
    save_profiles = None
    with _auto_lock:
        if mode not in _auto_config['profiles']:
            return
        _auto_config['profiles'][mode]['enabled'] = False
        _cancel_flags[mode] = True
        progress = _normalize_automation_progress(
            _auto_config['profiles'][mode].get('automationProgress')
        )
        progress['lastStopReason'] = reason
        _auto_config['profiles'][mode]['automationProgress'] = progress
        _auto_status['byMode'][mode]['limitStopReason'] = reason
        _auto_status['byMode'][mode]['autoStoppedAt'] = _now_iso()
        _sync_status_progress_locked(mode)
        save_profiles = copy.deepcopy(_auto_config['profiles'])
    if save_profiles is not None:
        _save_profiles_to_file(save_profiles, force=True)
    _add_event(mode, 'info', f'자동 종료: {reason}')


def _increment_automation_progress(mode, files=0, cuts=0, krw=0):
    save_profiles = None
    progress = None
    with _auto_lock:
        if mode not in _auto_config['profiles']:
            return None
        progress = _normalize_automation_progress(
            _auto_config['profiles'][mode].get('automationProgress')
        )
        if not progress.get('startedAt'):
            progress['startedAt'] = _now_iso()
        progress['filesCompleted'] += int(files or 0)
        progress['cutsGenerated'] += int(cuts or 0)
        progress['estimatedKrw'] += int(krw or 0)
        _auto_config['profiles'][mode]['automationProgress'] = progress
        _sync_status_progress_locked(mode)
        save_profiles = copy.deepcopy(_auto_config['profiles'])
    if save_profiles is not None:
        _save_profiles_to_file(save_profiles)
    return progress


def _now_iso():
    return _utc_now_iso()


def _profile_interval_seconds(profile):
    try:
        seconds = int(profile.get('pollIntervalSeconds') or 120)
    except (TypeError, ValueError):
        seconds = 120
    return max(30, min(3600, seconds))


def _truthy(value):
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)


def _image_dimensions_from_bytes(data):
    """Return (width, height) for common generated image formats without extra deps."""
    try:
        if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24:
            return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')

        if data.startswith(b'\xff\xd8'):
            idx = 2
            while idx + 9 < len(data):
                if data[idx] != 0xFF:
                    idx += 1
                    continue
                marker = data[idx + 1]
                idx += 2
                if marker in (0xD8, 0xD9):
                    continue
                if idx + 2 > len(data):
                    break
                seg_len = int.from_bytes(data[idx:idx + 2], 'big')
                if seg_len < 2 or idx + seg_len > len(data):
                    break
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    height = int.from_bytes(data[idx + 3:idx + 5], 'big')
                    width = int.from_bytes(data[idx + 5:idx + 7], 'big')
                    return width, height
                idx += seg_len

        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            chunk = data[12:16]
            if chunk == b'VP8X' and len(data) >= 30:
                width = 1 + int.from_bytes(data[24:27], 'little')
                height = 1 + int.from_bytes(data[27:30], 'little')
                return width, height
            if chunk == b'VP8 ' and len(data) >= 30:
                width = int.from_bytes(data[26:28], 'little') & 0x3FFF
                height = int.from_bytes(data[28:30], 'little') & 0x3FFF
                return width, height
            if chunk == b'VP8L' and len(data) >= 25:
                bits = int.from_bytes(data[21:25], 'little')
                width = (bits & 0x3FFF) + 1
                height = ((bits >> 14) & 0x3FFF) + 1
                return width, height
    except Exception:
        return None
    return None


def _add_event(mode, level, message, file_name=None):
    event = {
        'mode': mode,
        'level': level,
        'message': message,
        'timestamp': _now_iso(),
    }
    if file_name:
        event['fileName'] = file_name
    with _auto_lock:
        _auto_status['recentEvents'].insert(0, event)
        if len(_auto_status['recentEvents']) > 200:
            _auto_status['recentEvents'] = _auto_status['recentEvents'][:200]


def _probe_drive():
    """ADC濡?Drive ?곌껐 ?곹깭 ?뺤씤."""
    try:
        svc = DriveService()
        return svc.probe()
    except Exception as e:
        return {
            'ready': False,
            'accountEmail': None,
            'message': f'Drive 연결 실패: {e}',
        }


def _full_response(probe_drive=False):
    """Build the JSON response body that the frontend expects."""
    drive_conn = _probe_drive() if probe_drive else {
        'ready': True,
        'message': 'ADC 인증 사용 중 (gcloud application-default credentials)',
    }
    with _auto_lock:
        import copy
        return {
            'ok': True,
            'profiles': copy.deepcopy(_auto_config['profiles']),
            'status': copy.deepcopy(_auto_status),
            'usageMeter': copy.deepcopy(_usage_meter),
            'pricing': {
                'krwPerUsd': float(_usage_meter.get('krwPerUsd') or DEFAULT_KRW_PER_USD),
                'imagePriceUsd': copy.deepcopy(IMAGE_PRICE_USD),
                'imagePriceKrw': copy.deepcopy(IMAGE_PRICE_KRW),
            },
            'driveConnection': drive_conn,
        }


# ?? Config endpoints ?????????????????????????????????????????????

@auto_bp.route('/automation/config', methods=['GET'])
def get_config():
    _ensure_scheduler_started()
    return jsonify(_full_response(probe_drive=True))


@auto_bp.route('/automation/config', methods=['PUT'])
def put_config():
    body = request.get_json(silent=True) or {}
    enabled_events = []
    stop_requests = set()
    with _auto_lock:
        for mode, patch in (body.get('profiles') or {}).items():
            if mode in _auto_config['profiles'] and isinstance(patch, dict):
                was_enabled = _truthy(_auto_config['profiles'][mode].get('enabled'))
                enabled_requested = 'enabled' in patch
                requested_enabled = _truthy(patch.get('enabled')) if enabled_requested else None
                if 'enabled' in patch:
                    patch = {**patch, 'enabled': requested_enabled}
                _auto_config['profiles'][mode].update(patch)
                _auto_config['profiles'][mode]['imageModel'] = _normalize_image_model(
                    _auto_config['profiles'][mode].get('imageModel')
                )
                _auto_config['profiles'][mode]['outputImageSize'] = _normalize_output_image_size(
                    _auto_config['profiles'][mode].get('outputImageSize')
                )
                _auto_config['profiles'][mode]['runLimitBasis'] = _normalize_limit_basis(
                    _auto_config['profiles'][mode].get('runLimitBasis')
                )
                _auto_config['profiles'][mode]['maxFilesPerRun'] = _bounded_int(
                    _auto_config['profiles'][mode].get('maxFilesPerRun'), 1, 1, 20
                )
                _auto_config['profiles'][mode]['maxImagesPerRun'] = _bounded_int(
                    _auto_config['profiles'][mode].get('maxImagesPerRun'), 1, 1, 200
                )
                _auto_config['profiles'][mode]['sinhwaDbEnabled'] = _truthy(
                    _auto_config['profiles'][mode].get('sinhwaDbEnabled')
                )
                _normalize_profile_limits(_auto_config['profiles'][mode])
                is_enabled = _truthy(_auto_config['profiles'][mode].get('enabled'))
                if is_enabled != was_enabled:
                    enabled_events.append((mode, is_enabled))
                    if is_enabled:
                        _reset_automation_progress_locked(mode)
                        _scheduler_last_run_at[mode] = 0
                        _drain_stop_flags[mode] = False
                        _auto_status['byMode'][mode]['drainStopRequested'] = False
                    else:
                        _drain_stop_flags[mode] = False
                        _auto_status['byMode'][mode]['drainStopRequested'] = False
                else:
                    _sync_status_progress_locked(mode)
                if enabled_requested and requested_enabled is False:
                    stop_requests.add(mode)
                    _drain_stop_flags[mode] = False
                    _auto_status['byMode'][mode]['drainStopRequested'] = False
        _save_profiles_to_file(_auto_config['profiles'], force=True)
    for mode, is_enabled in enabled_events:
        _add_event(mode, 'info', '자동화가 켜졌습니다.' if is_enabled else '자동화가 꺼졌습니다.')
        if not is_enabled:
            # 痍⑥냼 ?좏샇留?蹂대깂 ??isRunning? ?곕젅?쒓? ?ㅼ젣 醫낅즺????_finish_mode?먯꽌 ?댁젣
            # (利됱떆 False濡?諛붽씀硫???run??以묐났 ?쒖옉?섎뒗 踰꾧렇 諛쒖깮)
            _set_cancel(mode, True)
    for mode in stop_requests:
        _set_cancel(mode, True)
        if not any(event_mode == mode and not is_enabled for event_mode, is_enabled in enabled_events):
            _add_event(mode, 'info', '자동화 중지를 요청했습니다.')
    _ensure_scheduler_started()
    return jsonify(_full_response())


@auto_bp.route('/automation/status', methods=['GET'])
def get_status():
    _ensure_scheduler_started()
    with _auto_lock:
        import copy
        return jsonify({
            'ok': True,
            'profiles': copy.deepcopy(_auto_config['profiles']),
            **copy.deepcopy(_auto_status),
            'usageMeter': copy.deepcopy(_usage_meter),
            'pricing': {
                'krwPerUsd': float(_usage_meter.get('krwPerUsd') or DEFAULT_KRW_PER_USD),
                'imagePriceUsd': copy.deepcopy(IMAGE_PRICE_USD),
                'imagePriceKrw': copy.deepcopy(IMAGE_PRICE_KRW),
            },
        })


@auto_bp.route('/automation/output-images', methods=['GET'])
def get_output_images():
    """Drive에 저장된 최근 자동화 출력 이미지를 앱 안 미리보기용으로 반환."""
    mode = str(request.args.get('mode') or 'image-cuts').strip() or 'image-cuts'
    if mode not in ('image-cuts', 'detail-page'):
        return jsonify({'ok': False, 'error': '지원하지 않는 자동화 모드입니다.'}), 400
    limit = _bounded_int(request.args.get('limit'), 12, 1, 30)
    with _auto_lock:
        profile = copy.deepcopy(_auto_config.get('profiles', {}).get(mode) or {})
    output_folder = str(profile.get('outputFolderId') or '').strip()
    if not output_folder:
        return jsonify({'ok': False, 'error': '결과 출력 폴더 ID가 없습니다.'}), 400
    try:
        drive = DriveService()
        files = drive.list_images(output_folder, page_size=max(limit, 30))
        files.sort(key=lambda item: item.get('createdTime') or '', reverse=True)
        images = []
        for file_info in files[:limit]:
            file_id = file_info.get('id')
            if not file_id:
                continue
            content = drive.download_bytes(file_id)
            mime = file_info.get('mimeType') or 'image/jpeg'
            images.append({
                'id': file_id,
                'name': file_info.get('name') or 'output-image',
                'mime': mime,
                'createdTime': file_info.get('createdTime') or '',
                'size': file_info.get('size') or '',
                'dataUrl': f'data:{mime};base64,{base64.b64encode(content).decode("utf-8")}',
            })
        return jsonify({
            'ok': True,
            'mode': mode,
            'folderId': output_folder,
            'count': len(images),
            'images': images,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@auto_bp.route('/automation/usage/config', methods=['PUT'])
def update_usage_config():
    body = request.get_json(silent=True) or {}
    krw_per_usd = body.get('krwPerUsd')
    try:
        krw_per_usd = float(krw_per_usd)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': '올바른 USD/KRW 환율을 입력해주세요.'}), 400
    if krw_per_usd <= 0:
        return jsonify({'ok': False, 'error': 'USD/KRW 환율은 0보다 커야 합니다.'}), 400
    with _auto_lock:
        _usage_meter['krwPerUsd'] = krw_per_usd
        totals = _usage_meter.setdefault('totals', {})
        totals['estimatedKrw'] = int(round(float(totals.get('estimatedUsd') or 0.0) * krw_per_usd))
        for bucket_name in ('byResolution', 'byMode'):
            for item in totals.get(bucket_name, {}).values():
                item['krw'] = int(round(float(item.get('usd') or 0.0) * krw_per_usd))
        for event in _usage_meter.get('events', []):
            event_model = _normalize_image_model(event.get('model') or DEFAULT_IMAGE_MODEL)
            event_resolution = _normalize_cost_resolution(event.get('resolution') or '1K')
            event['unitUsd'], event['unitKrw'] = _unit_image_prices(event_model, event_resolution, krw_per_usd)
        if _usage_meter.get('events'):
            totals['estimatedUsd'] = round(sum(float(e.get('unitUsd') or 0.0) for e in _usage_meter.get('events', [])), 6)
            totals['estimatedKrw'] = sum(int(e.get('unitKrw') or 0) for e in _usage_meter.get('events', []))
        _usage_meter['lastUpdatedAt'] = _now_iso()
        import copy
        payload = copy.deepcopy(_usage_meter)
    _save_usage_meter(force=True, payload=payload)
    return jsonify({'ok': True, 'usageMeter': payload})


@auto_bp.route('/automation/usage/reset', methods=['POST'])
def reset_usage_meter():
    body = request.get_json(silent=True) or {}
    try:
        krw_per_usd = float(body.get('krwPerUsd') or DEFAULT_KRW_PER_USD)
    except (TypeError, ValueError):
        krw_per_usd = DEFAULT_KRW_PER_USD
    with _auto_lock:
        _usage_meter.clear()
        _usage_meter.update(_make_usage_meter())
        _usage_meter['krwPerUsd'] = krw_per_usd
        import copy
        payload = copy.deepcopy(_usage_meter)
    _save_usage_meter(force=True, payload=payload)
    _add_event('image-cuts', 'info', '비용 계산 기록을 새로 시작했습니다.')
    return jsonify({'ok': True, 'usageMeter': payload})


@auto_bp.route('/automation/usage/record-image', methods=['POST'])
def record_image_usage():
    body = request.get_json(silent=True) or {}
    mode = str(body.get('mode') or 'image-cuts').strip() or 'image-cuts'
    model = _normalize_image_model(body.get('model') or DEFAULT_IMAGE_MODEL)
    resolution = _normalize_cost_resolution(body.get('resolution') or '1K')
    file_name = body.get('fileName')
    output_name = body.get('outputName')
    unit_usd, unit_krw = _record_image_usage(mode, model, resolution, file_name, output_name, force_save=True)
    _add_event(mode, 'info', f'이미지 생성 비용 기록: +{unit_krw:,}원 (${unit_usd:.3f})')
    with _auto_lock:
        import copy
        payload = copy.deepcopy(_usage_meter)
    return jsonify({'ok': True, 'usageMeter': payload})


@auto_bp.route('/automation/stop-after-current', methods=['POST'])
def stop_after_current():
    _ensure_scheduler_started()
    body = request.get_json(silent=True) or {}
    mode = body.get('mode', 'image-cuts')

    if mode not in ('image-cuts', 'detail-page'):
        return jsonify({'ok': False, 'error': f'Unsupported mode: {mode}'}), 400

    save_profiles = None
    with _auto_lock:
        running = bool(_auto_status['byMode'][mode]['isRunning'])
        if running:
            _drain_stop_flags[mode] = True
            _auto_status['byMode'][mode]['drainStopRequested'] = True
            message = '현재 제품 완료 후 정지를 예약했습니다.'
        else:
            _auto_config['profiles'][mode]['enabled'] = False
            _drain_stop_flags[mode] = False
            _auto_status['byMode'][mode]['drainStopRequested'] = False
            save_profiles = copy.deepcopy(_auto_config['profiles'])
            message = '다음 제품 시작 전에 자동화를 껐습니다.'

    if save_profiles is not None:
        _save_profiles_to_file(save_profiles, force=True)
    _add_event(mode, 'info', message)
    return jsonify(_full_response())


@auto_bp.route('/automation/stop', methods=['POST'])
def stop_automation():
    _ensure_scheduler_started()
    body = request.get_json(silent=True) or {}
    requested_mode = body.get('mode', 'image-cuts')

    if requested_mode == 'all':
        modes = ['image-cuts', 'detail-page']
    elif requested_mode in ('image-cuts', 'detail-page'):
        modes = [requested_mode]
    else:
        return jsonify({'ok': False, 'error': f'Unsupported mode: {requested_mode}'}), 400

    stopped = []
    running_modes = []
    with _auto_lock:
        for mode in modes:
            running = bool(_auto_status['byMode'][mode]['isRunning'])
            if running:
                running_modes.append(mode)
            _auto_config['profiles'][mode]['enabled'] = False
            _cancel_flags[mode] = True
            _drain_stop_flags[mode] = False
            _auto_status['byMode'][mode]['drainStopRequested'] = False
            _auto_status['byMode'][mode]['lastSummary'] = (
                '긴급 중지를 요청했습니다. 진행 중인 API 호출이 끝나면 다음 컷으로 넘어가지 않습니다.'
            )
            _scheduler_last_run_at[mode] = time.time()
            stopped.append(mode)
        save_profiles = copy.deepcopy(_auto_config['profiles'])

    _save_profiles_to_file(save_profiles, force=True)
    for mode in stopped:
        if mode in running_modes:
            _add_event(mode, 'warn', '긴급 중지 요청: 진행 중인 API 호출 직후 다음 작업을 차단합니다.')
        else:
            _add_event(mode, 'info', '자동화가 꺼졌습니다.')
    return jsonify(_full_response())


# ?? Run endpoint ??????????????????????????????????????????????????

@auto_bp.route('/automation/run', methods=['POST'])
def run_automation():
    _ensure_scheduler_started()
    body = request.get_json(silent=True) or {}
    mode = body.get('mode', 'image-cuts')
    drive_token = body.get('driveToken', '').strip()
    gemini_key = (body.get('geminiKey') or body.get('gemini_key') or '').strip()
    image_model = body.get('imageModel', '').strip()
    output_image_size = _normalize_output_image_size(body.get('outputImageSize') or body.get('imageSize'))

    if mode not in ('image-cuts', 'detail-page'):
        return jsonify({'ok': False, 'error': f'지원하지 않는 모드입니다: {mode}'}), 400

    # driveToken? ?좏깮 ???놁쑝硫??쒕쾭 ADC ?먮룞 ?ъ슜


    with _auto_lock:
        if _auto_status['byMode'][mode]['isRunning']:
            return jsonify({'ok': False, 'error': f'{mode} 이미 실행 중입니다.'}), 409
        limit_reason = _stop_limit_reason_locked(mode)
        if limit_reason:
            return jsonify({'ok': False, 'error': f'자동 종료 조건에 도달했습니다: {limit_reason}'}), 409
        _cancel_flags[mode] = False
        _drain_stop_flags[mode] = False
        _auto_status['byMode'][mode]['drainStopRequested'] = False
        _auto_status['byMode'][mode]['isRunning'] = True
        _auto_status['byMode'][mode]['lastStartedAt'] = _now_iso()
        _auto_status['byMode'][mode]['lastError'] = None
        _scheduler_last_run_at[mode] = time.time()
        import copy
        profile = copy.deepcopy(_auto_config['profiles'][mode])
        if output_image_size:
            profile['outputImageSize'] = output_image_size

    _add_event(mode, 'info', '즉시 실행을 시작했습니다.')

    t = threading.Thread(
        target=_run_mode,
        args=(mode, profile, drive_token, gemini_key, image_model),
        daemon=True,
    )
    t.start()

    return jsonify({
        'ok': True,
        'message': f'{mode} 실행을 요청했습니다.',
        'status': _full_response()['status'],
    })


# ?? Background run logic ?????????????????????????????????????????

def _finish_mode(mode, summary=None, error=None):
    save_profiles = None
    final_profiles = None
    final_usage = None
    disabled_by_drain = False
    with _auto_lock:
        if _drain_stop_flags.get(mode):
            _auto_config['profiles'][mode]['enabled'] = False
            _drain_stop_flags[mode] = False
            _auto_status['byMode'][mode]['drainStopRequested'] = False
            save_profiles = copy.deepcopy(_auto_config['profiles'])
            disabled_by_drain = True
        _auto_status['byMode'][mode]['isRunning'] = False
        _scheduler_last_run_at[mode] = time.time()
        if summary:
            _auto_status['byMode'][mode]['lastSummary'] = summary
        if error:
            _auto_status['byMode'][mode]['lastError'] = error
        final_profiles = copy.deepcopy(_auto_config['profiles'])
        final_usage = copy.deepcopy(_usage_meter)
    if save_profiles is not None:
        _save_profiles_to_file(save_profiles, force=True)
    else:
        _save_profiles_to_file(final_profiles, force=True)
    _save_usage_meter(force=True, payload=final_usage)
    if disabled_by_drain:
        _add_event(mode, 'info', '현재 제품을 완료했고, 다음 제품 시작 전에 자동화를 껐습니다.')


def _get_gemini_svc(gemini_key, image_model):
    model = _normalize_image_model(image_model or Config.GEMINI_IMAGE_MODEL)
    # Vertex AI 紐⑤뱶硫?API ??遺덊븘????Config?먯꽌 ?먮룞 泥섎━
    if Config.GENAI_USE_VERTEXAI:
        return GeminiService(api_key=None, image_model=model)
    # Gemini Developer API 紐⑤뱶硫????꾩슂
    key = gemini_key or Config.GEMINI_API_KEY
    if not key:
        raise ValueError('Gemini API 키가 없습니다. 모델 설정에서 입력해주세요.')
    return GeminiService(api_key=key, image_model=model)


def _run_mode(mode, profile, drive_token, gemini_key, image_model):
    try:
        if mode == 'image-cuts':
            _run_image_cuts(profile, drive_token, gemini_key, image_model)
        elif mode == 'detail-page':
            _run_detail_page(profile, drive_token, gemini_key, image_model)
    except Exception as e:
        tb = traceback.format_exc()
        _add_event(mode, 'error', f'예외 발생: {e}')
        _finish_mode(mode, error=str(e))
        print(f'[auto-{mode}] EXCEPTION:\n{tb}', flush=True)


def _scheduler_loop():
    while True:
        try:
            jobs = []
            limit_events = []
            now = time.time()
            with _auto_lock:
                import copy
                for mode, profile in _auto_config['profiles'].items():
                    if mode not in ('image-cuts', 'detail-page'):
                        continue
                    if not _truthy(profile.get('enabled')):
                        continue
                    limit_reason = _stop_limit_reason_locked(mode)
                    if limit_reason:
                        _auto_config['profiles'][mode]['enabled'] = False
                        profile['enabled'] = False
                        profile['automationProgress']['lastStopReason'] = limit_reason
                        _auto_status['byMode'][mode]['limitStopReason'] = limit_reason
                        _auto_status['byMode'][mode]['autoStoppedAt'] = _now_iso()
                        _sync_status_progress_locked(mode)
                        _save_profiles_to_file(copy.deepcopy(_auto_config['profiles']), force=True)
                        limit_events.append((mode, limit_reason))
                        continue
                    if _auto_status['byMode'][mode]['isRunning']:
                        continue
                    interval = _profile_interval_seconds(profile)
                    last_run_at = _scheduler_last_run_at.get(mode, 0)
                    if now - last_run_at < interval:
                        continue
                    _scheduler_last_run_at[mode] = now
                    _cancel_flags[mode] = False
                    _drain_stop_flags[mode] = False
                    _auto_status['byMode'][mode]['drainStopRequested'] = False
                    _auto_status['byMode'][mode]['isRunning'] = True
                    _auto_status['byMode'][mode]['lastStartedAt'] = _now_iso()
                    _auto_status['byMode'][mode]['lastError'] = None
                    jobs.append((mode, copy.deepcopy(profile)))

            for mode, reason in limit_events:
                _add_event(mode, 'info', f'자동 종료: {reason}')

            for mode, profile in jobs:
                _add_event(mode, 'info', '예약 실행을 시작했습니다.')
                t = threading.Thread(
                    target=_run_mode,
                    args=(mode, profile, '', '', profile.get('imageModel', '')),
                    daemon=True,
                )
                t.start()
        except Exception as e:
            print(f'[automation] scheduler error: {e}', flush=True)
        time.sleep(SCHEDULER_TICK_SECONDS)


def _ensure_scheduler_started():
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
        t = threading.Thread(
            target=_scheduler_loop,
            name='pdp-automation-scheduler',
            daemon=True,
        )
        t.start()


def start_automation_scheduler():
    _ensure_scheduler_started()


# ?? Image Cuts automation ?????????????????????????????????????????

def _run_image_cuts(profile, drive_token, gemini_key, image_model):
    mode = 'image-cuts'
    input_folder = profile.get('inputFolderId', '').strip()
    done_folder = profile.get('sourceDoneFolderId', '').strip()
    output_folder = profile.get('outputFolderId', '').strip()
    max_files = max(1, min(20, int(profile.get('maxFilesPerRun') or 1)))
    sinhwa_db_enabled = _truthy(profile.get('sinhwaDbEnabled'))
    run_limit_basis = _normalize_limit_basis(profile.get('runLimitBasis'))
    max_images = _bounded_int(profile.get('maxImagesPerRun'), 1, 1, 200)
    output_image_size = _normalize_output_image_size(profile.get('outputImageSize'))
    selected_model = _normalize_image_model(image_model or profile.get('imageModel') or DEFAULT_IMAGE_MODEL)
    _, planned_unit_krw = _unit_image_prices(
        selected_model,
        output_image_size or '1K',
        float(_usage_meter.get('krwPerUsd') or DEFAULT_KRW_PER_USD),
    )
    custom_cuts = profile.get('customCuts') or []
    active_cuts = [c for c in custom_cuts if isinstance(c, dict) and (c.get('prompt') or '').strip()]

    if not input_folder or not output_folder:
        _add_event(mode, 'error', '입력/출력 폴더 ID가 설정되지 않았습니다.')
        _finish_mode(mode, error='Folders not configured')
        return

    if not active_cuts:
        _add_event(mode, 'error', '이미지컷 프롬프트가 최소 1개 필요합니다.')
        _finish_mode(mode, error='No image cut prompts')
        return

    drive = DriveService(drive_token)

    try:
        files = drive.list_images(input_folder)
    except Exception as e:
        _add_event(mode, 'error', f'폴더 조회 실패: {e}')
        _finish_mode(mode, error=str(e))
        return

    with _auto_lock:
        limit_reason = _stop_limit_reason_locked(mode)
        progress = _normalize_automation_progress(_auto_config['profiles'][mode].get('automationProgress'))
        stop_after_files = _bounded_int(_auto_config['profiles'][mode].get('stopAfterFiles'), 0, 0, 1_000_000)
    if limit_reason:
        _disable_mode_for_limit(mode, limit_reason)
        _finish_mode(mode, summary=f'자동 종료 조건 도달: {limit_reason}')
        return

    remaining_files = max_files
    if stop_after_files:
        remaining_files = max(0, min(max_files, stop_after_files - progress['filesCompleted']))
    if remaining_files <= 0:
        reason = f'사진 {stop_after_files}장 완료 제한에 도달했습니다.'
        _disable_mode_for_limit(mode, reason)
        _finish_mode(mode, summary=f'자동 종료 조건 도달: {reason}')
        return

    if run_limit_basis == 'images':
        file_limit = max(1, min(20, math.ceil(max_images / max(1, len(active_cuts)))))
        unprocessed = files[:min(file_limit, remaining_files)]
    else:
        unprocessed = files[:remaining_files]
    if not unprocessed:
        _add_event(mode, 'info', '처리할 이미지가 없습니다.')
        _finish_mode(mode, summary='처리할 파일 없음')
        return

    try:
        svc = _get_gemini_svc(gemini_key, image_model)
    except Exception as e:
        _add_event(mode, 'error', f'Gemini 서비스 초기화 실패: {e}')
        _finish_mode(mode, error=str(e))
        return

    _add_event(mode, 'info', f'출력 이미지 크기: {output_image_size or "API 기본값"}')
    if run_limit_basis == 'images':
        _add_event(mode, 'info', f'생성 이미지 수 기준: 이번 실행 최대 {max_images}장')
    else:
        _add_event(mode, 'info', f'Drive 파일 수 기준: 이번 실행 최대 {max_files}개 파일')

    ok_count = 0
    generated_count = 0
    ok_lock = threading.Lock()

    def _process_file(file, _thread_idx):
        nonlocal ok_count, generated_count
        fname = file.get('name', file.get('id', 'unknown'))
        tmp_path = None
        # ?ㅻ젅?쒕퀎 ?낅┰ GeminiService (last_image_generation_route ?곹깭 異⑸룎 諛⑹?)
        try:
            file_svc = _get_gemini_svc(gemini_key, image_model)
        except Exception as e:
            _add_event(mode, 'error', f'Gemini 서비스 초기화 실패: {e}', fname)
            return
        _add_event(mode, 'info', f'처리 시작: {fname}', fname)
        try:
            img_bytes = drive.download_bytes(file['id'])
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else 'jpg'
            tmp_name = f'auto_src_{uuid.uuid4().hex[:8]}.{ext}'
            tmp_path = os.path.join(Config.UPLOAD_FOLDER, tmp_name)
            with open(tmp_path, 'wb') as fp:
                fp.write(img_bytes)

            base_name = fname.rsplit('.', 1)[0] if '.' in fname else fname
            completed_all_cuts = True

            for i, cut in enumerate(active_cuts, 1):
                if _is_cancelled(mode):
                    _add_event(mode, 'info', f'{fname} 중단됨 (사용자 취소)', fname)
                    return
                with ok_lock:
                    if run_limit_basis == 'images' and generated_count >= max_images:
                        completed_all_cuts = False
                        break
                with _auto_lock:
                    limit_reason = _stop_limit_reason_locked(mode, next_cut_krw=planned_unit_krw)
                if limit_reason:
                    completed_all_cuts = False
                    _disable_mode_for_limit(mode, limit_reason)
                    break
                prompt = cut.get('prompt', '').strip()
                label = cut.get('label') or f'cut{i}'
                cut_id = f'cut{i}'
                proj_id = f'auto_{uuid.uuid4().hex[:6]}'
                full_prompt = (
                    f"{prompt}\n\n"
                    f"Hard requirements for this automation image cut:\n"
                    f"- Generate only one clean product photo-style image.\n"
                    f"- No text in any language.\n"
                    f"- No headline, subtitle, bullet list, badges, captions, labels, CTA, UI cards, infographic panels, or web page layout.\n"
                    f"- Do not create a detail-page section or advertising copy layout.\n"
                    f"- Keep the provided product as the focal point and preserve its shape, color, material, and details.\n"
                    f"- Use the requested background/style naturally."
                )
                try:
                    img_path = None
                    # composite(?쒗뭹 ?대?吏 ?ы븿) 理쒕? 3???ъ떆????section_image fallback ?놁쓬
                    for _attempt in range(3):
                        if _is_cancelled(mode):
                            return
                        try:
                            if not _image_api_rate_wait(mode):
                                return
                            if _is_cancelled(mode):
                                return
                            if not _image_api_semaphore.acquire(timeout=1.0):
                                continue
                            try:
                                img_path = file_svc.generate_composite_image(
                                    full_prompt,
                                    tmp_path,
                                    cut_id,
                                    proj_id,
                                    output_image_size=output_image_size,
                                )
                            finally:
                                _image_api_semaphore.release()
                            _image_api_note_success()
                            break  # success
                        except Exception as ce1:
                            ce1_str = str(ce1)
                            if '429' in ce1_str or 'RESOURCE_EXHAUSTED' in ce1_str or 'exhausted' in ce1_str.lower() or 'quota' in ce1_str.lower():
                                _image_api_note_rate_limit()
                            if _attempt < 2:
                                _add_event(mode, 'info', f'{fname} cut{i} 재시도 {_attempt+1}/3: {ce1}', fname)
                            else:
                                if '429' in ce1_str or 'RESOURCE_EXHAUSTED' in ce1_str or 'exhausted' in ce1_str.lower() or 'quota' in ce1_str.lower():
                                    _add_event(mode, 'warn', f'Vertex AI 할당량 초과 — 자동화를 중단합니다. (잠시 후 재시작하세요)', fname)
                                    _set_cancel(mode, True)
                                    return
                                _add_event(mode, 'error', f'{fname} cut{i} 3회 모두 실패: {ce1}', fname)

                    if img_path:
                        with open(img_path, 'rb') as fp:
                            img_content = fp.read()
                        actual_dims = _image_dimensions_from_bytes(img_content)
                        actual_text = (
                            f'{actual_dims[0]}x{actual_dims[1]}'
                            if actual_dims else 'unknown'
                        )
                        route = getattr(file_svc, 'last_image_generation_route', None) or {}
                        used_model = route.get('model') or file_svc.image_model
                        used_location = route.get('location') or 'unknown'
                        used_size = route.get('image_size') or output_image_size or 'API default'
                        used_aspect = route.get('aspect_ratio') or 'auto'
                        fallback_note = ' (fallback)' if route.get('fallback') else ''
                        _add_event(
                            mode,
                            'info',
                            f'{fname} cut{i} model: {used_model} @ {used_location} / requested {used_size}, aspect {used_aspect} / actual {actual_text}{fallback_note}',
                            fname,
                        )
                        out_name = f'{base_name}_{label}_cut{i}.jpg'
                        try:
                            drive.upload_bytes(output_folder, out_name, img_content, 'image/jpeg')
                        except Exception as ue:
                            ue_str = str(ue)
                            if 'insufficient authentication scopes' in ue_str or 'UNAUTHENTICATED' in ue_str or 'authError' in ue_str:
                                _add_event(mode, 'warn', 'Drive 인증이 만료됐습니다. launcher.bat을 재시작하면 자동으로 재인증됩니다.', fname)
                                _set_cancel(mode, True)
                                return
                            raise ue
                        unit_usd, unit_krw = _record_image_usage(
                            mode,
                            used_model,
                            used_size,
                            fname,
                            out_name,
                            actual_width=actual_dims[0] if actual_dims else None,
                            actual_height=actual_dims[1] if actual_dims else None,
                        )
                        progress = _increment_automation_progress(mode, cuts=1, krw=unit_krw)
                        with ok_lock:
                            generated_count += 1
                        _add_event(mode, 'info', f'{fname} -> {out_name} 업로드 완료 · 실제 {actual_text} · 비용 +{unit_krw:,}원 (${unit_usd:.3f})', fname)
                        with _auto_lock:
                            limit_reason = _stop_limit_reason_locked(mode)
                        if limit_reason:
                            if i < len(active_cuts):
                                completed_all_cuts = False
                            _disable_mode_for_limit(mode, limit_reason)
                            break
                    else:
                        _add_event(mode, 'warn', f'{fname} cut{i} 이미지 생성 결과 없음', fname)
                except Exception as ce:
                    ce_str = str(ce)
                    if '429' in ce_str or 'RESOURCE_EXHAUSTED' in ce_str or 'exhausted' in ce_str.lower() or 'quota' in ce_str.lower():
                        _add_event(mode, 'warn', 'Vertex AI 할당량 초과 — 자동화를 중단합니다. (잠시 후 재시작하세요)', fname)
                        _set_cancel(mode, True)
                        return
                    if 'insufficient authentication scopes' in ce_str or 'UNAUTHENTICATED' in ce_str:
                        _add_event(mode, 'warn', 'Drive 인증이 만료됐습니다. launcher.bat을 재시작하면 자동으로 재인증됩니다.', fname)
                        _set_cancel(mode, True)
                        return
                    _add_event(mode, 'error', f'{fname} cut{i} 오류: {ce}', fname)

            if run_limit_basis == 'images' and not completed_all_cuts:
                _add_event(mode, 'info', f'{fname} 생성 이미지 수 제한 도달로 원본은 입력 폴더에 유지', fname)
            elif done_folder:
                try:
                    drive.move_file(file['id'], done_folder, input_folder)
                    _add_event(mode, 'info', f'{fname} 원본 완료 폴더로 이동', fname)
                except Exception as me:
                    _add_event(mode, 'error', f'{fname} 이동 실패: {me}', fname)

            if completed_all_cuts:
                _increment_automation_progress(mode, files=1)
                with ok_lock:
                    ok_count += 1
                with _auto_lock:
                    limit_reason = _stop_limit_reason_locked(mode)
                if limit_reason:
                    _disable_mode_for_limit(mode, limit_reason)

        except Exception as e:
            _add_event(mode, 'error', f'{fname} 처리 실패: {e}', fname)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    if _IMAGE_API_CONCURRENCY <= 1 or len(unprocessed) <= 1:
        _add_event(mode, 'info', f'이미지 생성 순차 처리 (gap={_IMAGE_API_MIN_GAP_BASE:.0f}s, concurrency=1).')
        for idx, file in enumerate(unprocessed):
            if _is_cancelled(mode):
                break
            _process_file(file, idx)
    else:
        # Optional limited file-level parallelism. Default concurrency stays 1.
        workers = min(_IMAGE_API_CONCURRENCY, len(unprocessed))
        _add_event(
            mode,
            'info',
            f'이미지 생성 제한 병렬 처리 (files={workers}, gap={_IMAGE_API_MIN_GAP_BASE:.0f}s).',
        )
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_process_file, file, idx) for idx, file in enumerate(unprocessed)]
            for fut in as_completed(futures):
                if _is_cancelled(mode):
                    break
                try:
                    fut.result()
                except Exception as e:
                    _add_event(mode, 'error', f'파일 처리 스레드 오류: {e}')

    summary = f'{ok_count}/{len(unprocessed)} 파일 처리 완료 · 이미지 {generated_count}장 생성'
    _add_event(mode, 'info', f'완료: {summary}')
    _finish_mode(mode, summary=summary)


# ?? Detail Page automation ????????????????????????????????????????

def _run_detail_page(profile, drive_token, gemini_key, image_model):
    mode = 'detail-page'
    input_folder = profile.get('inputFolderId', '').strip()
    done_folder = profile.get('sourceDoneFolderId', '').strip()
    output_folder = profile.get('outputFolderId', '').strip()
    max_files = max(1, min(20, int(profile.get('maxFilesPerRun') or 1)))

    if not input_folder or not output_folder:
        _add_event(mode, 'error', '입력/출력 폴더 ID가 설정되지 않았습니다.')
        _finish_mode(mode, error='Folders not configured')
        return

    drive = DriveService(drive_token)

    try:
        files = drive.list_images(input_folder)
    except Exception as e:
        _add_event(mode, 'error', f'폴더 조회 실패: {e}')
        _finish_mode(mode, error=str(e))
        return

    unprocessed = files[:max_files]
    if not unprocessed:
        _add_event(mode, 'info', '처리할 이미지가 없습니다.')
        _finish_mode(mode, summary='처리할 파일 없음')
        return

    try:
        svc = _get_gemini_svc(gemini_key, image_model)
    except Exception as e:
        _add_event(mode, 'error', f'Gemini 서비스 초기화 실패: {e}')
        _finish_mode(mode, error=str(e))
        return

    sections = get_all_sections()

    ok_count = 0
    for file in unprocessed:
        fname = file.get('name', file.get('id', 'unknown'))
        _add_event(mode, 'info', f'처리 시작: {fname}', fname)
        tmp_path = None
        try:
            img_bytes = drive.download_bytes(file['id'])
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else 'jpg'
            tmp_name = f'auto_dp_{uuid.uuid4().hex[:8]}.{ext}'
            tmp_path = os.path.join(Config.UPLOAD_FOLDER, tmp_name)
            with open(tmp_path, 'wb') as fp:
                fp.write(img_bytes)

            # Analyze
            _add_event(mode, 'info', f'{fname} AI 분석 중...', fname)
            analysis = svc.analyze_product_image(tmp_path)
            product_name = (analysis.get('product_name') or fname.rsplit('.', 1)[0])
            _add_event(mode, 'info', f'{fname} 분석 완료: {product_name}', fname)

            if sinhwa_db_enabled:
                _add_event(mode, 'info', f'{fname} 신화사 DB 상품정보 조회 중...', fname)
                try:
                    sinhwa_lookup = lookup_sinhwa_product(file_name=fname, product_name=product_name)
                except SinhwaLookupError as lookup_error:
                    _add_event(
                        mode,
                        'error',
                        f'{fname} DB 참조 실패로 상세페이지 생성을 건너뜁니다: {lookup_error}',
                        fname,
                    )
                    continue
                analysis = attach_sinhwa_context(analysis, sinhwa_lookup)
                product_info = sinhwa_lookup.get('product') or {}
                product_name = product_info.get('productName') or product_name
                missing = product_info.get('missingFields') or []
                missing_note = f' · 미등록 필드: {", ".join(missing)}' if missing else ''
                _add_event(
                    mode,
                    'info',
                    f'{fname} DB 매칭 완료: {product_info.get("productCode")} {product_name}{missing_note}',
                    fname,
                )

            # Generate sections
            sections_html = ''
            for index, s in enumerate(sections, 1):
                sid = s.get('section_id') or s.get('id') or ''
                sname = s.get('section_name') or s.get('name') or sid
                try:
                    _add_event(mode, 'info', f'{fname} 섹션 {index}/{len(sections)} 생성 중: {sname}', fname)
                    content = svc.generate_section_content(s, analysis, None)
                    sections_html += _render_section_html(s, content)
                    _add_event(mode, 'info', f'{fname} 섹션 {index}/{len(sections)} 완료: {sname}', fname)
                except Exception as se:
                    _add_event(mode, 'error', f'{fname} 섹션 {sname} 실패: {se}', fname)
                    sections_html += f'<section style="padding:40px;text-align:center"><h2>{sname}</h2></section>'
                time.sleep(0.3)

            # Build and upload HTML
            html = _build_html(product_name, sections_html)
            out_name = f'{product_name}_상세페이지_{datetime.now().strftime("%Y%m%d")}.html'
            drive.upload_text(output_folder, out_name, html, 'text/html')
            _add_event(mode, 'info', f'{out_name} 업로드 완료', fname)

            if done_folder:
                try:
                    drive.move_file(file['id'], done_folder, input_folder)
                    _add_event(mode, 'info', f'{fname} 원본 완료 폴더로 이동', fname)
                except Exception as me:
                    _add_event(mode, 'error', f'{fname} 이동 실패: {me}', fname)

            ok_count += 1

        except Exception as e:
            _add_event(mode, 'error', f'{fname} 처리 실패: {e}', fname)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    summary = f'{ok_count}/{len(unprocessed)} 파일 처리 완료'
    _add_event(mode, 'info', f'완료: {summary}')
    _finish_mode(mode, summary=summary)


def _render_section_html(section, content):
    if not content:
        return ''
    cs = content.get('color_scheme') or {}
    bg = cs.get('background', '#ffffff')
    text_p = cs.get('text_primary', '#333333')
    text_s = cs.get('text_secondary', '#666666')
    accent = cs.get('accent', '#FF6B35')
    font = content.get('font_suggestion') or {}
    h_size = font.get('headline_size', '32px')
    b_size = font.get('body_size', '16px')
    headline = content.get('headline', section.get('section_name') or section.get('name', ''))
    sub = content.get('subheadline', '')
    body = content.get('body_text', '')
    cta = content.get('cta_text', '')
    cta_html = (f'<a href="#" style="display:inline-block;margin-top:20px;padding:12px 36px;'
                f'background:{accent};color:#fff;border-radius:8px;text-decoration:none;'
                f'font-size:16px;font-weight:600">{cta}</a>') if cta else ''
    return (
        f'<section style="background:{bg};padding:60px 20px;text-align:center">'
        f'<div style="max-width:860px;margin:0 auto">'
        f'<h2 style="font-size:{h_size};color:{text_p};margin-bottom:12px;font-weight:700">{headline}</h2>'
        + (f'<h3 style="font-size:20px;color:{text_s};margin-bottom:20px;font-weight:400">{sub}</h3>' if sub else '')
        + (f'<p style="font-size:{b_size};color:{text_s};line-height:1.8;max-width:680px;margin:0 auto">{body}</p>' if body else '')
        + cta_html
        + '</div></section>'
    )


def _build_html(product_name, sections_html):
    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>{product_name}</title>
  <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet">
  <style>
    *{{margin:0;padding:0;box-sizing:border-box}}
    body{{font-family:"Pretendard","Noto Sans KR",sans-serif;color:#333}}
    img{{max-width:100%;height:auto}}
    section{{width:100%}}
  </style>
</head>
<body>{sections_html}</body>
</html>'''
