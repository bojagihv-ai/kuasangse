// 계약: **화면에 "확정" 이라고 떠 있는 값이, 서버로 실제 나가는 몸통에도 들어 있다.**
//
// 주인님 2026-08-31: "또 날라갔다 db랑 카페24 몇번쨰냐"
// 주인님 2026-09-02: "이미지 생성한거나 필수값고른거나 vm선택한것 등등 날라가거나했던것"
//
// 지금 있는 검사들이 못 보는 자리:
//   기존 유지 검사(FULL-01·DB-02·SAVE-26·KEEP-ALL-01)는 전부
//   "화면 -> 새로고침 -> 화면" 을 본다. 그런데 그 사이의 **서버로 나간 몸통**은 아무도 안 본다.
//   화면과 브라우저 안 사본이 서로 맞기만 하면 통과하므로,
//   서버에 절반만 보내고 있어도 초록이다. 그러다 브라우저 저장본이 한 번 비면
//   (다른 탭이 덮어쓰거나, 저장소가 정리되거나, 새 빌드가 깔리거나)
//   서버 사본에는 애초에 없던 값이라 그때 통째로 사라진다.
//   실측 2026-09-01: 낙지발노리개 작업의 서버 사본이 08-21 에 멈춰 있었다.
//   54번의 저장이 전부 거절됐는데 화면은 계속 정상으로 보였다.
//
// 그래서 fetch 를 가로채 **진짜 나간 JSON** 을 읽고, 화면 값과 한 글자씩 맞춰 본다.
//
// 훅을 언제 심는가가 중요하다. server-last-work-adapter.mjs 는
//   fetchImpl = root?.fetch?.bind(root)
// 로 **만들어질 때 한 번** fetch 를 붙든다. 페이지가 뜬 뒤에 window.fetch 를 바꿔 봐야
// 이미 붙든 원본을 계속 쓴다. 그래서 Page.addScriptToEvaluateOnNewDocument 로
// 앱 코드보다 먼저 심는다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'screen-values-reach-the-server-v1.json');

const FETCH_HOOK = `(() => {
  if (window.__sentBodies) return;
  window.__sentBodies = [];
  const original = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = String(typeof input === 'string' ? input : (input && input.url) || '');
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const body = init && init.body;
      if (method === 'POST' && url.indexOf('/api/last-work') !== -1 && typeof body === 'string') {
        window.__sentBodies.push({ url: url, body: body, at: Date.now() });
      }
    } catch (_) {}
    return original.apply(this, arguments);
  };
})();`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // 앱 코드보다 먼저. 어댑터가 붙드는 fetch 가 이미 우리 것이어야 한다.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_HOOK });

  const seed = String(Date.now());
  const projectId = `screen_to_server_${seed}`;
  const productName = `서버몸통대조_${seed}`;
  const usage = `사용용도_${seed}`;
  const size = `4.8cm_${seed}`;
  const material = `폴리100_${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?screenToServer=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && !!window.__sentBodies
    && typeof saveLastWorkNow === 'function'
    && typeof getCurrentDocumentWorkspaceScope === 'function'`, 60000);

  // 화면에서 사람이 확정하는 것과 같은 자리에 값을 넣는다.
  const onScreen = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState, readAppState }) => {
    const now = Date.now();
    setAppState({
      currentProjectId: ${JSON.stringify(projectId)},
      currentProjectName: ${JSON.stringify(productName)},
      currentProjectCreatedAt: now,
      productName: ${JSON.stringify(productName)},
      step: 'factory',
    });
    const factory = cloneFactory(readFactory());
    window.factoryStampWorkspaceIdentity?.(factory, {
      projectId: ${JSON.stringify(projectId)},
      projectName: ${JSON.stringify(productName)},
      createdAt: now,
    });
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      finalDb: {
        ...(factory.product?.finalDb || {}),
        __usage: ${JSON.stringify(usage)},
        __size: ${JSON.stringify(size)},
        __material: ${JSON.stringify(material)},
      },
    };
    factory.stages = { ...(factory.stages || {}), cuts: { ...(factory.stages?.cuts || {}), targetCount: 4 } };
    replaceFactory(factory, { mode: 'hydrate' });
    setAppState({ productName: ${JSON.stringify(productName)} });
    renderApp();
    const current = readFactory();
    return {
      documentScope: getCurrentDocumentWorkspaceScope?.() || '',
      branchScope: getCurrentLastWorkWorkspaceScope?.() || '',
      productName: readAppState().productName || '',
      usage: String(current.product?.finalDb?.__usage || ''),
      size: String(current.product?.finalDb?.__size || ''),
      material: String(current.product?.finalDb?.__material || ''),
      cutsTarget: Number(current.stages?.cuts?.targetCount ?? -1),
    };
  }`);

  // 저장을 누른다. 이 한 번이 서버로 나가야 한다.
  const saveOutcome = await evaluateFactoryCdpFixture(cdp, `async () => {
    try {
      const result = await saveLastWorkNow({ force: true, deep: true, sync: false });
      return { ok: true, result: result === undefined ? 'undefined' : String(result) };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  const sent = await evaluateFactoryCdpFixture(cdp, `async () => {
    const bodies = Array.isArray(window.__sentBodies) ? window.__sentBodies : [];
    const last = bodies.at(-1) || null;
    let parsed = null;
    let parseError = '';
    try { parsed = last ? JSON.parse(last.body) : null; } catch (error) { parseError = String(error); }

    // 값이 몸통의 **어느 칸**에 들어갔는지 찾아 준다.
    // 자리 이름을 이 검사에 못 박아 두면, 앱이 자리를 옮긴 날 거짓 실패가 난다.
    // 값으로 찾아서 경로를 보고하면 사람이 바로 판단할 수 있다.
    // **모든** 자리를 모은다. 처음 찾은 하나만 보면 안 된다 -
    // 실측 2026-09-02: 확정값은 snapshot.lightweight 와 snapshot.assets 에 두 벌 실려 있었고,
    // 한 벌을 일부러 지우는 파괴 실험에서 나머지 한 벌이 잡혀 검사가 그냥 통과했다.
    // 즉 '어딘가 하나 있으면 통과' 는 허수아비다.
    function findPaths(node, needle, trail, depth, out) {
      if (depth > 12 || node === null || node === undefined) return out;
      if (typeof node === 'string') { if (node === needle && trail) out.push(trail); return out; }
      if (typeof node !== 'object') return out;
      for (const key of Object.keys(node)) {
        findPaths(node[key], needle, trail ? trail + '.' + key : key, depth + 1, out);
      }
      return out;
    }
    const paths = (needle) => (parsed ? findPaths(parsed, needle, '', 0, []) : []);

    return {
      count: bodies.length,
      url: last?.url || '',
      parseError,
      bodyLength: last ? last.body.length : 0,
      // 글자로 있는가 (자리 무관)
      rawHasProductName: last ? last.body.includes(${JSON.stringify(productName)}) : false,
      rawHasUsage: last ? last.body.includes(${JSON.stringify(usage)}) : false,
      rawHasSize: last ? last.body.includes(${JSON.stringify(size)}) : false,
      rawHasMaterial: last ? last.body.includes(${JSON.stringify(material)}) : false,
      // 어느 칸에 있는가
      usagePaths: paths(${JSON.stringify(usage)}),
      sizePaths: paths(${JSON.stringify(size)}),
      materialPaths: paths(${JSON.stringify(material)}),
      workspaceId: String(parsed?.workspaceId || ''),
    };
  }`);

  // 몸통에 실렸다고 끝이 아니다. **서버가 실제로 그렇게 보관하고 있는지** 되읽어 본다.
  // 낙지발노리개 사고가 정확히 이 자리였다 - 저장은 계속 나갔는데 서버 사본은 08-21 에 멈춰 있었다.
  const readBack = await evaluateFactoryCdpFixture(cdp, `async () => {
    const scope = getCurrentDocumentWorkspaceScope?.() || '';
    const bases = [location.origin, 'http://127.0.0.1:5050'];
    for (const base of bases) {
      try {
        const url = base.replace(/\\/$/, '') + '/api/last-work?workspaceId=' + encodeURIComponent(scope);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const payload = await response.json();
        const text = JSON.stringify(payload || {});
        return {
          base,
          hasSnapshot: !!payload?.hasSnapshot,
          savedAt: Number(payload?.savedAt || payload?.snapshot?.savedAt || 0),
          hasUsage: text.includes(${JSON.stringify(usage)}),
          hasSize: text.includes(${JSON.stringify(size)}),
          hasMaterial: text.includes(${JSON.stringify(material)}),
          hasProductName: text.includes(${JSON.stringify(productName)}),
          length: text.length,
          error: '',
        };
      } catch (error) {
        // 다음 주소로 넘어간다.
      }
    }
    return { base: '', hasSnapshot: false, error: '서버에서 되읽지 못했습니다' };
  }`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ projectId, onScreen, saveOutcome, sent, readBack }, null, 2), 'utf8');

  const checks = [
    { ok: /^project:/.test(String(onScreen.documentScope)),
      message: `전제 불성립 - 저장된 작업(project:) 문서가 아닙니다: ${JSON.stringify(onScreen)}` },
    { ok: onScreen.usage === usage && onScreen.size === size
        && onScreen.material === material && onScreen.cutsTarget === 4,
      message: `전제 불성립 - 화면에 확정값이 들어가지 않았습니다: ${JSON.stringify(onScreen)}` },

    // 여기가 이 검사의 존재 이유다.
    { ok: sent.count > 0,
      message: '저장을 눌렀는데 서버로 나간 몸통이 하나도 없습니다.'
        + ' 화면과 브라우저 사본만 맞고 서버에는 아무것도 가지 않는 상태입니다 -'
        + ' 브라우저 저장본이 한 번 비면 그대로 사라집니다.'
        + ` (저장 결과: ${JSON.stringify(saveOutcome)})` },
    { ok: !sent.parseError,
      message: `서버로 나간 몸통이 JSON 이 아닙니다: ${sent.parseError}` },
    { ok: sent.rawHasProductName === true,
      message: `제품명이 서버 몸통에 없습니다: ${JSON.stringify({ 화면: onScreen.productName, 몸통길이: sent.bodyLength })}` },
    { ok: sent.rawHasUsage === true,
      message: `확정한 사용용도가 서버 몸통에 없습니다 - 화면만 확정입니다: ${JSON.stringify({ 화면: onScreen.usage, 몸통길이: sent.bodyLength })}` },
    { ok: sent.rawHasSize === true,
      message: `확정한 크기가 서버 몸통에 없습니다: ${JSON.stringify({ 화면: onScreen.size, 몸통길이: sent.bodyLength })}` },
    { ok: sent.rawHasMaterial === true,
      message: `확정한 소재가 서버 몸통에 없습니다: ${JSON.stringify({ 화면: onScreen.material, 몸통길이: sent.bodyLength })}` },

    // 셋이 **똑같은 칸들**에 실려야 한다. 하나만 어느 칸에서 빠지면 복원 때 그것만 사라진다.
    { ok: sent.usagePaths?.length > 0
        && JSON.stringify(sent.usagePaths.map(p => p.replace(/\.__usage$/, '')))
           === JSON.stringify((sent.sizePaths || []).map(p => p.replace(/\.__size$/, '')))
        && JSON.stringify(sent.usagePaths.map(p => p.replace(/\.__usage$/, '')))
           === JSON.stringify((sent.materialPaths || []).map(p => p.replace(/\.__material$/, ''))),
      message: `확정값 셋이 서버 몸통의 서로 다른 칸에 실렸습니다 - 복원 때 일부만 살아납니다: ${JSON.stringify({ usage: sent.usagePaths, size: sent.sizePaths, material: sent.materialPaths })}` },
    { ok: sent.workspaceId === onScreen.documentScope,
      message: `몸통이 다른 작업 앞으로 나갔습니다: 화면 ${onScreen.documentScope} · 몸통 ${sent.workspaceId}` },

    // 그리고 서버가 정말 그렇게 보관하는지.
    { ok: readBack.hasSnapshot === true,
      message: `저장 뒤 서버에 이 작업의 사본이 없습니다: ${JSON.stringify(readBack)}` },
    { ok: readBack.hasProductName === true && readBack.hasUsage === true
        && readBack.hasSize === true && readBack.hasMaterial === true,
      message: `서버 사본에 확정값이 없습니다 - 화면과 브라우저에만 있는 상태입니다: ${JSON.stringify(readBack)}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 화면 확정값이 서버로 나간 몸통 ${sent.bodyLength}바이트에 실리고 서버 사본(${readBack.length}바이트)에서도 되읽힘`
    + ` · 실린 자리 ${sent.usagePaths.length}곳: ${sent.usagePaths.join(', ')} · 작업: ${sent.workspaceId} - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
