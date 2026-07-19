"""API domain routes: marketplus. Auto-split from api.py — behavior unchanged."""
import routes.api_shared as _api_shared
from routes.api_shared import api  # noqa: F401
globals().update({k: v for k, v in vars(_api_shared).items() if not k.startswith("__")})

import routes.api_archive as _api_archive
globals().update({k: v for k, v in vars(_api_archive).items() if not k.startswith("__") and k != "api"})

@api.route("/marketplus/internal-recipes", methods=["GET"])
def marketplus_internal_recipes():
    data = _marketplus_recipe_load()
    recipes = []
    for item in (data.get("recipes") or [])[:120]:
        if not isinstance(item, dict):
            continue
        recipes.append({
            "id": item.get("id"),
            "channel": item.get("channel"),
            "method": item.get("method"),
            "urlPattern": (item.get("url") or {}).get("pattern"),
            "bodyType": (item.get("body") or {}).get("type"),
            "bodyKeys": (item.get("body") or {}).get("keys", [])[:40],
            "responseStatus": item.get("responseStatus"),
            "updatedAt": item.get("updatedAt"),
            "security": item.get("security") or {},
        })
    return jsonify({
        "ok": True,
        "updatedAt": data.get("updatedAt") or "",
        "recipeCount": len(data.get("recipes") or []),
        "recipes": recipes,
        "note": "화면에는 레시피 구조만 표시합니다. 쿠키/CSRF/인증 헤더/원문 body 값은 저장하거나 반환하지 않습니다.",
    })


@api.route("/marketplus/internal-replay/dry-run", methods=["POST"])
def marketplus_internal_replay_dry_run():
    payload = request.get_json(silent=True) or {}
    context = {
        "productName": str(payload.get("productName") or "").strip()[:160],
        "productNo": str(payload.get("productNo") or "").strip()[:80],
        "productCode": str(payload.get("productCode") or "").strip()[:80],
        "channelLabels": [str(item).strip()[:80] for item in (payload.get("channelLabels") or []) if str(item).strip()],
    }
    result = _marketplus_recipe_dry_run(context)
    return jsonify(result), 200 if result.get("ok") else 409


def _inspect_cafe24_login_form(raw_tabs):
    """Return only safe fill-state facts for a regular Cafe24 login form."""
    login_tab = next((tab for tab in (raw_tabs or []) if isinstance(tab, dict) and _is_cafe24_login_tab(tab)), None)
    if not login_tab:
        return None
    ws_url = str(login_tab.get("webSocketDebuggerUrl") or "").strip()
    if not ws_url:
        return {
            "ok": False,
            "reason": "missing_websocket_url",
            "tab": _safe_chrome_tab(login_tab),
            "note": "Cafe24 로그인 탭은 있으나 DevTools 연결 주소가 없어 입력 상태를 읽지 못했습니다.",
        }
    expression = """
(() => {
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const passwordInputs = inputs.filter(el => String(el.type || '').toLowerCase() === 'password');
  const idInputs = inputs.filter(el => {
    const type = String(el.type || '').toLowerCase();
    const haystack = `${el.name || ''} ${el.id || ''} ${el.getAttribute('autocomplete') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
    return type !== 'password' && type !== 'hidden' && (type === 'text' || type === 'email' || haystack.includes('id') || haystack.includes('login') || haystack.includes('user'));
  });
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map(el => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id))
    .filter(Boolean);
  return {
    ok: true,
    inputCount: inputs.length,
    idInputCount: idInputs.length,
    passwordInputCount: passwordInputs.length,
    idFilled: idInputs.some(el => norm(el.value).length > 0),
    passwordFilled: passwordInputs.some(el => String(el.value || '').length > 0),
    loginButtonCount: buttons.filter(text => !/google|sns|구글/i.test(text) && (text === '로그인' || /일반.*로그인/.test(text) || /login/i.test(text))).length,
    hasGoogleButton: buttons.some(text => /google|구글/i.test(text))
  };
})()
"""
    try:
        result = _cdp_runtime_evaluate(ws_url, expression, timeout=3)
        if not isinstance(result, dict):
            result = {}
        id_filled = bool(result.get("idFilled"))
        password_filled = bool(result.get("passwordFilled"))
        result.update({
            "ok": True,
            "tab": _safe_chrome_tab(login_tab),
            "readyToSubmit": id_filled and password_filled,
            "note": (
                "전용 Chrome의 Cafe24 일반 로그인 칸에 저장 계정이 채워져 있어 제출할 수 있습니다."
                if id_filled and password_filled
                else "전용 Chrome의 Cafe24 일반 로그인 칸에 저장 계정이 아직 채워져 있지 않습니다. 이 창에서 일반 계정으로 한 번 로그인해두세요."
            ),
        })
        return result
    except Exception as e:
        return {
            "ok": False,
            "reason": "inspect_failed",
            "tab": _safe_chrome_tab(login_tab),
            "error": str(e),
            "note": "Cafe24 일반 로그인 입력 상태를 읽지 못했습니다. 화면이 로딩 중이면 잠시 뒤 다시 점검하세요.",
        }


@api.route("/marketplus/browser-status", methods=["GET"])
def marketplus_browser_status():
    """Inspect the user's Chrome remote-debugging tabs for Cafe24/MarketPlus.

    This does not send products. It only proves whether the local browser
    automation surface is reachable and whether a Cafe24/MarketPlus tab exists.
    """
    try:
      port = int(request.args.get("port") or 9224)
    except Exception:
      port = 9224
    port = max(1, min(65535, port))
    try:
        loaded = _load_chrome_debug_tabs(port)
        safe_tabs = loaded["safeTabs"]
        cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
        cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
        cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
        market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
        google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
        login_form = _inspect_cafe24_login_form(loaded.get("rawTabs") or []) if cafe_login_tabs else None
        if google_account_tabs:
            note = "Google 계정 선택/로그인 화면이 감지됐습니다. 이 경로는 사용하지 않습니다. Cafe24 일반 계정 로그인 화면으로 돌아가 저장된 일반 계정으로 로그인하세요."
        elif market_tabs:
            note = "마켓플러스 탭을 감지했습니다. 화면 읽기로 대상 상품과 선택 채널을 확인한 뒤 안전 실행하세요."
        elif cafe_admin_tabs:
            note = "Cafe24 관리자 탭을 감지했습니다. 마켓플러스 상품관리/상품보내기 화면으로 이동한 뒤 다시 점검하세요."
        elif cafe_login_tabs:
            note = (login_form or {}).get("note") or "Cafe24 일반 계정 로그인 화면을 감지했습니다. Google/SNS 계정 버튼을 누르지 말고 저장된 Cafe24 아이디/비밀번호로 로그인하세요."
        else:
            note = "Chrome 디버그 포트가 열려 있지만 Cafe24/마켓플러스 탭은 아직 없습니다. 관리자 열기 후 다시 점검하세요."
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않습니다.",
            "base": loaded["base"],
            "browser": str(loaded["version"].get("Browser") or ""),
            "tabCount": len(safe_tabs),
            "hasCafe24Tab": bool(cafe_tabs),
            "hasCafe24LoginTab": bool(cafe_login_tabs),
            "hasCafe24AdminTab": bool(cafe_admin_tabs),
            "hasMarketPlusTab": bool(market_tabs),
            "hasGoogleAccountLoginTab": bool(google_account_tabs),
            "cafe24Tabs": cafe_tabs[:8],
            "cafe24LoginTabs": cafe_login_tabs[:8],
            "cafe24AdminTabs": cafe_admin_tabs[:8],
            "marketPlusTabs": market_tabs[:8],
            "googleAccountLoginTabs": google_account_tabs[:8],
            "loginForm": login_form,
            "tabsSample": safe_tabs[:12],
            "note": note,
        })
    except Exception as e:
        last_error = str(e)
    return jsonify({
        "ok": False,
        "connected": False,
        "debugPort": port,
        "error": last_error or "Chrome debug port is not reachable",
        "note": "Chrome 원격 디버그 포트에 연결하지 못했습니다. launcher 또는 Chrome --remote-debugging-port=9224 실행 상태를 확인해야 합니다.",
    }), 503


@api.route("/marketplus/open-admin", methods=["POST"])
def marketplus_open_admin():
    """Open Cafe24/MarketPlus admin in the user's debug Chrome.

    This only opens a verified Cafe24/MarketPlus URL. It never clicks product
    send/register buttons and never calls external marketplace APIs.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    raw_url = payload.get("url") or "https://eclogin.cafe24.com/Shop/"
    try:
        opened = _chrome_debug_open_tab(port, raw_url)
        loaded = _load_chrome_debug_tabs(port)
        safe_tabs = loaded["safeTabs"]
        cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
        cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
        cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
        market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
        google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
        tab = opened.get("tab") if isinstance(opened.get("tab"), dict) else {}
        opened_tab = dict(tab)
        if not opened_tab.get("url"):
            opened_tab["url"] = raw_url
        safe_opened_tab = _safe_chrome_tab(opened_tab)
        if google_account_tabs:
            note = "Google 계정 선택/로그인 화면이 감지됐습니다. Google 로그인은 사용하지 말고 Cafe24 일반 계정 로그인 화면으로 돌아가 저장된 일반 계정으로 로그인하세요."
        elif not market_tabs and cafe_login_tabs:
            note = "Cafe24 일반 계정 로그인 화면을 열었습니다. Google 계정 버튼을 누르지 말고 저장된 Cafe24 아이디/비밀번호로 로그인한 뒤 마켓플러스 상품관리/상품보내기 화면으로 이동하세요."
        elif market_tabs:
            note = "마켓플러스 탭을 감지했습니다. 화면 읽기로 대상 상품과 채널을 확인한 뒤 안전 실행하세요."
        else:
            note = "Cafe24 관리자 탭을 열었습니다. 마켓플러스 상품관리/상품보내기 화면으로 이동해 화면 읽기를 실행하세요."
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
            "base": opened.get("base") or loaded.get("base"),
            "openedUrl": opened.get("targetUrl"),
            "openedTab": safe_opened_tab,
            "tabCount": len(safe_tabs),
            "hasCafe24Tab": bool(cafe_tabs),
            "hasCafe24LoginTab": bool(cafe_login_tabs),
            "hasCafe24AdminTab": bool(cafe_admin_tabs),
            "hasMarketPlusTab": bool(market_tabs),
            "hasGoogleAccountLoginTab": bool(google_account_tabs),
            "cafe24Tabs": cafe_tabs[:8],
            "cafe24LoginTabs": cafe_login_tabs[:8],
            "cafe24AdminTabs": cafe_admin_tabs[:8],
            "marketPlusTabs": market_tabs[:8],
            "googleAccountLoginTabs": google_account_tabs[:8],
            "tabsSample": safe_tabs[:12],
            "note": note,
        })
    except ValueError as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": str(e),
        }), 400
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "Chrome 디버그 브라우저에 Cafe24 관리자 탭을 열지 못했습니다. 디버그 포트 9224와 Chrome 실행 상태를 확인하세요.",
        }), 503


@api.route("/marketplus/open-normal-browser", methods=["POST"])
def marketplus_open_normal_browser():
    """Open Cafe24/MarketPlus in the user's normal browser profile.

    This is the login helper path for already saved Cafe24 regular-account
    credentials. It does not enable automated clicking and does not follow
    Google/SNS account login paths.
    """
    payload = request.get_json(silent=True) or {}
    raw_url = payload.get("url") or "https://eclogin.cafe24.com/Shop/"
    try:
        opened = _open_url_in_normal_browser(raw_url)
        return jsonify({
            "ok": True,
            "connected": False,
            "debugPort": None,
            "profileMode": "normal_chrome_helper",
            "credentialScopeNote": "이 경로는 일반 Chrome에 저장된 Cafe24 일반 계정 확인용입니다. 자동 송출 클릭은 전용 Chrome 로그인 후 실행됩니다.",
            "openedUrl": opened.get("targetUrl"),
            "note": "일반 Chrome에 Cafe24 일반 계정 로그인/관리자 화면을 열었습니다. 저장된 일반 계정으로 로그인할 때 쓰는 경로이며, 이 탭은 자동 클릭 대상이 아닙니다.",
            "nextAction": "자동 상품보내기까지 이어가려면 전용 Chrome에도 한 번 Cafe24 일반 계정으로 로그인해두거나, 일반 Chrome에서 마켓플러스 URL을 확인해 프로그램에 저장하세요.",
        })
    except ValueError as e:
        return jsonify({
            "ok": False,
            "error": str(e),
            "note": str(e),
        }), 400
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": str(e),
            "note": f"일반 Chrome 열기 실패: {e}",
        }), 503


@api.route("/marketplus/restore-normal-login", methods=["POST"])
def marketplus_restore_normal_login():
    """Recover from an accidental Google/SNS login tab.

    The MarketPlus workflow must use the regular Cafe24 admin account. This
    endpoint closes Google account chooser/login tabs on the debug browser when
    available, then opens the Cafe24 regular-account login page. It never clicks
    login buttons and never sends products.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    port = max(1, min(65535, port))
    raw_url = payload.get("url") or "https://eclogin.cafe24.com/Shop/"
    open_normal = payload.get("openNormal")
    open_debug = payload.get("openDebug")
    if open_normal is None:
        open_normal = True
    if open_debug is None:
        open_debug = True
    try:
        target_url = _marketplus_allowed_open_url(raw_url)
    except ValueError as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": str(e),
        }), 400

    before_loaded = None
    after_loaded = None
    closed = []
    close_failed = []
    debug_opened = None
    normal_opened = None
    debug_error = ""
    normal_error = ""
    try:
        before_loaded = _load_chrome_debug_tabs(port)
        close_result = _close_google_account_tabs(before_loaded)
        closed = close_result.get("closed") or []
        close_failed = close_result.get("failed") or []
    except Exception as e:
        debug_error = str(e)

    if open_debug:
        try:
            debug_opened = _chrome_debug_open_tab(port, target_url)
        except Exception as e:
            debug_error = str(e)

    if open_normal:
        try:
            normal_opened = _open_url_in_normal_browser(target_url)
        except Exception as e:
            normal_error = str(e)

    try:
        after_loaded = _load_chrome_debug_tabs(port)
    except Exception as e:
        if not debug_error:
            debug_error = str(e)

    safe_tabs = after_loaded.get("safeTabs") if after_loaded else []
    cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
    cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
    cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
    market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
    google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
    connected = bool(after_loaded)
    opened_url = (
        (debug_opened or {}).get("targetUrl")
        or (normal_opened or {}).get("targetUrl")
        or _safe_browser_tab_url(target_url)
    )
    if google_account_tabs:
        note = "Google 계정 선택창이 아직 감지됩니다. 해당 창을 닫고, 새로 열린 Cafe24 일반 계정 로그인 화면에서 저장된 아이디/비밀번호로 로그인하세요."
    elif cafe_login_tabs:
        note = "Google 계정 창을 정리하고 Cafe24 일반 계정 로그인 화면을 열었습니다. 저장된 일반 계정 아이디/비밀번호로 로그인하세요."
    elif cafe_admin_tabs or market_tabs:
        note = "Google 계정 창을 정리했고 Cafe24 관리자/마켓플러스 화면을 감지했습니다. 이제 화면 읽기와 보내기 조건 점검을 진행할 수 있습니다."
    else:
        note = "Cafe24 일반 계정 로그인 화면을 열었습니다. Google/SNS 계정 버튼은 사용하지 말고 저장된 Cafe24 계정으로 로그인하세요."
    if normal_error and debug_error and not connected:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "openedUrl": opened_url,
            "closedGoogleTabCount": len(closed),
            "closeFailedCount": len(close_failed),
            "closedGoogleTabs": closed,
            "closeFailedTabs": close_failed,
            "error": f"debug={debug_error}; normal={normal_error}",
            "note": "Google 로그인 복구 시도 중 일반 Chrome과 전용 Chrome을 모두 열지 못했습니다. Chrome 실행 상태를 확인하세요.",
        }), 503
    return jsonify({
        "ok": True,
        "connected": connected,
        "debugPort": port,
        "profileMode": "dedicated_debug_chrome_with_normal_chrome_helper",
        "credentialScopeNote": "Google/SNS가 아니라 Cafe24 일반 계정 로그인만 사용합니다. 일반 Chrome과 전용 Chrome은 저장 계정이 자동 공유되지 않을 수 있습니다.",
        "openedUrl": opened_url,
        "normalOpened": bool(normal_opened),
        "debugOpened": bool(debug_opened),
        "closedGoogleTabCount": len(closed),
        "closeFailedCount": len(close_failed),
        "closedGoogleTabs": closed,
        "closeFailedTabs": close_failed,
        "debugError": debug_error,
        "normalError": normal_error,
        "tabCount": len(safe_tabs),
        "hasCafe24Tab": bool(cafe_tabs),
        "hasCafe24LoginTab": bool(cafe_login_tabs),
        "hasCafe24AdminTab": bool(cafe_admin_tabs),
        "hasMarketPlusTab": bool(market_tabs),
        "hasGoogleAccountLoginTab": bool(google_account_tabs),
        "cafe24Tabs": cafe_tabs[:8],
        "cafe24LoginTabs": cafe_login_tabs[:8],
        "cafe24AdminTabs": cafe_admin_tabs[:8],
        "marketPlusTabs": market_tabs[:8],
        "googleAccountLoginTabs": google_account_tabs[:8],
        "tabsSample": safe_tabs[:12],
        "note": note,
        "nextAction": "Cafe24 일반 계정으로 로그인한 뒤 마켓플러스 상품관리/상품보내기 화면으로 이동하고, 화면 읽기를 실행하세요.",
    })


@api.route("/marketplus/submit-normal-login", methods=["POST"])
def marketplus_submit_normal_login():
    """Submit the regular Cafe24 login form when saved credentials are filled.

    This route is deliberately narrow: it only targets a Cafe24 regular login
    tab, refuses Google/SNS login pages, never returns raw input values, and
    never proceeds to MarketPlus product sending.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    dry_run = bool(payload.get("dryRun", False))
    try:
        loaded = _load_chrome_debug_tabs(port)
        safe_tabs = loaded["safeTabs"]
        google_tabs = [item for item in safe_tabs if item.get("isGoogleAccountLogin")]
        if google_tabs:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "profileMode": "dedicated_debug_chrome",
                "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
                "reason": "google_account_login_visible",
                "hasGoogleAccountLoginTab": True,
                "googleAccountLoginTabs": google_tabs[:8],
                "note": "Google 계정 선택/로그인 탭이 감지되어 Cafe24 일반 로그인 제출을 중단했습니다. 먼저 일반 로그인 복구 버튼으로 Google 창을 닫아주세요.",
            })
        login_tabs = [tab for tab in (loaded.get("rawTabs") or []) if _is_cafe24_login_tab(tab)]
        if not login_tabs:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "profileMode": "dedicated_debug_chrome",
                "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
                "reason": "no_cafe24_login_tab",
                "hasCafe24LoginTab": False,
                "hasCafe24AdminTab": any(item.get("isCafe24Admin") for item in safe_tabs),
                "hasMarketPlusTab": any(item.get("isMarketPlus") for item in safe_tabs),
                "tabsSample": safe_tabs[:12],
                "note": "Cafe24 일반 로그인 탭을 찾지 못했습니다. 이미 로그인되어 있다면 관리자/마켓플러스 화면 읽기를 진행하세요.",
            })
        tab = login_tabs[0]
        expression = f"""
(() => {{
  const dryRun = {json.dumps(dry_run)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {{
    try {{
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id);
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const passwordInputs = inputs.filter(el => String(el.type || '').toLowerCase() === 'password');
  const idInputs = inputs.filter(el => {{
    const type = String(el.type || '').toLowerCase();
    const name = `${{el.name || ''}} ${{el.id || ''}} ${{el.getAttribute('autocomplete') || ''}} ${{el.getAttribute('placeholder') || ''}}`.toLowerCase();
    return type !== 'password' && type !== 'hidden' && (type === 'text' || type === 'email' || name.includes('id') || name.includes('login') || name.includes('user'));
  }});
  const idFilled = idInputs.some(el => norm(el.value).length > 0);
  const passwordFilled = passwordInputs.some(el => String(el.value || '').length > 0);
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({{ el, index, text: labelOf(el), tag: el.tagName, id: el.id || '', name: el.name || '' }}))
    .filter(item => item.text);
  const loginButtons = buttons.filter(item => {{
    const text = item.text;
    if (/google|sns|구글/i.test(text)) return false;
    return text === '로그인' || /일반.*로그인/.test(text) || /login/i.test(text);
  }});
  if (!idFilled || !passwordFilled) {{
    return {{
      ok: false,
      reason: 'credentials_not_filled',
      note: 'Cafe24 일반 로그인 칸에 저장된 아이디/비밀번호가 아직 채워지지 않아 로그인 버튼을 누르지 않았습니다.',
      idFilled,
      passwordFilled,
      inputCount: inputs.length,
      passwordInputCount: passwordInputs.length,
      loginButtonCount: loginButtons.length
    }};
  }}
  if (!loginButtons.length) {{
    return {{
      ok: false,
      reason: 'login_button_not_found',
      note: 'Cafe24 일반 로그인 버튼을 찾지 못했습니다. Google/SNS 버튼은 의도적으로 제외했습니다.',
      idFilled,
      passwordFilled,
      inputCount: inputs.length,
      passwordInputCount: passwordInputs.length,
      loginButtonCount: 0
    }};
  }}
  const picked = loginButtons[0];
  const pickedInfo = {{ index: picked.index, text: picked.text, tag: picked.tag, id: picked.id, name: picked.name }};
  if (dryRun) {{
    return {{
      ok: true,
      dryRun: true,
      reason: 'ready_to_submit_regular_login',
      note: 'Cafe24 일반 계정 입력값과 로그인 버튼을 확인했습니다. dryRun이라 실제 로그인은 누르지 않았습니다.',
      idFilled,
      passwordFilled,
      inputCount: inputs.length,
      passwordInputCount: passwordInputs.length,
      picked: pickedInfo
    }};
  }}
  picked.el.scrollIntoView({{ block: 'center', inline: 'center' }});
  picked.el.click();
  return {{
    ok: true,
    clicked: true,
    reason: 'regular_login_submitted',
    note: 'Cafe24 일반 계정 로그인 버튼을 눌렀습니다. 관리자 화면으로 이동하면 마켓플러스 화면 읽기를 이어가세요.',
    idFilled,
    passwordFilled,
    inputCount: inputs.length,
    passwordInputCount: passwordInputs.length,
    picked: pickedInfo
  }};
}})()
"""
        result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(result, dict):
            result = {"ok": False, "note": "Cafe24 일반 로그인 제출 결과를 해석하지 못했습니다."}
        result.update({
            "connected": True,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url")),
                "isCafe24Login": True,
            },
        })
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "ok": False,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
            "error": str(e),
            "note": "Cafe24 일반 로그인 제출 점검에 실패했습니다. Chrome 디버그 포트와 로그인 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/fill-normal-login", methods=["POST"])
def marketplus_fill_normal_login():
    """Fill and optionally submit the regular Cafe24 login form.

    This is intentionally scoped to Cafe24's regular login page only. It refuses
    Google/SNS pages, never returns raw credentials, and never proceeds to any
    product send action.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    mall_id = str(payload.get("mallId") or "").strip()
    password = str(payload.get("password") or "")
    submit = bool(payload.get("submit", False))
    dry_run = bool(payload.get("dryRun", False))
    if not mall_id or not password:
        return jsonify({
            "ok": False,
            "debugPort": port,
            "reason": "missing_credentials",
            "note": "Cafe24 일반 계정 아이디/비밀번호가 전달되지 않아 로그인 칸을 건드리지 않았습니다.",
        }), 400
    try:
        loaded = _load_chrome_debug_tabs(port)
        safe_tabs = loaded["safeTabs"]
        google_tabs = [item for item in safe_tabs if item.get("isGoogleAccountLogin")]
        if google_tabs:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "google_account_login_visible",
                "hasGoogleAccountLoginTab": True,
                "googleAccountLoginTabs": google_tabs[:8],
                "note": "Google 계정 선택/로그인 탭이 감지되어 Cafe24 일반 로그인 입력을 중단했습니다.",
            })
        login_tabs = [tab for tab in (loaded.get("rawTabs") or []) if _is_cafe24_login_tab(tab)]
        if not login_tabs:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_cafe24_login_tab",
                "hasCafe24AdminTab": any(item.get("isCafe24Admin") for item in safe_tabs),
                "hasMarketPlusTab": any(item.get("isMarketPlus") for item in safe_tabs),
                "tabsSample": safe_tabs[:12],
                "note": "Cafe24 일반 로그인 탭을 찾지 못했습니다. 이미 로그인되어 있다면 관리자/마켓플러스 화면 읽기를 진행하세요.",
            })
        tab = login_tabs[0]
        expression = f"""
(() => {{
  const mallId = {json.dumps(mall_id)};
  const password = {json.dumps(password)};
  const submit = {json.dumps(submit)};
  const dryRun = {json.dumps(dry_run)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {{
    try {{
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    }} catch (_) {{
      return false;
    }}
  }};
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id || el.getAttribute('placeholder'));
  const setNativeValue = (el, value) => {{
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
    el.dispatchEvent(new KeyboardEvent('keyup', {{ bubbles: true, key: 'Enter' }}));
  }};
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const passwordInputs = inputs.filter(el => String(el.type || '').toLowerCase() === 'password');
  const idInputs = inputs.filter(el => {{
    const type = String(el.type || '').toLowerCase();
    const haystack = `${{el.name || ''}} ${{el.id || ''}} ${{el.getAttribute('autocomplete') || ''}} ${{el.getAttribute('placeholder') || ''}} ${{el.getAttribute('aria-label') || ''}}`.toLowerCase();
    if (type === 'password' || type === 'hidden' || type === 'checkbox' || type === 'radio') return false;
    return type === 'text' || type === 'email' || haystack.includes('id') || haystack.includes('login') || haystack.includes('user') || haystack.includes('아이디');
  }});
  const idInput = idInputs[0] || inputs.find(el => String(el.type || '').toLowerCase() === 'text');
  const passwordInput = passwordInputs[0];
  const before = {{
    inputCount: inputs.length,
    idInputCount: idInputs.length,
    passwordInputCount: passwordInputs.length,
    idFilled: !!(idInput && norm(idInput.value)),
    passwordFilled: !!(passwordInput && String(passwordInput.value || ''))
  }};
  if (!idInput || !passwordInput) {{
    return {{
      ok: false,
      reason: 'login_inputs_not_found',
      note: 'Cafe24 일반 로그인 아이디/비밀번호 입력칸을 찾지 못해 입력하지 않았습니다.',
      before
    }};
  }}
  if (!dryRun) {{
    setNativeValue(idInput, mallId);
    setNativeValue(passwordInput, password);
  }}
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({{ el, index, text: labelOf(el), tag: el.tagName, id: el.id || '', name: el.name || '' }}))
    .filter(item => item.text);
  const loginButtons = buttons.filter(item => {{
    const text = item.text;
    if (/google|sns|구글/i.test(text)) return false;
    return text === '로그인' || /일반.*로그인/.test(text) || /login/i.test(text);
  }});
  const after = {{
    idFilled: !!(idInput && norm(idInput.value)),
    passwordFilled: !!(passwordInput && String(passwordInput.value || '')),
    loginButtonCount: loginButtons.length
  }};
  if (!after.idFilled || !after.passwordFilled) {{
    return {{
      ok: false,
      reason: 'fill_failed',
      note: 'Cafe24 일반 로그인 입력칸 채우기에 실패했습니다.',
      before,
      after
    }};
  }}
  if (!submit || dryRun) {{
    return {{
      ok: true,
      dryRun,
      submitted: false,
      reason: 'filled_regular_login',
      note: dryRun ? 'dryRun이라 입력하지 않고 입력칸 위치만 확인했습니다.' : 'Cafe24 일반 로그인 칸을 채웠습니다. 아직 로그인 버튼은 누르지 않았습니다.',
      before,
      after
    }};
  }}
  if (!loginButtons.length) {{
    return {{
      ok: false,
      reason: 'login_button_not_found',
      note: 'Cafe24 일반 로그인 버튼을 찾지 못했습니다. Google/SNS 버튼은 제외했습니다.',
      before,
      after
    }};
  }}
  const picked = loginButtons[0];
  const pickedInfo = {{ index: picked.index, text: picked.text, tag: picked.tag, id: picked.id, name: picked.name }};
  picked.el.scrollIntoView({{ block: 'center', inline: 'center' }});
  picked.el.click();
  return {{
    ok: true,
    submitted: true,
    reason: 'regular_login_submitted',
    note: 'Cafe24 일반 로그인 버튼을 눌렀습니다. 관리자 화면으로 이동하면 마켓플러스 화면 읽기를 이어가세요.',
    before,
    after,
    picked: pickedInfo
  }};
}})()
"""
        result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(result, dict):
            result = {"ok": False, "note": "Cafe24 일반 로그인 입력 결과를 해석하지 못했습니다."}
        result.update({
            "connected": True,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸만 사용했습니다. 원문 비밀번호는 응답에 포함하지 않습니다.",
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url")),
                "isCafe24Login": True,
            },
        })
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "ok": False,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "error": str(e),
            "note": "Cafe24 일반 로그인 입력/제출에 실패했습니다. Chrome 디버그 포트와 로그인 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/open-marketplus-menu", methods=["POST"])
def marketplus_open_marketplus_menu():
    """Open Cafe24 MarketPlus from an already logged-in Cafe24 admin tab.

    This is a navigation-only helper. It does not search products, send products,
    or save anything. The goal is to reach the same MarketPlus surface a user
    reaches from the Cafe24 admin menu without coordinate clicking.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    dry_run = bool(payload.get("dryRun", False))
    try:
        loaded = _load_chrome_debug_tabs(port)
        tab = _marketplus_pick_tab(loaded["rawTabs"], "cafe24")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_cafe24_admin_tab",
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "로그인된 Cafe24 관리자 탭을 먼저 열어야 마켓플러스 메뉴를 열 수 있습니다.",
            }), 409
        if _is_cafe24_login_tab(tab) or _is_google_account_tab(tab):
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "login_required",
                "tab": _safe_chrome_tab(tab),
                "note": "현재 탭은 로그인 화면입니다. 일반 Cafe24 관리자 로그인 후 다시 시도해주세요.",
            }), 409

        expression = f"""
(() => {{
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {{
    try {{
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const candidates = Array.from(document.querySelectorAll('a,button,[role=button],li,span,div'))
    .filter(visible)
    .map((el, index) => {{
      const text = normalize(el.innerText || el.textContent || el.value || el.getAttribute('title') || el.getAttribute('aria-label') || el.id || '');
      const href = el.href || el.getAttribute('href') || '';
      const id = el.id || '';
      return {{ index, text, href, id, tag: el.tagName, el }};
    }})
    .filter(item => /마켓\\s*플러스|Market\\s*Plus|marketplus/i.test([item.text, item.href, item.id].join(' ')));
  const menu = document.querySelector('#QA_Lnb_Menu1553')
    || candidates.find(item => /마켓\\s*플러스|Market\\s*Plus/i.test(item.text))?.el
    || candidates[0]?.el
    || null;
  const hasFn = !!(window.MENU_NAVIGATION_GNB && typeof window.MENU_NAVIGATION_GNB.openMarketManage === 'function');
  const fnSource = hasFn ? String(window.MENU_NAVIGATION_GNB.openMarketManage).slice(0, 3000) : '';
  const summary = {{
    title: document.title || '',
    url: location.href || '',
    hasOpenMarketManage: hasFn,
    openMarketManageSource: fnSource,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 12).map(item => ({{
      index: item.index,
      tag: item.tag,
      id: item.id,
      text: item.text.slice(0, 120),
      href: String(item.href || '').slice(0, 240)
    }})),
    menuFound: !!menu,
    menuText: menu ? normalize(menu.innerText || menu.textContent || menu.value || menu.getAttribute('title') || menu.id).slice(0, 160) : ''
  }};
  if ({json.dumps(dry_run)}) {{
    return Object.assign(summary, {{ invoked: false, clicked: false, dryRun: true }});
  }}
  if (hasFn) {{
    window.MENU_NAVIGATION_GNB.openMarketManage();
    return Object.assign(summary, {{ invoked: true, clicked: false, method: 'MENU_NAVIGATION_GNB.openMarketManage' }});
  }}
  if (menu) {{
    menu.click();
    return Object.assign(summary, {{ invoked: false, clicked: true, method: 'menu.click' }});
  }}
  return Object.assign(summary, {{ invoked: false, clicked: false, error: 'marketplus_menu_not_found' }});
}})()
"""
        result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=6)
        if not isinstance(result, dict):
            result = {}
        if result.get("error"):
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": result.get("error"),
                "tab": _safe_chrome_tab(tab),
                "result": result,
            }), 409
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": _safe_chrome_tab(tab),
            "result": result,
            "note": "Cafe24 관리자 메뉴에서 마켓플러스 화면 열기를 실행했습니다. 상품 송출/저장은 아직 실행하지 않았습니다.",
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 메뉴 열기에 실패했습니다.",
        }), 500


@api.route("/marketplus/launch-debug-chrome", methods=["POST"])
def marketplus_launch_debug_chrome():
    """Launch a dedicated Chrome profile with remote debugging enabled.

    This prepares the browser automation lane only. It does not click product
    send/register buttons and does not call marketplace APIs.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    raw_url = payload.get("url") or "https://eclogin.cafe24.com/Shop/"
    try:
        try:
            loaded = _load_chrome_debug_tabs(port)
            safe_tabs = loaded["safeTabs"]
            cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
            cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
            cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
            market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
            google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
            opened_url = None
            if not (cafe_tabs or cafe_login_tabs or cafe_admin_tabs or market_tabs):
                try:
                    _chrome_debug_open_tab(port, raw_url)
                    opened_url = _safe_browser_tab_url(raw_url)
                    loaded = _load_chrome_debug_tabs(port)
                    safe_tabs = loaded["safeTabs"]
                    cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
                    cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
                    cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
                    market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
                    google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
                except Exception:
                    opened_url = None
            note = "Chrome 디버그 포트가 이미 열려 있습니다. 기존 디버그 브라우저를 사용합니다." if not opened_url else "Chrome 디버그 포트가 이미 열려 있어 지정한 Cafe24 화면을 새 탭으로 열었습니다."
            if google_account_tabs:
                note = "Google 계정 선택/로그인 화면이 감지됐습니다. Google 버튼 경로가 아니라 Cafe24 일반 계정 로그인 화면으로 돌아가 저장된 일반 계정으로 로그인하세요."
            return jsonify({
                "ok": True,
                "connected": True,
                "alreadyRunning": True,
                "debugPort": port,
                "profileMode": "dedicated_debug_chrome",
                "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
                "openedUrl": opened_url,
                "tabCount": len(safe_tabs),
                "hasCafe24Tab": bool(cafe_tabs),
                "hasCafe24LoginTab": bool(cafe_login_tabs),
                "hasCafe24AdminTab": bool(cafe_admin_tabs),
                "hasMarketPlusTab": bool(market_tabs),
                "hasGoogleAccountLoginTab": bool(google_account_tabs),
                "cafe24Tabs": cafe_tabs[:8],
                "cafe24LoginTabs": cafe_login_tabs[:8],
                "cafe24AdminTabs": cafe_admin_tabs[:8],
                "marketPlusTabs": market_tabs[:8],
                "googleAccountLoginTabs": google_account_tabs[:8],
                "tabsSample": safe_tabs[:12],
                "note": note,
            })
        except Exception:
            pass

        launched = _launch_chrome_debug(port, raw_url)
        if not launched.get("ok"):
            return jsonify({
                "ok": False,
                "connected": False,
                "debugPort": port,
                "error": launched.get("error") or "Chrome debug launch failed",
                "note": "전용 Chrome 디버그 브라우저를 실행했지만 포트 연결 확인에 실패했습니다.",
                "chromePath": launched.get("chromePath"),
                "userDataDir": launched.get("userDataDir"),
            }), 503

        loaded = launched.get("loaded") or _load_chrome_debug_tabs(port)
        safe_tabs = loaded["safeTabs"]
        cafe_tabs = [tab for tab in safe_tabs if tab.get("isCafe24")]
        cafe_login_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Login")]
        cafe_admin_tabs = [tab for tab in safe_tabs if tab.get("isCafe24Admin")]
        market_tabs = [tab for tab in safe_tabs if tab.get("isMarketPlus")]
        google_account_tabs = [tab for tab in safe_tabs if tab.get("isGoogleAccountLogin")]
        return jsonify({
            "ok": True,
            "connected": True,
            "alreadyRunning": False,
            "debugPort": port,
            "profileMode": "dedicated_debug_chrome",
            "credentialScopeNote": "일반 Chrome에 저장된 Cafe24 계정은 자동화 전용 Chrome 프로필과 자동 공유되지 않을 수 있습니다. Google/SNS가 아니라 Cafe24 일반 계정 로그인 칸을 사용하세요.",
            "pid": launched.get("pid"),
            "openedUrl": launched.get("targetUrl"),
            "chromePath": launched.get("chromePath"),
            "userDataDir": launched.get("userDataDir"),
            "tabCount": len(safe_tabs),
            "hasCafe24Tab": bool(cafe_tabs),
            "hasCafe24LoginTab": bool(cafe_login_tabs),
            "hasCafe24AdminTab": bool(cafe_admin_tabs),
            "hasMarketPlusTab": bool(market_tabs),
            "hasGoogleAccountLoginTab": bool(google_account_tabs),
            "cafe24Tabs": cafe_tabs[:8],
            "cafe24LoginTabs": cafe_login_tabs[:8],
            "cafe24AdminTabs": cafe_admin_tabs[:8],
            "marketPlusTabs": market_tabs[:8],
            "googleAccountLoginTabs": google_account_tabs[:8],
            "tabsSample": safe_tabs[:12],
            "note": "전용 Chrome 디버그 브라우저를 열었습니다. 이 창에서 Google 계정 버튼을 누르지 말고 Cafe24 일반 계정 아이디/비밀번호로 로그인한 뒤 마켓플러스 상품보내기 화면으로 이동하세요.",
        })
    except ValueError as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": str(e),
        }), 400
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "전용 Chrome 디버그 브라우저 실행에 실패했습니다.",
        }), 500


@api.route("/marketplus/page-snapshot", methods=["GET"])
def marketplus_page_snapshot():
    """Read the visible Cafe24/MarketPlus page only. No clicks, no sending."""
    try:
        port = int(request.args.get("port") or 9224)
    except Exception:
        port = 9224
    target = str(request.args.get("target") or "auto").strip().lower()
    if target not in {"auto", "marketplus", "cafe24"}:
        target = "auto"
    try:
        loaded = _load_chrome_debug_tabs(port)
        tab = _marketplus_pick_product_detail_tab(loaded["rawTabs"], target) if target == "marketplus" else _marketplus_pick_tab(loaded["rawTabs"], target)
        if not tab:
            safe_tabs = loaded["safeTabs"]
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "target": target,
                "tabCount": len(safe_tabs),
                "tabsSample": safe_tabs[:12],
                "note": "Chrome은 연결됐지만 Cafe24/마켓플러스 탭을 찾지 못했습니다. 관리자나 마켓플러스 탭을 연 뒤 다시 읽어주세요.",
            })
        expression = r"""
(() => {
  const labelOf = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .slice(0, 100)
    .map((el, index) => ({
      index,
      tag: el.tagName,
      text: labelOf(el).slice(0, 140),
      id: el.id || '',
      name: el.name || '',
      href: el.href || ''
    }));
  const isSensitiveInput = (el) => {
    const haystack = [
      el.type || '',
      el.name || '',
      el.id || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || ''
    ].join(' ').toLowerCase();
    return /password|passwd|pwd|secret|token|auth|credential|client_secret|refresh/i.test(haystack);
  };
  const safeValueOf = (el) => {
    if (isSensitiveInput(el)) return el.value ? '[masked]' : '';
    return String(el.value || '').slice(0, 100);
  };
  const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
    .filter(visible)
    .slice(0, 140)
    .map((el, index) => ({
      index,
      tag: el.tagName,
      type: el.type || '',
      label: labelOf(el).slice(0, 140),
      id: el.id || '',
      name: el.name || '',
      value: safeValueOf(el),
      masked: isSensitiveInput(el)
    }));
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,.title,.heading,[class*=title],[class*=Title]'))
    .filter(visible)
    .slice(0, 50)
    .map((el, index) => ({ index, text: labelOf(el).slice(0, 160), tag: el.tagName, id: el.id || '' }));
  return {
    title: document.title || '',
    url: location.href || '',
    text: (document.body && document.body.innerText ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 7000) : ''),
    buttons,
    inputs,
    headings
  };
})()
"""
        snapshot = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(snapshot, dict):
            snapshot = {}
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "target": target,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or snapshot.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url") or snapshot.get("url")),
                "isCafe24": _is_cafe24_tab(tab),
                "isCafe24Login": _is_cafe24_login_tab(tab),
                "isCafe24Admin": _is_cafe24_admin_tab(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
                "stage": _marketplus_tab_stage(tab),
            },
            "page": {
                "title": str(snapshot.get("title") or "")[:180],
                "url": _safe_browser_tab_url(snapshot.get("url")),
                "textSnippet": str(snapshot.get("text") or "")[:7000],
                "buttons": snapshot.get("buttons") if isinstance(snapshot.get("buttons"), list) else [],
                "inputs": snapshot.get("inputs") if isinstance(snapshot.get("inputs"), list) else [],
                "headings": snapshot.get("headings") if isinstance(snapshot.get("headings"), list) else [],
            },
            "note": "현재 Cafe24/마켓플러스 탭의 화면 요소를 읽었습니다. 클릭/상품 보내기/저장은 실행하지 않았습니다.",
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "target": target,
            "error": str(e),
            "note": "마켓플러스 화면 읽기에 실패했습니다. Chrome 디버그 포트와 관리자 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/product-send-detail-status", methods=["GET"])
def marketplus_product_send_detail_status():
    """Read the current MarketPlus product-send detail screen.

    This is intentionally read-only: it does not click, save, or send products.
    The goal is to make the app show whether the MarketPlus-managed send flow is
    actually ready for each selected marketplace channel.
    """
    try:
        port = int(request.args.get("port") or 9224)
    except Exception:
        port = 9224
    tab = None
    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        tab = _marketplus_pick_product_detail_tab(raw_tabs, "marketplus")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "tabCount": len(loaded.get("safeTabs") or []),
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 마켓플러스 상세 화면을 찾지 못했습니다. 상품보내기 상세 화면을 연 뒤 다시 읽어주세요.",
            })
        _activate_chrome_debug_tab(port, tab)

        expression = r"""
(() => {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const isSensitiveInput = (el) => {
    const haystack = [
      el.type || '',
      el.name || '',
      el.id || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || ''
    ].join(' ').toLowerCase();
    return /password|passwd|pwd|secret|token|auth|credential|client_secret|refresh/i.test(haystack);
  };
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id || '');
  const safeValueOf = (el) => {
    if (isSensitiveInput(el)) return el.value ? '[masked]' : '';
    if (el.tagName === 'SELECT') return norm(el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : el.value);
    return norm(el.value).slice(0, 180);
  };
  const pageText = document.body ? (document.body.textContent || document.body.innerText || '') : '';
  const text = norm(pageText);
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .slice(0, 160)
    .map((el, index) => ({
      index,
      tag: el.tagName,
      text: labelOf(el).slice(0, 140),
      id: el.id || '',
      name: el.name || '',
      href: el.href || ''
    }));
  const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
    .filter(visible)
    .slice(0, 220)
    .map((el, index) => ({
      index,
      tag: el.tagName,
      type: el.type || '',
      label: labelOf(el).slice(0, 140),
      id: el.id || '',
      name: el.name || '',
      value: safeValueOf(el),
      masked: isSensitiveInput(el)
    }));
  const includesAny = (source, values) => values.some((item) => item && source.includes(item));
  const findText = (values) => values.find((item) => item && text.includes(item)) || '';
  const channelDefs = [
    { id:'gmarket', label:'G마켓', platform:'gmarket', formAccount:'1928bojagi', aliases:['G마켓','지마켓','Gmarket','G-market','ESM'], accounts:['1928bojagi'] },
    { id:'auction', label:'옥션', platform:'auction', formAccount:'bojagi1928', aliases:['옥션','Auction','ESM'], accounts:['bojagi1928'] },
    { id:'elevenst', label:'11번가', platform:'sk11st', formAccount:'bojagi1928', aliases:['11번가','십일번가','11st'], accounts:['bojagi1928'] },
    { id:'smartstore', label:'스마트스토어', platform:'shopn', formAccount:'ncp_1nn03r_01', aliases:['스마트스토어','네이버 스마트스토어','SmartStore','Naver SmartStore'], accounts:['ncp_1nn03r_01'] },
    { id:'coupang', label:'쿠팡', platform:'coupang', formAccount:'bojagi1928', aliases:['쿠팡','Coupang','Wing'], accounts:['bojagi1928'] }
  ];
  const attrValueSelector = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const selectText = (select) => norm(select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0].textContent : '');
  const placeholderRe = /^(대분류|중분류|소분류|세분류|상세분류|선택)/;
  const hiddenCategoryStatus = (def) => {
    const key = `${def.platform}|${def.formAccount}`;
    const read = (field) => {
      const selector = `input[name="${attrValueSelector(`template_data[${key}][${field}]`)}"], textarea[name="${attrValueSelector(`template_data[${key}][${field}]`)}"]`;
      const el = document.querySelector(selector);
      return { present: !!el, value: norm(el && el.value) };
    };
    const prdCode = read('prd_cate_code');
    const prdName = read('prd_cate_name');
    const ebayCode = read('market_data][ebay_prd_cate_code');
    const ebayName = read('market_data][ebay_prd_cate_name');
    return {
      prdCateCode: prdCode.value,
      prdCateName: prdName.value,
      ebayCateCode: ebayCode.value,
      ebayCateName: ebayName.value,
      present: prdCode.present || prdName.present || ebayCode.present || ebayName.present,
      filled: !!(prdCode.value && prdName.value)
    };
  };
  const categoryStatus = channelDefs.map((def) => {
    const prefix = `template_data[${def.platform}|${def.formAccount}][eMarketCategory`;
    const fields = [1, 2, 3, 4].map((level) => {
      const selector = `select[name="${attrValueSelector(`${prefix}${level}]`)}"]`;
      const el = document.querySelector(selector);
      if (!el) return { level, present: false, required: false, filled: false };
      const selected = selectText(el);
      const rawValue = norm(el.value);
      const required = Number((el.options || []).length || 0) > 1;
      return {
        level,
        present: true,
        required,
        value: rawValue,
        selectedText: selected,
        filled: !!((rawValue || selected) && !placeholderRe.test(selected || ''))
      };
    });
    const requiredFields = fields.filter((field) => field.required);
    const anyFilled = fields.some((field) => field.present && field.filled);
    const hidden = hiddenCategoryStatus(def);
    return {
      id: def.id,
      detected: fields.some((field) => field.present) || hidden.present,
      hidden,
      missing: !hidden.filled && (requiredFields.some((field) => !field.filled) || !anyFilled)
    };
  });
  const anyCategoryFieldDetected = categoryStatus.some((item) => item.detected);
  const categoryNeededText = /표준카테고리를 선택해주세요|카테고리를 선택|카테고리.*필수/.test(text);
  const categoryNeeded = anyCategoryFieldDetected
    ? categoryStatus.some((item) => item.detected && item.missing)
    : categoryNeededText;
  const sendLimitWarning = /최대 상품 수량|더이상 상품을 전송|판매중인 상품 수를 조정/.test(text);
  const advisoryWarnings = sendLimitWarning
    ? ['마켓 상품 수량 제한 안내 문구가 감지됐습니다. 테스트 1개 전송 차단 사유로 확정하지 않고 참고 경고로만 표시합니다.']
    : [];
  const hasDirectSend = buttons.some((btn) => /바로\s*전송|상품\s*보내기|전송/.test(btn.text || ''));
  const hasMarketSetting = buttons.some((btn) => /마켓별\s*상세설정|상세설정/.test(btn.text || ''));
  const hasSelectAll = buttons.some((btn) => /전체\s*선택|전체\s*해제/.test(btn.text || ''));
  const channels = channelDefs.map((def) => {
    const aliasHit = findText(def.aliases);
    const accountHit = findText(def.accounts);
    const inputHits = inputs.filter((input) => includesAny(norm(`${input.label} ${input.name} ${input.id} ${input.value}`), def.aliases.concat(def.accounts)));
    const detectedText = [aliasHit, accountHit, ...inputHits.map((input) => input.value || input.label).filter(Boolean).slice(0, 2)].filter(Boolean).join(' / ');
    const present = !!(aliasHit || accountHit || inputHits.length);
    const needs = [];
    if (!present) needs.push('채널 행 미감지');
    if (!accountHit && def.accounts.length) needs.push('계정명 확인 필요');
    if (categoryNeeded) needs.push('표준카테고리 선택 필요');
    if (!hasDirectSend) needs.push('전송 버튼 확인 필요');
    return {
      id: def.id,
      label: def.label,
      present,
      account: accountHit,
      detectedAlias: aliasHit,
      detectedText,
      ready: present && needs.length === 0,
      needs
    };
  });
  const productNo = (location.href.match(/product_no=(\d+)/) || [])[1] || (text.match(/상품번호\s*#?(\d+)/) || [])[1] || '';
  const productCode = (text.match(/\bP[0-9A-Z]{6,}\b/) || [''])[0];
  let productName = '';
  const productInfoMatch = text.match(/상품정보\s+(.{1,100}?)\s+\/\s+P[0-9A-Z]{6,}/);
  if (productInfoMatch) productName = norm(productInfoMatch[1]);
  if (!productName && productCode) {
    const codeIndex = text.indexOf(productCode);
    productName = norm(text.slice(Math.max(0, codeIndex - 90), codeIndex).replace(/상품정보|상품명|코드/g, ''));
  }
  const needsAction = [];
  if (categoryNeeded) needsAction.push('마켓플러스 표준카테고리 선택 필요');
  if (!hasDirectSend) needsAction.push('바로 전송/상품 보내기 버튼 미감지');
  channels.forEach((channel) => {
    if (!channel.present) needsAction.push(`${channel.label} 채널 행 확인 필요`);
  });
  return {
    title: document.title || '',
    url: location.href || '',
    productNo,
    productCode,
    productName,
    categoryNeeded,
    sendLimitWarning,
    advisoryWarnings,
    buttons: { hasDirectSend, hasMarketSetting, hasSelectAll, count: buttons.length },
    channels,
    needsAction: Array.from(new Set(needsAction)),
    textSnippet: text.slice(0, 6500),
    inputsCount: inputs.length
  };
})()
"""
        status = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=15)
        if not isinstance(status, dict):
            status = {}
        channels = status.get("channels") if isinstance(status.get("channels"), list) else []
        ready_channels = [item for item in channels if isinstance(item, dict) and item.get("ready")]
        blocked = bool(status.get("categoryNeeded") or status.get("needsAction"))
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or status.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url") or status.get("url")),
                "stage": _marketplus_tab_stage(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
            },
            "detail": {
                "title": str(status.get("title") or "")[:180],
                "url": _safe_browser_tab_url(status.get("url")),
                "productNo": str(status.get("productNo") or "")[:60],
                "productCode": str(status.get("productCode") or "")[:80],
                "productName": _redact_marketplus_debug_text(status.get("productName"), 220),
                "categoryNeeded": bool(status.get("categoryNeeded")),
                "sendLimitWarning": bool(status.get("sendLimitWarning")),
                "advisoryWarnings": status.get("advisoryWarnings") if isinstance(status.get("advisoryWarnings"), list) else [],
                "buttons": status.get("buttons") if isinstance(status.get("buttons"), dict) else {},
                "channels": channels,
                "readyChannelCount": len(ready_channels),
                "channelCount": len(channels),
                "needsAction": status.get("needsAction") if isinstance(status.get("needsAction"), list) else [],
                "textSnippet": _redact_marketplus_debug_text(status.get("textSnippet"), 6500),
                "inputsCount": int(status.get("inputsCount") or 0),
                "blocked": blocked,
            },
            "note": "마켓플러스 상품보내기 상세 화면을 읽었습니다. 클릭/저장/전송은 실행하지 않았습니다.",
        })
    except Exception as e:
        if "timed out" in str(e).lower():
            if isinstance(tab, dict):
                return _marketplus_tab_timeout_response(port, tab, "상품보내기 상세")
            return _chrome_debug_timeout_response(port, "마켓플러스 상품보내기 상세")
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 상세 전송상태 읽기에 실패했습니다. Chrome 디버그 포트와 상품보내기 상세 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/category-fields", methods=["GET"])
def marketplus_category_fields():
    """Read marketplace category select fields on the MarketPlus detail screen.

    Read-only by design. It extracts the real Cafe24/MarketPlus category inputs
    for the five managed channels so the UI can show what is missing before any
    guarded fill/send automation is allowed.
    """
    try:
        port = int(request.args.get("port") or 9224)
    except Exception:
        port = 9224
    raw_markets = str(request.args.get("markets") or "").strip()
    requested_markets = {
        item.strip().lower()
        for item in raw_markets.split(",")
        if item.strip()
    }
    tab = None
    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        tab = _marketplus_pick_product_detail_tab(raw_tabs, "marketplus")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "tabCount": len(loaded.get("safeTabs") or []),
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 마켓플러스 상세 화면을 찾지 못했습니다. 상품보내기 상세 화면을 연 뒤 다시 읽어주세요.",
            })
        _activate_chrome_debug_tab(port, tab)

        expression = r"""
(() => {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const pageText = document.body ? (document.body.textContent || document.body.innerText || '') : '';
  const text = norm(pageText);
  const defs = [
    { id:'gmarket', label:'G마켓', platform:'gmarket', account:'1928bojagi' },
    { id:'auction', label:'옥션', platform:'auction', account:'bojagi1928' },
    { id:'elevenst', label:'11번가', platform:'sk11st', account:'bojagi1928' },
    { id:'smartstore', label:'스마트스토어', platform:'shopn', account:'ncp_1nn03r_01' },
    { id:'coupang', label:'쿠팡', platform:'coupang', account:'bojagi1928' }
  ];
  const attrValueSelector = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const selectedText = (select) => norm(select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0].textContent : '');
  const optionSummary = (select) => Array.from(select.options || [])
    .map((option, index) => ({
      index,
      value: norm(option.value),
      text: norm(option.textContent),
      disabled: !!option.disabled,
      selected: !!option.selected
    }))
    .filter((option) => option.text || option.value)
    .slice(0, 240);
  const categoryNeededText = /표준카테고리를 선택해주세요|표준카테고리.*선택|카테고리를 선택|카테고리.*필수/.test(text);
  const sendLimitWarning = /최대 상품 수량|더이상 상품을 전송|판매중인 상품 수를 조정/.test(text);
  const markets = defs.map((def) => {
    const key = `${def.platform}|${def.account}`;
    const prefix = `template_data[${key}][eMarketCategory`;
    const readHidden = (field) => {
      const name = `template_data[${key}][${field}]`;
      const escapedName = attrValueSelector(name);
      const el = document.querySelector(`input[name="${escapedName}"], textarea[name="${escapedName}"], select[name="${escapedName}"]`);
      return {
        field,
        name,
        present: !!el,
        visible: !!el && visible(el),
        tag: el ? el.tagName : '',
        value: norm(el && el.value)
      };
    };
    const hiddenFields = [
      readHidden('large_cate_code'),
      readHidden('large_cate_name'),
      readHidden('middle_cate_code'),
      readHidden('middle_cate_name'),
      readHidden('prd_cate_code'),
      readHidden('prd_cate_name'),
      readHidden('market_data][ebay_prd_cate_code'),
      readHidden('market_data][ebay_prd_cate_name'),
    ];
    const prdCateCode = hiddenFields.find((field) => field.field === 'prd_cate_code');
    const prdCateName = hiddenFields.find((field) => field.field === 'prd_cate_name');
    const hiddenCategoryReady = !!(prdCateCode && prdCateCode.value && prdCateName && prdCateName.value);
    const fields = [1, 2, 3, 4].map((level) => {
      const name = `${prefix}${level}]`;
      const escapedName = attrValueSelector(name);
      const selector = `select[name="${escapedName}"], input[name="${escapedName}"]`;
      const el = document.querySelector(selector);
      if (!el) {
        return {
          level,
          name,
          present: false,
          tag: '',
          value: '',
          selectedText: '',
          optionCount: 0,
          nonEmptyOptionCount: 0,
          options: []
        };
      }
      const options = el.tagName === 'SELECT' ? optionSummary(el) : [];
      return {
        level,
        name,
        present: true,
        visible: visible(el),
        tag: el.tagName,
        value: norm(el.value),
        selectedText: el.tagName === 'SELECT' ? selectedText(el) : norm(el.value),
        optionCount: el.tagName === 'SELECT' ? (el.options || []).length : 0,
        nonEmptyOptionCount: options.filter((option) => option.value || option.text).length,
        options
      };
    });
    const placeholderRe = /^(대분류|중분류|소분류|세분류|상세분류|선택)/;
    const requiredFields = fields.filter((field) => {
      if (!field.present) return false;
      if (field.tag === 'SELECT') return Number(field.optionCount || 0) > 1;
      return true;
    });
    const isFilled = (field) => !!((field.value || field.selectedText) && !placeholderRe.test(field.selectedText || ''));
    const missingFields = requiredFields.filter((field) => !isFilled(field));
    const present = fields.some((field) => field.present);
    const filled = fields.filter((field) => field.present && isFilled(field)).length;
    const nextEmpty = missingFields[0] || null;
    const firstFieldEmpty = fields.some((field) => field.level === 1 && field.present && !isFilled(field));
    const categoryMissing = !hiddenCategoryReady && (missingFields.length > 0 || (present && filled === 0 && firstFieldEmpty));
    return {
      id: def.id,
      label: def.label,
      platform: def.platform,
      account: def.account,
      present: present || hiddenFields.some((field) => field.present),
      filledLevelCount: filled,
      hiddenCategoryReady,
      hiddenFields,
      categoryMissing,
      ready: (present || hiddenFields.some((field) => field.present)) && (hiddenCategoryReady || filled > 0) && !categoryMissing,
      needs: [
        !(present || hiddenFields.some((field) => field.present)) ? '카테고리 필드 미감지' : '',
        !hiddenCategoryReady && present && filled === 0 ? '대분류 선택 필요' : '',
        categoryMissing ? '마켓플러스 표준카테고리 선택 필요' : '',
      ].filter(Boolean),
      nextEmptyLevel: nextEmpty ? nextEmpty.level : null,
      fields
    };
  });
  const anyCategoryFieldDetected = markets.some((market) => market.present);
  const categoryNeeded = anyCategoryFieldDetected
    ? markets.some((market) => market.present && market.categoryMissing)
    : categoryNeededText;
  const productCode = (text.match(/\bP[0-9A-Z]{6,}\b/) || [''])[0];
  const productNo = (location.href.match(/product_no=(\d+)/) || [])[1] || (text.match(/상품번호\s*#?(\d+)/) || [])[1] || '';
  return {
    title: document.title || '',
    url: location.href || '',
    productNo,
    productCode,
    categoryNeeded,
    sendLimitWarning,
    advisoryWarnings: sendLimitWarning
      ? ['마켓 상품 수량 제한 안내 문구가 감지됐지만 1개 테스트 송출의 차단 사유로 확정하지 않습니다.']
      : [],
    markets,
    textSnippet: text.slice(0, 1600)
  };
})()
"""
        data = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=7)
        if not isinstance(data, dict):
            data = {}
        markets = data.get("markets") if isinstance(data.get("markets"), list) else []
        if requested_markets:
            markets = [
                item for item in markets
                if isinstance(item, dict)
                and str(item.get("id") or "").lower() in requested_markets
            ]
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or data.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url") or data.get("url")),
                "stage": _marketplus_tab_stage(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
            },
            "detail": {
                "title": str(data.get("title") or "")[:180],
                "url": _safe_browser_tab_url(data.get("url")),
                "productNo": str(data.get("productNo") or "")[:60],
                "productCode": str(data.get("productCode") or "")[:80],
                "categoryNeeded": bool(data.get("categoryNeeded")),
                "sendLimitWarning": bool(data.get("sendLimitWarning")),
                "advisoryWarnings": data.get("advisoryWarnings") if isinstance(data.get("advisoryWarnings"), list) else [],
                "markets": markets,
                "marketCount": len(markets),
                "readyMarketCount": len([item for item in markets if isinstance(item, dict) and item.get("ready")]),
                "textSnippet": _redact_marketplus_debug_text(data.get("textSnippet"), 1800),
            },
            "note": "마켓플러스 채널별 카테고리 필드를 읽었습니다. 클릭/저장/전송은 실행하지 않았습니다.",
        })
    except Exception as e:
        if "timed out" in str(e).lower():
            if isinstance(tab, dict):
                return _marketplus_tab_timeout_response(port, tab, "카테고리 필드")
            return _chrome_debug_timeout_response(port, "마켓플러스 카테고리 필드")
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 카테고리 필드 읽기에 실패했습니다. Chrome 디버그 포트와 상품보내기 상세 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/category-apply", methods=["POST"])
def marketplus_category_apply():
    """Apply selected MarketPlus category values to the current detail form.

    This changes only the category select/input fields on the opened
    MarketPlus detail screen. It does not click save, send, register, or any
    final marketplace action.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    dry_run = bool(payload.get("dryRun", False))
    try:
        wait_ms = int(payload.get("waitMs") or 900)
    except Exception:
        wait_ms = 900
    wait_ms = max(100, min(3500, wait_ms))
    template_set_no = str(
        payload.get("setNo")
        or payload.get("standardSetNo")
        or payload.get("templateSetNo")
        or ""
    ).strip()[:80]
    template_history_no = str(
        payload.get("historyNo")
        or payload.get("categoryHistoryNo")
        or ""
    ).strip()[:80]
    template_keyword = str(
        payload.get("templateKeyword")
        or payload.get("standardCategoryName")
        or payload.get("templateName")
        or ""
    ).strip()[:120]
    allowed = {
        "gmarket": {"id": "gmarket", "label": "G마켓", "platform": "gmarket", "account": "1928bojagi"},
        "auction": {"id": "auction", "label": "옥션", "platform": "auction", "account": "bojagi1928"},
        "elevenst": {"id": "elevenst", "label": "11번가", "platform": "sk11st", "account": "bojagi1928"},
        "smartstore": {"id": "smartstore", "label": "스마트스토어", "platform": "shopn", "account": "ncp_1nn03r_01"},
        "coupang": {"id": "coupang", "label": "쿠팡", "platform": "coupang", "account": "bojagi1928"},
    }
    raw_markets = payload.get("markets")
    if isinstance(raw_markets, dict):
        raw_markets = [raw_markets]
    if not isinstance(raw_markets, list):
        raw_markets = []
    targets = []
    for raw_market in raw_markets:
        if not isinstance(raw_market, dict):
            continue
        market_id = str(raw_market.get("id") or raw_market.get("marketId") or "").strip().lower()
        market = allowed.get(market_id)
        if not market:
            continue
        raw_fields = raw_market.get("fields")
        if isinstance(raw_fields, dict):
            raw_fields = [raw_fields]
        fields = []
        for raw_field in raw_fields or []:
            if not isinstance(raw_field, dict):
                continue
            try:
                level = int(raw_field.get("level") or 0)
            except Exception:
                level = 0
            if level < 1 or level > 4:
                continue
            value = str(raw_field.get("value") or "").strip()
            text_value = str(raw_field.get("text") or raw_field.get("selectedText") or "").strip()
            if not value and not text_value:
                continue
            fields.append({
                "level": level,
                "value": value[:120],
                "text": text_value[:180],
            })
        if fields:
            fields = sorted(fields, key=lambda item: item["level"])[:4]
            targets.append({**market, "fields": fields})
    if not targets and not (template_set_no or template_history_no or template_keyword):
        return jsonify({
            "ok": False,
            "reason": "missing_category_targets",
            "note": "적용할 마켓/카테고리 값이 없습니다. 먼저 카테고리 필드를 읽고 선택값을 고르거나 저장 템플릿 번호를 전달하세요.",
        }), 400

    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        tab = _marketplus_pick_product_detail_tab(raw_tabs, "marketplus")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_marketplus_detail_tab",
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 마켓플러스 상품보내기 상세 화면을 찾지 못했습니다.",
            }), 409
        _activate_chrome_debug_tab(port, tab)

        if not targets and (template_set_no or template_history_no or template_keyword):
            requested_market_ids = []
            for raw_market in raw_markets:
                if isinstance(raw_market, dict):
                    market_id = str(raw_market.get("id") or raw_market.get("marketId") or "").strip().lower()
                else:
                    market_id = str(raw_market or "").strip().lower()
                if market_id in allowed:
                    requested_market_ids.append(market_id)
            template_context = {
                "setNo": template_set_no,
                "historyNo": template_history_no,
                "keyword": template_keyword,
                "marketIds": requested_market_ids,
                "dryRun": dry_run,
            }
            expression = f"""
(() => {{
  const ctx = {json.dumps(template_context, ensure_ascii=False)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const attrValueSelector = (value) => String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const scriptText = Array.from(document.scripts).map(script => script.textContent || '').join('\\n');
  const getAssigned = (name) => {{
    const marker = name + ' = ';
    const startIndex = scriptText.indexOf(marker);
    if (startIndex < 0) return null;
    const quoteStart = scriptText.indexOf("'", startIndex);
    if (quoteStart < 0) return null;
    let cursor = quoteStart + 1;
    while (cursor < scriptText.length) {{
      if (scriptText[cursor] === "'" && scriptText[cursor - 1] !== '\\\\') break;
      cursor += 1;
    }}
    return scriptText.slice(quoteStart + 1, cursor);
  }};
  const decodeAssigned = (name) => {{
    const raw = getAssigned(name);
    if (!raw) return {{}};
    try {{
      return JSON.parse(decodeURIComponent(raw));
    }} catch (error) {{
      return {{ __decodeError: String(error && error.message || error) }};
    }}
  }};
  const standardTemplates = decodeAssigned('oProductDetail.aStandardCategoryHistoryList') || {{}};
  const categoryHistories = decodeAssigned('oProductDetail.aCategoryHistoryList') || {{}};
  const valueText = (value) => {{
    try {{
      return JSON.stringify(value || '');
    }} catch (_) {{
      return String(value || '');
    }}
  }};
  const findByKeyword = (source, keyword) => {{
    const needle = norm(keyword);
    if (!needle) return null;
    return Object.entries(source || {{}}).find(([key, value]) => norm(key) === needle || valueText(value).includes(needle)) || null;
  }};
  let sourceType = '';
  let sourceKey = '';
  let selected = null;
  if (ctx.setNo && standardTemplates && standardTemplates[ctx.setNo]) {{
    sourceType = 'standard';
    sourceKey = ctx.setNo;
    selected = standardTemplates[ctx.setNo];
  }}
  if (!selected && ctx.historyNo && categoryHistories && categoryHistories[ctx.historyNo]) {{
    sourceType = 'history';
    sourceKey = ctx.historyNo;
    selected = categoryHistories[ctx.historyNo];
  }}
  if (!selected && ctx.keyword) {{
    const standardHit = findByKeyword(standardTemplates, ctx.keyword);
    const historyHit = findByKeyword(categoryHistories, ctx.keyword);
    if (standardHit) {{
      sourceType = 'standard';
      sourceKey = standardHit[0];
      selected = standardHit[1];
    }} else if (historyHit) {{
      sourceType = 'history';
      sourceKey = historyHit[0];
      selected = historyHit[1];
    }}
  }}
  if (!selected) {{
    return {{
      ok:false,
      reason:'category_template_not_found',
      requested: ctx,
      availableStandardTemplates: Object.keys(standardTemplates || {{}}).slice(0, 30),
      availableCategoryHistories: Object.keys(categoryHistories || {{}}).slice(0, 30),
      note:'지정한 마켓플러스 카테고리 저장 템플릿을 페이지 데이터에서 찾지 못했습니다.'
    }};
  }}
  const defs = [
    {{ id:'gmarket', label:'G마켓', platform:'gmarket', account:'1928bojagi' }},
    {{ id:'auction', label:'옥션', platform:'auction', account:'bojagi1928' }},
    {{ id:'elevenst', label:'11번가', platform:'sk11st', account:'bojagi1928' }},
    {{ id:'smartstore', label:'스마트스토어', platform:'shopn', account:'ncp_1nn03r_01' }},
    {{ id:'coupang', label:'쿠팡', platform:'coupang', account:'bojagi1928' }}
  ].filter(def => !Array.isArray(ctx.marketIds) || ctx.marketIds.length === 0 || ctx.marketIds.includes(def.id));
  const categoryNodes = [];
  const flatten = (node, path = []) => {{
    if (!node || typeof node !== 'object') return;
    const hasCategory = [
      'prd_cate_code', 'prd_cate_name', 'ebay_prd_cate_code', 'ebay_prd_cate_name',
      'template_no', 'parent_template_no', 'market_template_no', 'eMarketTemplate'
    ].some(key => Object.prototype.hasOwnProperty.call(node, key));
    if (hasCategory) categoryNodes.push({{ path: path.join('|'), node }});
    Object.entries(node).forEach(([key, value]) => flatten(value, path.concat(key)));
  }};
  flatten(selected);
  const pick = (node, keys) => {{
    for (const key of keys) {{
      if (node && node[key] !== undefined && node[key] !== null && norm(node[key]) !== '') return norm(node[key]);
    }}
    return '';
  }};
  const selectForMarket = (def) => {{
    const token = def.platform + '|' + def.account;
    const byPath = categoryNodes.find(item => item.path.includes(token));
    if (byPath) return byPath.node;
    const byText = categoryNodes.find(item => {{
      const text = valueText(item.node);
      return text.includes(def.platform) && text.includes(def.account);
    }});
    if (byText) return byText.node;
    const byPlatform = categoryNodes.find(item => item.path.includes(def.platform) || valueText(item.node).includes(def.platform));
    return byPlatform ? byPlatform.node : null;
  }};
  const setNamedValue = (name, value, options = {{}}) => {{
    const escapedName = attrValueSelector(name);
    const elements = Array.from(document.querySelectorAll(
      `input[name="${{escapedName}}"], textarea[name="${{escapedName}}"], select[name="${{escapedName}}"]`
    ));
    const cleanValue = norm(value);
    if (!cleanValue) return {{ name, value:'', present:elements.length > 0, changed:false, skipped:true, reason:'empty_value_not_written' }};
    if (!elements.length) return {{ name, value:cleanValue, present:false, changed:false }};
    const updates = elements.map(el => {{
      const before = norm(el.value);
      let nextValue = cleanValue;
      let matchedOptionText = '';
      if (el.tagName === 'SELECT') {{
        const opts = Array.from(el.options || []);
        let option = opts.find(item => norm(item.value) === nextValue);
        if (!option && options.prefixMatch && nextValue) option = opts.find(item => norm(item.value).startsWith(nextValue + '|'));
        if (!option && nextValue) option = opts.find(item => norm(item.textContent) === nextValue);
        if (!option && options.textMatch) option = opts.find(item => norm(item.textContent).includes(options.textMatch));
        if (option) {{
          nextValue = option.value;
          matchedOptionText = norm(option.textContent);
        }} else if (opts.length > 0) {{
          return {{ tag:el.tagName, before, after:before, changed:false, reason:'select_option_not_found' }};
        }}
      }}
      if (!ctx.dryRun) {{
        el.value = nextValue;
        if (el.tagName === 'SELECT') {{
          const option = Array.from(el.options || []).find(item => norm(item.value) === norm(nextValue));
          if (option) option.selected = true;
        }}
        el.dispatchEvent(new Event('input', {{ bubbles:true }}));
        el.dispatchEvent(new Event('change', {{ bubbles:true }}));
        try {{
          if (window.jQuery) window.jQuery(el).trigger('change');
        }} catch (_) {{}}
      }}
      return {{ tag:el.tagName, before, after:nextValue, matchedOptionText, changed: before !== nextValue || ctx.dryRun }};
    }});
    return {{ name, value: norm(value), present:true, changed: updates.some(item => item.changed), updates }};
  }};
  const applied = defs.map(def => {{
    const key = def.platform + '|' + def.account;
    const node = selectForMarket(def);
    if (!node) {{
      return {{ id:def.id, label:def.label, ok:false, reason:'market_template_missing', key, note:'선택 템플릿에서 이 마켓의 카테고리 값을 찾지 못했습니다.' }};
    }}
    const prdCode = pick(node, ['prd_cate_code', 'prdCateCode', 'category_code', 'cate_code']);
    const prdName = pick(node, ['prd_cate_name', 'prdCateName', 'category_name', 'cate_name']);
    const ebayCode = pick(node, ['ebay_prd_cate_code', 'ebayCateCode']);
    const ebayName = pick(node, ['ebay_prd_cate_name', 'ebayCateName']);
    const templateNo = pick(node, ['template_no', 'market_template_no', 'eMarketTemplate']);
    let parentTemplateNo = pick(node, ['parent_template_no']);
    if (!parentTemplateNo && templateNo) {{
      const templateSelectName = `template_data[${{key}}][eMarketTemplate]`;
      const templateSelect = document.querySelector(`select[name="${{attrValueSelector(templateSelectName)}}"]`);
      const templateOption = templateSelect
        ? Array.from(templateSelect.options || []).find(option => norm(option.value).startsWith(templateNo + '|'))
        : null;
      const templateValue = norm(templateOption && templateOption.value);
      if (templateValue.includes('|')) parentTemplateNo = templateValue.split('|').slice(1).join('|');
    }}
    const parts = prdName.split(/\\+>|>/).map(part => norm(part)).filter(Boolean);
    const writes = [
      setNamedValue(`template_data[${{key}}][prd_cate_code]`, prdCode),
      setNamedValue(`template_data[${{key}}][prd_cate_name]`, prdName),
      setNamedValue(`template_data[${{key}}][large_cate_name]`, pick(node, ['large_cate_name']) || parts[0] || ''),
      setNamedValue(`template_data[${{key}}][middle_cate_name]`, pick(node, ['middle_cate_name']) || parts[1] || ''),
      setNamedValue(`template_data[${{key}}][market_data][ebay_prd_cate_code]`, ebayCode),
      setNamedValue(`template_data[${{key}}][market_data][ebay_prd_cate_name]`, ebayName),
      setNamedValue(`template_data[${{key}}][template_no]`, templateNo),
      setNamedValue(`template_data[${{key}}][parent_template_no]`, parentTemplateNo),
      setNamedValue(`template_data[${{key}}][eMarketTemplate]`, templateNo, {{ prefixMatch:true, textMatch:'주머니' }}),
    ].filter(item => item.value || item.present);
    const codeRead = document.querySelector(`input[name="${{attrValueSelector(`template_data[${{key}}][prd_cate_code]`)}}"]`);
    const nameRead = document.querySelector(`input[name="${{attrValueSelector(`template_data[${{key}}][prd_cate_name]`)}}"]`);
    const afterCode = norm(codeRead && codeRead.value);
    const afterName = norm(nameRead && nameRead.value);
    return {{
      id:def.id,
      label:def.label,
      key,
      ok: !!(afterCode && afterName),
      prdCateCode: afterCode,
      prdCateName: afterName,
      ebayCateCode: ebayCode,
      ebayCateName: ebayName,
      templateNo,
      parentTemplateNo,
      writes,
      note: afterCode && afterName ? '저장 템플릿 카테고리 hidden 값을 적용했습니다.' : '카테고리 hidden 값 적용 후에도 값이 비어 있습니다.'
    }};
  }});
  const ok = applied.length > 0 && applied.every(item => item.ok);
  return {{
    ok,
    dryRun: !!ctx.dryRun,
    sourceType,
    sourceKey,
    requested: ctx,
    applied,
    note: ok
      ? '마켓플러스 저장 템플릿 카테고리 값을 적용했습니다. 저장/전송은 실행하지 않았습니다.'
      : '일부 마켓의 저장 템플릿 카테고리 값을 적용하지 못했습니다.'
  }};
}})()
"""
            result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=10)
            if not isinstance(result, dict):
                result = {"ok": False, "reason": "invalid_runtime_result", "note": "저장 템플릿 적용 결과가 비어 있습니다."}
            return jsonify({
                "ok": bool(result.get("ok")),
                "connected": True,
                "debugPort": port,
                "dryRun": dry_run,
                "tab": {
                    "id": str(tab.get("id") or "")[:80],
                    "title": str(tab.get("title") or "")[:180],
                    "url": _safe_browser_tab_url(tab.get("url")),
                    "stage": _marketplus_tab_stage(tab),
                    "isMarketPlus": _is_marketplus_tab(tab),
                },
                "result": result,
                "note": result.get("note") or "마켓플러스 저장 템플릿 카테고리 적용을 실행했습니다.",
            }), 200 if result.get("ok") else 409

        results = []
        for market in targets:
            market_results = []
            for field in market["fields"]:
                context = {
                    "platform": market["platform"],
                    "account": market["account"],
                    "marketId": market["id"],
                    "label": market["label"],
                    "level": field["level"],
                    "value": field["value"],
                    "text": field["text"],
                    "dryRun": dry_run,
                }
                expression = f"""
(() => {{
  const ctx = {json.dumps(context, ensure_ascii=False)};
  const norm = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
  const attrValueSelector = (value) => String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const visible = (el) => {{
    try {{
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const name = `template_data[${{ctx.platform}}|${{ctx.account}}][eMarketCategory${{ctx.level}}]`;
  const escapedName = attrValueSelector(name);
  const el = document.querySelector(`select[name="${{escapedName}}"], input[name="${{escapedName}}"]`);
  if (!el) {{
    return {{ ok:false, reason:'field_not_found', marketId:ctx.marketId, label:ctx.label, level:ctx.level, name, note:'카테고리 필드를 찾지 못했습니다.' }};
  }}
  const before = {{
    value: norm(el.value),
    text: el.tagName === 'SELECT' && el.selectedOptions && el.selectedOptions[0] ? norm(el.selectedOptions[0].textContent) : norm(el.value),
    visible: visible(el),
    tag: el.tagName,
  }};
  let option = null;
  const candidates = el.tagName === 'SELECT' ? Array.from(el.options || []) : [];
  if (el.tagName === 'SELECT') {{
    option = candidates.find(item => norm(item.value) === norm(ctx.value) && norm(ctx.value));
    if (!option && ctx.text) option = candidates.find(item => norm(item.textContent) === norm(ctx.text));
    if (!option && ctx.value) option = candidates.find(item => norm(item.textContent) === norm(ctx.value));
    if (!option) {{
      return {{
        ok:false,
        reason:'option_not_found',
        marketId:ctx.marketId,
        label:ctx.label,
        level:ctx.level,
        name,
        requestedValue: ctx.value,
        requestedText: ctx.text,
        before,
        optionPreview: candidates.map(item => ({{ value:norm(item.value), text:norm(item.textContent) }})).filter(item => item.value || item.text).slice(0, 30),
        note:'선택하려는 카테고리 옵션을 현재 select에서 찾지 못했습니다.'
      }};
    }}
    if (ctx.dryRun) {{
      return {{
        ok:true,
        dryRun:true,
        marketId:ctx.marketId,
        label:ctx.label,
        level:ctx.level,
        name,
        before,
        after: {{ value:norm(option.value), text:norm(option.textContent) }},
        note:'dry-run: 카테고리 옵션을 찾았고 적용 가능하지만 값을 변경하지 않았습니다.'
      }};
    }}
    el.value = option.value;
    option.selected = true;
  }} else {{
    if (ctx.dryRun) {{
      return {{
        ok:true,
        dryRun:true,
        marketId:ctx.marketId,
        label:ctx.label,
        level:ctx.level,
        name,
        before,
        after: {{ value: norm(ctx.value || ctx.text), text: norm(ctx.text || ctx.value) }},
        note:'dry-run: input 값을 적용할 수 있지만 변경하지 않았습니다.'
      }};
    }}
    el.value = ctx.value || ctx.text;
  }}
  el.dispatchEvent(new Event('input', {{ bubbles:true }}));
  el.dispatchEvent(new Event('change', {{ bubbles:true }}));
  try {{
    if (window.jQuery) window.jQuery(el).trigger('change');
  }} catch (_) {{}}
  const after = {{
    value: norm(el.value),
    text: el.tagName === 'SELECT' && el.selectedOptions && el.selectedOptions[0] ? norm(el.selectedOptions[0].textContent) : norm(el.value),
    visible: visible(el),
    tag: el.tagName,
  }};
  return {{
    ok:true,
    dryRun:false,
    marketId:ctx.marketId,
    label:ctx.label,
    level:ctx.level,
    name,
    before,
    after,
    note:'카테고리 필드 값을 적용했습니다. 저장/전송은 실행하지 않았습니다.'
  }};
}})()
"""
                result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=8)
                if not isinstance(result, dict):
                    result = {"ok": False, "reason": "invalid_runtime_result", "note": "카테고리 적용 결과가 비어 있습니다."}
                market_results.append(result)
                if not result.get("ok"):
                    break
                if not dry_run:
                    time.sleep(wait_ms / 1000.0)
            results.append({
                "id": market["id"],
                "label": market["label"],
                "platform": market["platform"],
                "account": market["account"],
                "ok": all(item.get("ok") for item in market_results),
                "fields": market_results,
            })
        ok = all(item.get("ok") for item in results)
        response = {
            "ok": ok,
            "connected": True,
            "debugPort": port,
            "dryRun": dry_run,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url")),
                "stage": _marketplus_tab_stage(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
            },
            "results": results,
            "note": "마켓플러스 카테고리 값을 적용했습니다. 저장/전송은 실행하지 않았습니다." if ok and not dry_run else (
                "dry-run으로 카테고리 적용 가능 여부를 확인했습니다. 저장/전송은 실행하지 않았습니다." if ok else "일부 카테고리 값을 적용하지 못했습니다."
            ),
        }
        return jsonify(response), 200 if ok else 409
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 카테고리 적용 중 오류가 발생했습니다. 저장/전송은 실행하지 않았습니다.",
        }), 500


@api.route("/marketplus/open-product-send-dialog", methods=["POST"])
def marketplus_open_product_send_dialog():
    """Open the MarketPlus send dialog for one visible Cafe24 product row.

    This endpoint is deliberately narrower than the generic safe-click helper:
    it only works on the MarketPlus "마켓으로보내기" list, requires a product code
    or product name, and clicks only the row-local "마켓으로 보내기" button. It is
    meant to enter the per-product send setup screen/dialog, not to execute the
    final channel send.
    """
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    dry_run = bool(payload.get("dryRun", False))
    capture_network = bool(payload.get("captureNetwork", False))
    product_code = str(payload.get("productCode") or "").strip()[:80]
    product_name = str(payload.get("productName") or "").strip()[:160]
    if not product_code and not product_name:
        return jsonify({
            "ok": False,
            "reason": "missing_product_target",
            "note": "마켓플러스 상품 행을 특정하려면 상품코드나 상품명이 필요합니다.",
        }), 400
    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        list_tabs = [
            item for item in raw_tabs
            if isinstance(item, dict)
            and item.get("webSocketDebuggerUrl")
            and _is_marketplus_tab(item)
            and "/mp/product/front/manageList" in str(item.get("url") or "")
        ]
        detail_tabs = [
            item for item in raw_tabs
            if isinstance(item, dict)
            and item.get("webSocketDebuggerUrl")
            and _is_marketplus_tab(item)
            and "/mp/product/front/detail" in str(item.get("url") or "")
        ]
        tab = list_tabs[0] if list_tabs else (detail_tabs[0] if detail_tabs else _marketplus_pick_tab(raw_tabs, "marketplus"))
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_marketplus_tab",
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "마켓플러스 탭을 찾지 못했습니다.",
            }), 409
        expression = f"""
(() => {{
  const ctx = {json.dumps({"productCode": product_code, "productName": product_name, "dryRun": dry_run}, ensure_ascii=False)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {{
    try {{
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id);
  const targetTokens = [ctx.productCode, ctx.productName].map(norm).filter(value => value.length >= 2);
  const allButtons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({{ el, index, text: labelOf(el), tag: el.tagName, id: el.id || '', name: el.name || '' }}))
    .filter(item => /마켓\\s*으로\\s*보내기|마켓으로\\s*보내기|상품\\s*보내기|보내기/i.test(item.text));
  const rowCandidates = [];
  for (const item of allButtons) {{
    let node = item.el;
    let row = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {{
      const tag = (node.tagName || '').toLowerCase();
      const cls = String(node.className || '');
      if (tag === 'tr' || /row|list|item|product/i.test(cls)) {{
        const text = norm(node.innerText || node.textContent || '');
        if (text && targetTokens.some(token => text.includes(token))) {{
          row = node;
          break;
        }}
      }}
    }}
    if (!row) {{
      const nearby = norm((item.el.closest('tr,li,div') || item.el.parentElement || item.el).innerText || '');
      if (nearby && targetTokens.some(token => nearby.includes(token))) {{
        row = item.el.closest('tr,li,div') || item.el.parentElement;
      }}
    }}
    if (row) {{
      const rowText = norm(row.innerText || row.textContent || '');
      const score = targetTokens.reduce((sum, token) => sum + (rowText.includes(token) ? (token === ctx.productCode ? 80 : 40) : 0), 0)
        + (/마켓\\s*으로\\s*보내기|마켓으로\\s*보내기/i.test(item.text) ? 30 : 5);
      rowCandidates.push({{
        button: item.el,
        index: item.index,
        buttonText: item.text,
        buttonTag: item.tag,
        buttonId: item.id,
        buttonName: item.name,
        buttonClass: String(item.el.className || '').slice(0, 180),
        buttonOuterHtml: String(item.el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 500),
        buttonDataset: Object.assign({{}}, item.el.dataset || {{}}),
        buttonOnclick: String(item.el.getAttribute('onclick') || '').slice(0, 500),
        rowTag: row.tagName || '',
        rowClass: String(row.className || '').slice(0, 180),
        rowDataset: Object.assign({{}}, row.dataset || {{}}),
        formAction: item.el.closest('form') ? String(item.el.closest('form').getAttribute('action') || '') : '',
        formMethod: item.el.closest('form') ? String(item.el.closest('form').getAttribute('method') || '') : '',
        score,
        rowText: rowText.slice(0, 600)
      }});
    }}
  }}
  rowCandidates.sort((a, b) => b.score - a.score);
  const picked = rowCandidates[0] || null;
  const response = {{
    title: document.title || '',
    url: location.href || '',
    targetTokens,
    candidateCount: rowCandidates.length,
    candidates: rowCandidates.slice(0, 8).map(item => ({{
      index: item.index,
      score: item.score,
      buttonText: item.buttonText,
      buttonTag: item.buttonTag,
      buttonId: item.buttonId,
      buttonName: item.buttonName,
      buttonClass: item.buttonClass,
      buttonOuterHtml: item.buttonOuterHtml,
      buttonDataset: item.buttonDataset,
      buttonOnclick: item.buttonOnclick,
      rowTag: item.rowTag,
      rowClass: item.rowClass,
      rowDataset: item.rowDataset,
      formAction: item.formAction,
      formMethod: item.formMethod,
      rowText: item.rowText
    }})),
    picked: picked ? {{
      index: picked.index,
      score: picked.score,
      buttonText: picked.buttonText,
      buttonOuterHtml: picked.buttonOuterHtml,
      buttonDataset: picked.buttonDataset,
      buttonOnclick: picked.buttonOnclick,
      rowDataset: picked.rowDataset,
      formAction: picked.formAction,
      formMethod: picked.formMethod,
      rowText: picked.rowText
    }} : null,
    clicked: false,
    dryRun: !!ctx.dryRun,
    captureNetwork: {str(capture_network).lower()}
  }};
  if (!picked) {{
    return Object.assign(response, {{ error: 'target_product_send_button_not_found' }});
  }}
  if (ctx.dryRun) {{
    return response;
  }}
  picked.button.scrollIntoView({{ block: 'center', inline: 'center' }});
  picked.button.click();
  return Object.assign(response, {{ clicked: true }});
}})()
"""
        if capture_network and not dry_run:
            probe = _cdp_runtime_evaluate_with_network(tab.get("webSocketDebuggerUrl"), expression, timeout=10, event_window=6)
            result = probe.get("value") if isinstance(probe, dict) else None
            if not isinstance(result, dict):
                result = {}
            result["networkProbe"] = (probe or {}).get("network", {})
            if (probe or {}).get("error"):
                result["networkProbeError"] = (probe or {}).get("error")
        else:
            result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=8)
        if not isinstance(result, dict):
            result = {}
        if result.get("error"):
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "tab": _safe_chrome_tab(tab),
                "reason": result.get("error"),
                "result": result,
                "note": "대상 상품 행의 마켓으로 보내기 버튼을 찾지 못했습니다.",
            }), 409
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": _safe_chrome_tab(tab),
            "result": result,
            "note": "대상 상품 행의 마켓으로 보내기 진입 버튼을 확인했습니다." + ("" if dry_run else " 클릭 후 다음 화면을 확인해주세요."),
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 상품 보내기 진입 처리 중 오류가 발생했습니다.",
        }), 500


@api.route("/marketplus/cafe24-product-linkage-status", methods=["GET"])
def marketplus_cafe24_product_linkage_status():
    """Read Cafe24 product-list MarketPlus/open-market linkage evidence.

    This is intentionally read-only. The proof the operator cares about is the
    Cafe24 product list's right-side market interlock column, not merely that a
    MarketPlus detail/send screen was opened.
    """
    try:
        port = int(request.args.get("port") or 9224)
    except Exception:
        port = 9224
    product_name = str(request.args.get("productName") or "").strip()[:180]
    product_no = str(request.args.get("productNo") or "").strip()[:80]
    product_code = str(request.args.get("productCode") or "").strip()[:80]
    raw_channels = str(request.args.get("channels") or "").strip()
    requested_channels = [
        item.strip().lower()
        for item in re.split(r"[,|\s]+", raw_channels)
        if item.strip()
    ] or ["coupang", "smartstore", "gmarket", "auction", "elevenst"]
    context = {
        "productName": product_name,
        "productNo": product_no,
        "productCode": product_code,
        "requestedChannels": requested_channels,
    }
    tab = None
    try:
        loaded = _load_chrome_debug_tabs(port)
        tab = _marketplus_pick_cafe24_product_list_tab(loaded["rawTabs"])
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_cafe24_product_list_tab",
                "tabCount": len(loaded.get("safeTabs") or []),
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 Cafe24 상품목록(ProductBatchManage) 탭을 찾지 못했습니다. 상품목록에서 대상 상품을 검색한 뒤 다시 읽어주세요.",
            })
        _activate_chrome_debug_tab(port, tab)

        expression = r"""
(() => {
  const ctx = __CONTEXT__;
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const lower = (value) => norm(value).toLowerCase();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const attrText = (el) => {
    if (!el || !el.getAttribute) return '';
    return [
      el.getAttribute('alt'),
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-original-title'),
      el.getAttribute('data-title'),
      el.getAttribute('value'),
      el.name,
      el.id
    ].filter(Boolean).join(' ');
  };
  const fullText = (el) => {
    if (!el) return '';
    const own = [
      el.innerText,
      el.textContent,
      attrText(el),
      ...Array.from(el.querySelectorAll ? el.querySelectorAll('img,button,a,span,i,strong,em,input') : [])
        .map(attrText)
    ].filter(Boolean).join(' ');
    return norm(own);
  };
  const docs = [{ doc: document, label: 'top' }];
  Array.from(document.querySelectorAll('iframe,frame')).forEach((frame, index) => {
    try {
      if (frame.contentDocument) docs.push({ doc: frame.contentDocument, label: `frame-${index}` });
    } catch (_) {}
  });
  const tokens = [ctx.productCode, ctx.productName, ctx.productNo]
    .map(norm)
    .filter((item) => item.length >= 2);
  const channelDefs = {
    coupang: { label: '쿠팡', patterns: [/쿠팡/i, /고팡/i, /coupang/i, /wing/i] },
    smartstore: { label: '스마트스토어', patterns: [/스마트\s*스토어/i, /smart\s*store/i, /naver/i, /네이버/i] },
    gmarket: { label: 'G마켓', patterns: [/g\s*마켓/i, /지마켓/i, /gmarket/i, /g-market/i] },
    auction: { label: '옥션', patterns: [/옥션/i, /auction/i] },
    elevenst: { label: '11번가', patterns: [/11\s*번가/i, /십일번가/i, /11st/i] },
    kakao: { label: '카카오톡 스토어', patterns: [/카카오톡\s*스토어/i, /카카오\s*스토어/i, /kakao/i] }
  };
  const requested = (Array.isArray(ctx.requestedChannels) && ctx.requestedChannels.length
    ? ctx.requestedChannels
    : ['coupang', 'smartstore', 'gmarket', 'auction', 'elevenst'])
    .filter((id) => channelDefs[id]);
  const rows = [];
  docs.forEach(({ doc, label }) => {
    Array.from(doc.querySelectorAll('tr')).forEach((row, rowIndex) => {
      if (!visible(row)) return;
      const cells = Array.from(row.children || []).map((cell, cellIndex) => ({
        index: cellIndex,
        text: fullText(cell).slice(0, 1200)
      }));
      const rowText = fullText(row).slice(0, 5000);
      if (!rowText) return;
      let score = 0;
      const matchedTokens = [];
      tokens.forEach((token) => {
        if (rowText.includes(token)) {
          matchedTokens.push(token);
          score += token === ctx.productCode ? 100 : token === ctx.productName ? 80 : 25;
        }
      });
      if (!matchedTokens.length) return;
      const table = row.closest('table');
      const headerCells = table
        ? Array.from(table.querySelectorAll('thead th, thead td')).map((cell, index) => ({ index, text: fullText(cell) }))
        : [];
      let marketIndex = headerCells.find((cell) => /마켓|연동|오픈/i.test(cell.text || ''))?.index;
      if (!Number.isInteger(marketIndex)) {
        marketIndex = Math.max(0, cells.length - 1);
      }
      const marketTexts = [];
      if (cells[marketIndex]) marketTexts.push(cells[marketIndex].text);
      cells.slice(Math.max(0, cells.length - 3)).forEach((cell) => marketTexts.push(cell.text));
      const marketText = norm([...new Set(marketTexts.filter(Boolean))].join(' '));
      const linkedChannels = requested.map((id) => {
        const def = channelDefs[id];
        const hit = def.patterns.some((pattern) => pattern.test(marketText));
        return hit ? { id, label: def.label } : null;
      }).filter(Boolean);
      const optionalChannels = Object.entries(channelDefs)
        .filter(([id]) => !requested.includes(id))
        .map(([id, def]) => def.patterns.some((pattern) => pattern.test(marketText)) ? { id, label: def.label } : null)
        .filter(Boolean);
      rows.push({
        doc: label,
        rowIndex,
        score,
        matchedTokens,
        cellCount: cells.length,
        marketCellIndex: marketIndex,
        marketText: marketText.slice(0, 1600),
        rowText: rowText.slice(0, 2200),
        cells: cells.map((cell) => ({ index: cell.index, text: cell.text.slice(0, 600) })),
        linkedChannels,
        optionalChannels
      });
    });
  });
  rows.sort((a, b) => b.score - a.score || b.linkedChannels.length - a.linkedChannels.length);
  const best = rows[0] || null;
  const linkedIds = best ? best.linkedChannels.map((item) => item.id) : [];
  const missingChannels = requested
    .filter((id) => !linkedIds.includes(id))
    .map((id) => ({ id, label: channelDefs[id].label }));
  return {
    title: document.title || '',
    url: location.href || '',
    rowFound: !!best,
    rowCount: rows.length,
    requestedChannels: requested.map((id) => ({ id, label: channelDefs[id].label })),
    row: best,
    rowCandidates: rows.slice(0, 8),
    linkedChannels: best ? best.linkedChannels : [],
    optionalLinkedChannels: best ? best.optionalChannels : [],
    missingChannels,
    linked: !!best && missingChannels.length === 0,
    textSnippet: norm(document.body && document.body.innerText ? document.body.innerText : '').slice(0, 3000)
  };
})()
""".replace("__CONTEXT__", json.dumps(context, ensure_ascii=False))
        data = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=7)
        if not isinstance(data, dict):
            data = {}
        row_found = bool(data.get("rowFound"))
        linked = bool(data.get("linked"))
        missing = data.get("missingChannels") if isinstance(data.get("missingChannels"), list) else []
        if not row_found:
            note = "Cafe24 상품목록 탭은 읽었지만 대상 상품 행을 찾지 못했습니다. 상품명/상품코드 검색 결과가 화면에 보이는지 확인해주세요."
        elif linked:
            note = "Cafe24 상품목록 행에서 요청한 오픈마켓 연동 표시를 확인했습니다."
        else:
            missing_labels = ", ".join([str(item.get("label") or item.get("id") or "") for item in missing if isinstance(item, dict)])
            note = f"Cafe24 상품목록 행은 찾았지만 아직 오픈마켓 연동 표시가 부족합니다: {missing_labels or '요청 채널'}."
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": _safe_chrome_tab(tab),
            "target": context,
            "detail": {
                "rowFound": row_found,
                "linked": linked,
                "requestedChannels": data.get("requestedChannels") if isinstance(data.get("requestedChannels"), list) else [],
                "linkedChannels": data.get("linkedChannels") if isinstance(data.get("linkedChannels"), list) else [],
                "optionalLinkedChannels": data.get("optionalLinkedChannels") if isinstance(data.get("optionalLinkedChannels"), list) else [],
                "missingChannels": missing,
                "row": data.get("row") if isinstance(data.get("row"), dict) else None,
                "rowCandidates": data.get("rowCandidates") if isinstance(data.get("rowCandidates"), list) else [],
                "textSnippet": _redact_marketplus_debug_text(data.get("textSnippet"), 2500),
            },
            "note": note,
        })
    except Exception as e:
        if "timed out" in str(e).lower():
            if isinstance(tab, dict):
                return _chrome_tab_timeout_response(port, tab, "Cafe24", "상품목록")
            return _chrome_debug_timeout_response(port, "Cafe24 상품목록")
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "Cafe24 상품목록 연동 표시 읽기에 실패했습니다. Chrome 디버그 포트와 상품목록 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/send-limit-status", methods=["GET"])
def marketplus_send_limit_status():
    """Read the MarketPlus product-count limit dialog without clicking it."""
    try:
        port = int(request.args.get("port") or 9224)
    except Exception:
        port = 9224
    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        tab = _marketplus_pick_product_detail_tab(raw_tabs, "marketplus")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "tabCount": len(loaded.get("safeTabs") or []),
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 마켓플러스 상세 화면을 찾지 못했습니다. 상품보내기 상세 화면을 연 뒤 다시 읽어주세요.",
            })
        _activate_chrome_debug_tab(port, tab)

        expression = r"""
(() => {
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    } catch (_) {
      return false;
    }
  };
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id || '');
  const pageText = document.body ? (document.body.textContent || document.body.innerText || '') : '';
  const text = norm(pageText);
  const limitRe = /마켓 상품 수 조정 안내|최대 상품 수량|더이상 상품을 전송|판매중인 상품 수를 조정/;
  const limitIndex = text.search(limitRe);
  const limitText = limitIndex >= 0
    ? text.slice(Math.max(0, limitIndex - 160), Math.min(text.length, limitIndex + 900))
    : '';
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({
      index,
      tag: el.tagName,
      text: labelOf(el).slice(0, 140),
      id: el.id || '',
      name: el.name || ''
    }))
    .filter((item) => item.text);
  const dismiss = buttons.find((item) => /나중에\s*할게요|나중에/.test(item.text || '')) || null;
  const retry = buttons.find((item) => /조정했어요|다시\s*전송/.test(item.text || '')) || null;
  const sendLimitWarning = limitRe.test(text);
  return {
    title: document.title || '',
    url: location.href || '',
    sendLimitWarning,
    limitText,
    buttons: buttons.slice(0, 80),
    actions: {
      dismiss: dismiss ? { index: dismiss.index, text: dismiss.text } : null,
      retry: retry ? { index: retry.index, text: retry.text } : null
    },
    textSnippet: text.slice(0, 3000)
  };
})()
"""
        status = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(status, dict):
            status = {}
        warning = bool(status.get("sendLimitWarning"))
        return jsonify({
            "ok": True,
            "connected": True,
            "debugPort": port,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or status.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url") or status.get("url")),
                "stage": _marketplus_tab_stage(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
            },
            "detail": {
                "sendLimitWarning": warning,
                "limitText": _redact_marketplus_debug_text(status.get("limitText"), 1200),
                "actions": status.get("actions") if isinstance(status.get("actions"), dict) else {},
                "buttons": status.get("buttons") if isinstance(status.get("buttons"), list) else [],
                "textSnippet": _redact_marketplus_debug_text(status.get("textSnippet"), 3000),
            },
            "note": "마켓플러스 상품 수량 제한 안내를 읽었습니다. 클릭/저장/전송은 실행하지 않았습니다." if warning else "현재 열린 마켓플러스 상세 화면에서 상품 수량 제한 안내는 감지되지 않았습니다.",
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "connected": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 상품 수량 제한 안내 읽기에 실패했습니다. Chrome 디버그 포트와 상품보내기 상세 탭 상태를 확인해주세요.",
        }), 500


@api.route("/marketplus/send-limit-action", methods=["POST"])
def marketplus_send_limit_action():
    """Click a specific visible MarketPlus product-count limit dialog button."""
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    action = str(payload.get("action") or "").strip().lower()
    dry_run = bool(payload.get("dryRun", False))
    if action not in {"dismiss", "retry"}:
        return jsonify({
            "ok": False,
            "reason": "invalid_action",
            "note": "지원하지 않는 수량 제한 안내 동작입니다. dismiss 또는 retry만 사용할 수 있습니다.",
        }), 400
    try:
        loaded = _load_chrome_debug_tabs(port)
        raw_tabs = loaded["rawTabs"]
        candidates = [
            tab for tab in (raw_tabs or [])
            if isinstance(tab, dict)
            and tab.get("webSocketDebuggerUrl")
            and _is_marketplus_tab(tab)
        ]
        detail_tabs = [
            tab for tab in candidates
            if "/mp/product/front/detail" in str(tab.get("url") or "").lower()
        ]
        tab = detail_tabs[0] if detail_tabs else _marketplus_pick_tab(raw_tabs, "marketplus")
        if not tab:
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_marketplus_detail_tab",
                "tabsSample": loaded.get("safeTabs", [])[:12],
                "note": "Chrome은 연결됐지만 마켓플러스 상품보내기 상세 화면을 찾지 못했습니다.",
            })

        expression = f"""
(() => {{
  const action = {json.dumps(action, ensure_ascii=False)};
  const dryRun = {json.dumps(dry_run)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {{
    try {{
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id || '');
  const text = norm(document.body && document.body.innerText ? document.body.innerText : '');
  const limitRe = /마켓 상품 수 조정 안내|최대 상품 수량|더이상 상품을 전송|판매중인 상품 수를 조정/;
  const sendLimitWarning = limitRe.test(text);
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({{ el, index, tag: el.tagName, text: labelOf(el).slice(0, 140), id: el.id || '', name: el.name || '' }}))
    .filter((item) => item.text);
  const pick = buttons.find((item) => action === 'dismiss'
    ? /나중에\\s*할게요|나중에/.test(item.text || '')
    : /조정했어요|다시\\s*전송/.test(item.text || ''));
  const serialize = (item) => item ? ({{ index: item.index, tag: item.tag, text: item.text, id: item.id, name: item.name }}) : null;
  if (!sendLimitWarning) {{
    return {{
      ok: false,
      reason: 'send_limit_not_visible',
      note: '현재 화면에서 마켓 상품 수량 제한 안내가 감지되지 않아 버튼을 누르지 않았습니다.',
      buttons: buttons.slice(0, 80).map(serialize)
    }};
  }}
  if (!pick) {{
    return {{
      ok: false,
      reason: 'button_not_found',
      note: action === 'dismiss' ? '수량 제한 안내의 나중에 할게요 버튼을 찾지 못했습니다.' : '수량 제한 안내의 재전송 시도 버튼을 찾지 못했습니다.',
      buttons: buttons.slice(0, 80).map(serialize)
    }};
  }}
  if (dryRun) {{
    return {{
      ok: true,
      dryRun: true,
      action,
      picked: serialize(pick),
      note: action === 'dismiss'
        ? 'dryRun: 수량 제한 안내 닫기 버튼을 찾았습니다. 실제 클릭은 하지 않았습니다.'
        : 'dryRun: 마켓플러스 재전송 시도 버튼을 찾았습니다. 실제 클릭은 하지 않았습니다.'
    }};
  }}
  pick.el.scrollIntoView({{ block: 'center', inline: 'center' }});
  pick.el.click();
  return {{
    ok: true,
    clicked: true,
    action,
    picked: serialize(pick),
    note: action === 'dismiss'
      ? '마켓플러스 수량 제한 안내의 나중에 할게요 버튼을 눌렀습니다. 송출은 실행하지 않았습니다.'
      : '마켓플러스 수량 제한 안내의 조정 후 재전송 시도 버튼을 눌렀습니다. MarketPlus가 실제 재전송을 시도할 수 있으므로 결과를 다시 읽어야 합니다.'
  }};
}})()
"""
        result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(result, dict):
            result = {"ok": False, "note": "마켓플러스 수량 제한 안내 버튼 결과를 해석하지 못했습니다."}
        result.update({
            "connected": True,
            "debugPort": port,
            "tab": _safe_chrome_tab(tab),
        })
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "ok": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 수량 제한 안내 버튼 처리 중 오류가 발생했습니다.",
        }), 500


@api.route("/marketplus/safe-click-send", methods=["POST"])
def marketplus_safe_click_send():
    """Click a visible MarketPlus send/register button only after local guards pass."""
    payload = request.get_json(silent=True) or {}
    try:
        port = int(payload.get("port") or 9224)
    except Exception:
        port = 9224
    dry_run = bool(payload.get("dryRun", False))
    context = {
        "productName": str(payload.get("productName") or "").strip()[:160],
        "productNo": str(payload.get("productNo") or "").strip()[:80],
        "productCode": str(payload.get("productCode") or "").strip()[:80],
        "channelLabels": [str(item).strip()[:80] for item in (payload.get("channelLabels") or []) if str(item).strip()],
        "buttonText": str(payload.get("buttonText") or "").strip()[:140],
        "buttonIndex": payload.get("buttonIndex"),
        "dryRun": dry_run,
    }
    capture_network = bool(payload.get("captureNetwork", False)) and not dry_run
    plan_b_mode = str(payload.get("planBMode") or "").strip().lower()
    if plan_b_mode in {"dryrun", "dry_run"}:
        plan_b_mode = "dry-run"
    if plan_b_mode == "experimental":
        plan_b_result = _marketplus_recipe_dry_run(context)
        plan_b_result["mode"] = "experimental-guarded-dry-run"
        plan_b_result["note"] = "실험 모드 요청을 받았지만, 저장 정책상 원문 body 값은 저장하지 않으므로 실제 내부 API 호출은 하지 않고 dry-run만 수행했습니다. 기존 화면 클릭 루트로 이어갑니다."
    elif plan_b_mode == "dry-run":
        plan_b_result = _marketplus_recipe_dry_run(context)
    else:
        plan_b_result = {
            "enabled": False,
            "mode": "off",
            "note": "플랜B 내부 API dry-run을 건너뛰고 기존 화면 클릭 루트만 사용합니다.",
        }
    expected = {
        "productName": context["productName"],
        "productNo": context["productNo"],
        "productCode": context["productCode"],
        "channelLabels": context["channelLabels"],
        "buttonText": context["buttonText"],
    }
    tab = None
    try:
        loaded = _load_chrome_debug_tabs(port)
        tab = _marketplus_pick_product_detail_tab(loaded["rawTabs"], "marketplus")
        if not tab:
            safe_tabs = loaded["safeTabs"]
            cafe_tabs = [item for item in safe_tabs if item.get("isCafe24")]
            cafe_login_tabs = [item for item in safe_tabs if item.get("isCafe24Login")]
            cafe_admin_tabs = [item for item in safe_tabs if item.get("isCafe24Admin")]
            google_account_tabs = [item for item in safe_tabs if item.get("isGoogleAccountLogin")]
            if google_account_tabs:
                note = "Google 계정 선택/로그인 화면이 감지되어 클릭하지 않았습니다. Google 로그인은 사용하지 말고 Cafe24 일반 계정 로그인 화면으로 돌아가세요."
            elif cafe_login_tabs and not cafe_admin_tabs:
                note = "Cafe24 일반 계정 로그인 탭만 감지되어 클릭하지 않았습니다. Google 계정 버튼을 누르지 말고 저장된 Cafe24 아이디/비밀번호로 로그인한 뒤 마켓플러스 상품관리/상품보내기 화면으로 이동하세요."
            elif cafe_admin_tabs:
                note = "Cafe24 관리자 탭은 감지됐지만 마켓플러스 상품보내기 화면은 아닙니다. 마켓플러스 상품관리/상품보내기 화면으로 이동한 뒤 다시 실행하세요."
            else:
                note = "마켓플러스 탭을 찾지 못해 클릭하지 않았습니다. Cafe24 마켓플러스 상품 보내기 화면을 연 뒤 다시 실행하세요."
            required_next_steps = [
                "Cafe24 관리자 로그인을 완료합니다.",
                "마켓플러스 상품관리/상품보내기 화면으로 이동합니다.",
                "대상 상품명 또는 상품번호로 상품을 검색해 화면에 보이게 합니다.",
                "선택 채널이 화면에 보이는 상태에서 보내기 조건 점검을 다시 실행합니다.",
            ]
            return jsonify({
                "ok": False,
                "connected": True,
                "debugPort": port,
                "reason": "no_marketplus_tab",
                "stage": "no_marketplus_tab",
                "tabCount": len(safe_tabs),
                "hasCafe24Tab": bool(cafe_tabs),
                "hasCafe24LoginTab": bool(cafe_login_tabs),
                "hasCafe24AdminTab": bool(cafe_admin_tabs),
                "hasMarketPlusTab": False,
                "hasGoogleAccountLoginTab": bool(google_account_tabs),
                "cafe24Tabs": cafe_tabs[:8],
                "cafe24LoginTabs": cafe_login_tabs[:8],
                "cafe24AdminTabs": cafe_admin_tabs[:8],
                "marketPlusTabs": [],
                "googleAccountLoginTabs": google_account_tabs[:8],
                "tabsSample": safe_tabs[:12],
                "note": note,
                "expected": expected,
                "requiredNextSteps": required_next_steps,
                "detected": {
                    "cafe24TabCount": len(cafe_tabs),
                    "cafe24LoginTabCount": len(cafe_login_tabs),
                    "cafe24AdminTabCount": len(cafe_admin_tabs),
                    "marketPlusTabCount": 0,
                },
            })
        _activate_chrome_debug_tab(port, tab)
        expression = f"""
(() => {{
  const ctx = {json.dumps(context, ensure_ascii=False)};
  const expected = {json.dumps(expected, ensure_ascii=False)};
  const norm = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const labelOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.name || el.id);
  const visible = (el) => {{
    try {{
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s && s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    }} catch (_) {{
      return false;
    }}
  }};
  const text = norm(document.body && document.body.innerText ? document.body.innerText : '');
  const pageIdentity = norm([location.href || '', document.title || ''].join(' '));
  const productTokens = [ctx.productName, ctx.productNo, ctx.productCode].map(norm).filter(value => value.length >= 2);
  const matchedTargets = productTokens.filter(value => text.includes(value) || pageIdentity.includes(value));
  const requestedChannels = (ctx.channelLabels || []).map(norm).filter(Boolean);
  let channelHits = requestedChannels.filter(value => value && text.includes(value));
  let missingChannels = [];
  const issueKeywords = ['로그인', '권한', '인증 실패', '접근 불가', '오류', '에러'];
  const issueHits = issueKeywords.filter(keyword => text.includes(keyword));
  const channelDefs = [
    {{ id:'gmarket', platform:'gmarket', formAccount:'1928bojagi' }},
    {{ id:'auction', platform:'auction', formAccount:'bojagi1928' }},
    {{ id:'elevenst', platform:'sk11st', formAccount:'bojagi1928' }},
    {{ id:'smartstore', platform:'shopn', formAccount:'ncp_1nn03r_01' }},
    {{ id:'coupang', platform:'coupang', formAccount:'bojagi1928' }}
  ];
  const attrValueSelector = (value) => String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const selectText = (select) => norm(select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0].textContent : '');
  const placeholderRe = /^(대분류|중분류|소분류|세분류|상세분류|선택)/;
  const hiddenCategoryStatus = (def) => {{
    const key = def.platform + '|' + def.formAccount;
    const read = (field) => {{
      const name = 'template_data[' + key + '][' + field + ']';
      const selector = 'input[name="' + attrValueSelector(name) + '"], textarea[name="' + attrValueSelector(name) + '"]';
      const el = document.querySelector(selector);
      return {{ present: !!el, value: norm(el && el.value) }};
    }};
    const prdCode = read('prd_cate_code');
    const prdName = read('prd_cate_name');
    const ebayCode = read('market_data][ebay_prd_cate_code');
    const ebayName = read('market_data][ebay_prd_cate_name');
    return {{
      prdCateCode: prdCode.value,
      prdCateName: prdName.value,
      ebayCateCode: ebayCode.value,
      ebayCateName: ebayName.value,
      present: prdCode.present || prdName.present || ebayCode.present || ebayName.present,
      filled: !!(prdCode.value && prdName.value)
    }};
  }};
  const categoryStatus = channelDefs.map((def) => {{
    const prefix = 'template_data[' + def.platform + '|' + def.formAccount + '][eMarketCategory';
    const fields = [1, 2, 3, 4].map((level) => {{
      const selector = 'select[name="' + attrValueSelector(prefix + level + ']') + '"]';
      const el = document.querySelector(selector);
      if (!el) return {{ level, present: false, required: false, filled: false }};
      const selected = selectText(el);
      const rawValue = norm(el.value);
      const required = Number((el.options || []).length || 0) > 1;
      return {{
        level,
        present: true,
        required,
        value: rawValue,
        selectedText: selected,
        filled: !!((rawValue || selected) && !placeholderRe.test(selected || ''))
      }};
    }});
    const requiredFields = fields.filter((field) => field.required);
    const anyFilled = fields.some((field) => field.present && field.filled);
    const hidden = hiddenCategoryStatus(def);
    return {{
      id: def.id,
      detected: fields.some((field) => field.present) || hidden.present,
      hidden,
      missing: !hidden.filled && (requiredFields.some((field) => !field.filled) || !anyFilled)
    }};
  }});
  const channelIdFor = (label) => {{
    const lowered = norm(label).toLowerCase();
    if (/쿠팡|coupang|wing/.test(lowered)) return 'coupang';
    if (/스마트스토어|smartstore|smart-store|네이버/.test(lowered)) return 'smartstore';
    if (/g마켓|지마켓|gmarket|g-market/.test(lowered)) return 'gmarket';
    if (/옥션|auction/.test(lowered)) return 'auction';
    if (/11번가|십일번가|11st|eleven/.test(lowered)) return 'elevenst';
    return '';
  }};
  const fieldChannelHits = requestedChannels.filter((label) => {{
    const id = channelIdFor(label);
    return id && categoryStatus.some((item) => item.id === id && item.detected);
  }});
  channelHits = Array.from(new Set([...channelHits, ...fieldChannelHits]));
  missingChannels = requestedChannels.filter(value => !channelHits.includes(value));
  const anyCategoryFieldDetected = categoryStatus.some((item) => item.detected);
  const categoryNeededText = /표준카테고리를 선택해주세요|표준카테고리.*선택|카테고리를 선택|카테고리.*필수/.test(text);
  const categoryNeeded = anyCategoryFieldDetected
    ? categoryStatus.some((item) => item.detected && item.missing)
    : categoryNeededText;
  const sendLimitWarning = /최대 상품 수량|더이상 상품을 전송|판매중인 상품 수를 조정/.test(text);
  const blockingRequirements = [];
  if (categoryNeeded) blockingRequirements.push('마켓플러스 표준카테고리 선택 필요');
  const advisoryWarnings = sendLimitWarning
    ? ['마켓 상품 수량 제한 안내 문구가 감지됐지만 테스트 1개 송출의 차단 사유로 확정하지 않습니다.']
    : [];
  const strongSendKeywords = ['상품보내기', '상품 보내기', '마켓 상품 보내기', '판매처 전송', '마켓 전송', '마켓송출', '마켓 송출', '송출', '전송'];
  const weakSendKeywords = ['등록', '일괄'];
  const unsafeButtonKeywords = ['검색', '조회', '찾기', '불러오기', '새로고침', '저장', '수정', '삭제', '닫기', '취소', '초기화', '복사', '다운로드', '엑셀', '파일', 'API', '점검', '카테고리'];
  const hardUnsafeButtonKeywords = ['노출 최적화', 'PRO 전문가', '상품 연동부터', '상품 연동 부터', '조정했어요', '다시 전송해 볼게요', '최대 상품 수량'];
  const hardUnsafeCompactKeywords = ['노출최적화', 'PRO전문가', '상품연동부터', '조정했어요', '다시전송해볼게요', '최대상품수량'];
  const serialize = (item) => ({{ index: item.index, text: item.text, tag: item.tag, id: item.id, name: item.name, score: item.score || 0, reasons: item.reasons || [] }});
  const buttons = Array.from(document.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]'))
    .filter(visible)
    .map((el, index) => ({{ el, index, text: labelOf(el), tag: el.tagName, id: el.id || '', name: el.name || '' }}))
    .filter(item => item.text);
  const scoreButton = (item) => {{
    const reasons = [];
    let score = 0;
    const textValue = item.text || '';
    const compactText = textValue.replace(/\\s+/g, '');
    const strong = strongSendKeywords.filter(keyword => textValue.includes(keyword));
    const weak = weakSendKeywords.filter(keyword => textValue.includes(keyword));
    const unsafe = unsafeButtonKeywords.filter(keyword => textValue.includes(keyword));
    const hardUnsafe = [
      ...hardUnsafeButtonKeywords.filter(keyword => textValue.includes(keyword)),
      ...hardUnsafeCompactKeywords.filter(keyword => compactText.includes(keyword))
    ];
    if (hardUnsafe.length || (textValue.length > 45 && !(ctx.buttonText && textValue === ctx.buttonText))) {{
      return {{ ...item, score: -999, reasons: [`송출 제외 문구: ${{hardUnsafe.join(', ') || '긴 안내/홍보 링크'}}`] }};
    }}
    if (ctx.buttonIndex !== undefined && ctx.buttonIndex !== null && Number(ctx.buttonIndex) === item.index) {{
      score += 90;
      reasons.push('이전 화면읽기 후보 번호 일치');
    }}
    if (ctx.buttonText && textValue === ctx.buttonText) {{
      score += 100;
      reasons.push('이전 화면읽기 후보 문구 일치');
    }}
    if (strong.length) {{
      score += 50 + strong.length * 8;
      reasons.push(`강한 송출 문구: ${{strong.join(', ')}}`);
    }}
    if (weak.length) {{
      score += 12;
      reasons.push(`약한 후보 문구: ${{weak.join(', ')}}`);
    }}
    if (unsafe.length && !strong.length && !(ctx.buttonText && textValue === ctx.buttonText)) {{
      score -= 55;
      reasons.push(`일반/위험 버튼 문구: ${{unsafe.join(', ')}}`);
    }}
    if (/상품.*(보내|전송|송출)/.test(textValue) || /(보내|전송|송출).*상품/.test(textValue)) {{
      score += 25;
      reasons.push('상품 송출 조합 문구');
    }}
    return {{ ...item, score, reasons }};
  }};
  const candidates = buttons
    .map(scoreButton)
    .filter(item => item.score >= 30)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12);
  if (!matchedTargets.length) {{
    return {{ ok: false, reason: 'target_not_visible', note: '현재 마켓플러스 화면에서 대상 상품명/상품번호/상품코드를 확인하지 못해 클릭하지 않았습니다.', matchedTargets, channelHits, missingChannels, issueHits, candidates: candidates.map(serialize), expected, requiredNextSteps: ['마켓플러스 상품보내기 화면에서 대상 상품을 검색합니다.', '화면에 상품명/상품번호/상품코드 중 하나가 보이는지 확인합니다.', '화면 읽기 또는 보내기 조건 점검을 다시 실행합니다.'] }};
  }}
  if (missingChannels.length) {{
    return {{ ok: false, reason: 'channels_not_visible', note: `현재 마켓플러스 화면에서 선택 채널 ${{missingChannels.join(', ')}}을 확인하지 못해 클릭하지 않았습니다.`, matchedTargets, channelHits, missingChannels, issueHits, candidates: candidates.map(serialize), expected, requiredNextSteps: ['마켓플러스 화면에서 선택한 판매 채널 영역을 펼칩니다.', `누락 채널: ${{missingChannels.join(', ')}}`, '채널이 보이는 상태에서 보내기 조건 점검을 다시 실행합니다.'] }};
  }}
  if (blockingRequirements.length) {{
    return {{ ok: false, reason: 'marketplus_blocking_requirements_visible', note: `마켓플러스 전송 전 필수 조건이 남아 있어 클릭하지 않았습니다: ${{blockingRequirements.join(', ')}}`, matchedTargets, channelHits, missingChannels, issueHits, blockingRequirements, advisoryWarnings, candidates: candidates.map(serialize), expected, requiredNextSteps: [...blockingRequirements, '마켓플러스 상세 화면에서 차단 조건을 해소합니다.', '상세 전송상태 읽기를 다시 실행해 준비 상태를 확인합니다.'] }};
  }}
  if (issueHits.length) {{
    return {{ ok: false, reason: 'blocking_issue_visible', note: `화면에 ${{issueHits.join(', ')}} 문구가 보여 클릭하지 않았습니다.`, matchedTargets, channelHits, missingChannels, issueHits, candidates: candidates.map(serialize), expected, requiredNextSteps: [`차단 문구 확인: ${{issueHits.join(', ')}}`, '로그인/권한/화면 오류를 먼저 해결합니다.', '화면을 새로 읽은 뒤 조건 점검을 다시 실행합니다.'] }};
  }}
  if (!candidates.length) {{
    const visibleSendLike = buttons.map(scoreButton).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 12);
    return {{ ok: false, reason: 'send_button_not_found', note: '상품 보내기/송출/전송/연동 버튼 후보를 안전 기준으로 찾지 못해 클릭하지 않았습니다.', matchedTargets, channelHits, missingChannels, issueHits, candidates: visibleSendLike.map(serialize), expected, requiredNextSteps: ['대상 상품과 채널을 선택한 뒤 상품보내기/송출/전송/연동 버튼이 화면에 보이게 합니다.', '단순 등록/저장/검색 버튼은 안전 기준에서 제외됩니다.', '버튼이 접힌 영역에 있다면 펼친 뒤 조건 점검을 다시 실행합니다.'] }};
  }}
  const picked = candidates[0];
  const pickedInfo = serialize(picked);
  if (ctx.dryRun) {{
    return {{ ok: true, dryRun: true, note: '안전 클릭 조건을 통과했습니다. dryRun이라 실제 클릭은 하지 않았습니다.', matchedTargets, channelHits, missingChannels, issueHits, advisoryWarnings, picked: pickedInfo, candidates: candidates.map(serialize) }};
  }}
  window.__marketplusSafeClickLast = {{
    scheduledAt: Date.now(),
    picked: pickedInfo,
    matchedTargets,
    channelHits,
    advisoryWarnings,
  }};
  const clickTarget = picked.el;
  window.setTimeout(() => {{
    try {{
      clickTarget.scrollIntoView({{ block: 'center', inline: 'center' }});
      clickTarget.click();
      window.__marketplusSafeClickLast.clickedAt = Date.now();
      window.__marketplusSafeClickLast.clicked = true;
    }} catch (err) {{
      window.__marketplusSafeClickLast.clicked = false;
      window.__marketplusSafeClickLast.error = String(err && err.message ? err.message : err);
    }}
  }}, 80);
  return {{ ok: true, clickScheduled: true, note: '마켓플러스 상품 보내기/전송 버튼 클릭을 예약했습니다. 화면 작업 완료 여부는 상태 조회로 확인하세요.', matchedTargets, channelHits, missingChannels, issueHits, advisoryWarnings, picked: pickedInfo }};
}})()
"""
        recipe_capture = None
        if capture_network:
            try:
                probe = _cdp_runtime_evaluate_with_network(tab.get("webSocketDebuggerUrl"), expression, timeout=8, event_window=7)
                result = probe.get("value") if isinstance(probe, dict) else None
                if not isinstance(result, dict):
                    result = {"ok": False, "note": "마켓플러스 클릭 결과를 해석하지 못했습니다."}
                if (probe or {}).get("error"):
                    result.setdefault("networkProbeError", (probe or {}).get("error"))
                if result.get("ok") and not result.get("dryRun"):
                    recipe_capture = _marketplus_recipe_capture((probe or {}).get("network"), context)
                else:
                    recipe_capture = {"ok": False, "saved": 0, "reason": "click_not_successful"}
            except Exception as capture_error:
                result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
                recipe_capture = {
                    "ok": False,
                    "saved": 0,
                    "reason": "capture_failed_fallback_to_ui_click",
                    "error": _redact_marketplus_debug_text(capture_error, 500),
                    "note": "네트워크 캡처는 실패했지만 기존 화면 클릭 루트로 즉시 fallback했습니다.",
                }
        else:
            result = _cdp_runtime_evaluate(tab.get("webSocketDebuggerUrl"), expression, timeout=5)
        if not isinstance(result, dict):
            result = {"ok": False, "note": "마켓플러스 클릭 결과를 해석하지 못했습니다."}
        result["planB"] = plan_b_result
        if recipe_capture is not None:
            result["recipeCapture"] = recipe_capture
        result.update({
            "connected": True,
            "debugPort": port,
            "tab": {
                "id": str(tab.get("id") or "")[:80],
                "title": str(tab.get("title") or "")[:180],
                "url": _safe_browser_tab_url(tab.get("url")),
                "isCafe24": _is_cafe24_tab(tab),
                "isCafe24Login": _is_cafe24_login_tab(tab),
                "isCafe24Admin": _is_cafe24_admin_tab(tab),
                "isMarketPlus": _is_marketplus_tab(tab),
                "stage": _marketplus_tab_stage(tab),
            },
        })
        return jsonify(result)
    except Exception as e:
        if "timed out" in str(e).lower():
            if isinstance(tab, dict):
                return _marketplus_tab_timeout_response(port, tab, "안전 클릭 대상")
            return _chrome_debug_timeout_response(port, "마켓플러스 안전 클릭 대상")
        return jsonify({
            "ok": False,
            "debugPort": port,
            "error": str(e),
            "note": "마켓플러스 안전 클릭 실행에 실패했습니다. Chrome 디버그 포트와 관리자 탭 상태를 확인해주세요.",
        }), 500


# ── Project Management ──────────────────────────────────────────

def _normalize_vertex_payload(obj):
    """Convert Gemini Developer-style keys to Vertex REST-style keys."""
    if isinstance(obj, list):
        return [_normalize_vertex_payload(item) for item in obj]
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            mapped = key
            if key == "inline_data":
                mapped = "inlineData"
            elif key == "mime_type":
                mapped = "mimeType"
            out[mapped] = _normalize_vertex_payload(value)
        # Vertex expects an explicit role for each content item.
        if "parts" in out and "role" not in out:
            out["role"] = "user"
        return out
    return obj


_VERTEX_GLOBAL_IMAGE_MODELS = {
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
}

_VERTEX_IMAGE_MODEL_FALLBACKS = {
    "gemini-3.1-flash-image": [
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image",
    ],
    "gemini-3.1-flash-image-preview": [
        "gemini-3.1-flash-image",
        "gemini-2.5-flash-image",
    ],
    "gemini-3-pro-image-preview": [
        "gemini-3.1-flash-image",
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image",
    ],
}


def _unique_strings(*values):
    seen = set()
    result = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _vertex_payload_requests_image(payload):
    config = payload.get("generationConfig") or payload.get("generation_config") or {}
    modalities = (
        config.get("responseModalities")
        or config.get("response_modalities")
        or payload.get("responseModalities")
        or payload.get("response_modalities")
        or []
    )
    if isinstance(modalities, str):
        modalities = [modalities]
    return any(str(item).strip().upper() == "IMAGE" for item in modalities)


def _vertex_image_model_candidates(model):
    return _unique_strings(model, *_VERTEX_IMAGE_MODEL_FALLBACKS.get(model, []))


def _vertex_locations_for_model(model, configured_location):
    configured = str(configured_location or "").strip() or "global"
    if model in _VERTEX_GLOBAL_IMAGE_MODELS:
        return _unique_strings("global", configured, "us-central1")
    return _unique_strings(configured, "global", "us-central1")


def _vertex_error_text(data, fallback_text=""):
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("status") or data)
        if err:
            return str(err)
        return json.dumps(data, ensure_ascii=False)[:1200]
    return str(fallback_text or data or "")


def _vertex_error_retryable(status_code, data, text):
    haystack = _vertex_error_text(data, text).lower()
    if "provided image is not valid" in haystack or "invalid image" in haystack:
        return False
    if int(status_code or 0) in {404, 429, 500, 502, 503, 504}:
        return True
    return any(token in haystack for token in [
        "resource exhausted",
        "quota",
        "rate limit",
        "not found",
        "not available",
        "not supported",
        "does not exist",
        "permission denied",
    ])


def _get_adc_access_token():
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    credentials.refresh(GoogleAuthRequest())
    return credentials.token


