// 실험(제품 코드 무변경): **보관되지 않은 컷 결과가 강제 새로고침을 견디는가.**
//
// 왜 필요한가:
//   보관 저장이 409 로 거절될 때 "그림을 버리지 말고 화면에 남기자" 는 안을 검토 중이다.
//   그런데 남긴 그림이 새로고침에 사라진다면, 사장님은 그림이 살아 있다고 믿고 계속 일하다가
//   F5 한 번에 잃는다. 그건 지금(즉시 실패로 알려 주는 것)보다 **더 나쁘다.**
//   주인님 제1원칙: "생성한 것이 날아가지 않는 것."
//
//   그래서 고치기 전에 먼저 잰다. 결과에 따라 안을 채택하거나 폐기한다.
//
// 무엇을 하는가: archiveId 없이 result 만 인라인으로 넣고, 저장한 뒤 Ctrl+F5 두 번.
const fs = require('fs');
const path = require('path');
const {
  connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'probe-unarchived-cut-result.json');

const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function readCut(cdp) {
  return evaluateFactoryCdpFixture(cdp, `async () => {
    const p = (window.state.cuts?.prompts || [])[0] || {};
    return {
      hasResult: !!p.result,
      resultLength: String(p.result || '').length,
      resultIsInline: String(p.result || '').startsWith('data:'),
      archiveId: String(p.archiveId || p.localArchiveId || ''),
      imageUrl: String(p.imageUrl || ''),
      error: String(p.error || ''),
    };
  }`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const seed = String(Date.now());
  const projectId = `unarchived_probe_${seed}`;
  const productName = `보관안됨실험_${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?unarchivedProbe=1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof saveLastWorkNow === 'function'
    && typeof normalizeCutPromptItem === 'function'`, 60000);

  const seeded = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    const now = Date.now();
    setAppState({
      currentProjectId: ${JSON.stringify(projectId)},
      currentProjectName: ${JSON.stringify(productName)},
      currentProjectCreatedAt: now,
      productName: ${JSON.stringify(productName)},
      step: 'cuts',
    });
    const factory = cloneFactory(readFactory());
    window.factoryStampWorkspaceIdentity?.(factory, {
      projectId: ${JSON.stringify(projectId)},
      projectName: ${JSON.stringify(productName)},
      createdAt: now,
    });
    replaceFactory(factory, { mode: 'hydrate' });

    const cuts = window.state.cuts;
    cuts.factoryStageId = '';
    cuts.prompts = [normalizeCutPromptItem({
      id: 'unarchived-cut-1',
      title: '보관 안 된 컷',
      prompt: '실험',
    }, 0)];
    cuts.promptSlotCount = 1;
    // 보관 실패로 archiveId 는 없고 그림만 인라인으로 들고 있는 상태.
    // **실제 크기로 잰다.** Vertex 가 돌려주는 그림은 1.1MB 였다(2026-09-04 실측).
    // 작은 그림으로 재면 저장 경로의 용량 정리(stripFactoryImages / lightweight)에
    // 걸리는지 알 수 없다 - 그 차이가 곧 "사장님이 F5 에 잃는가" 를 가른다.
    const bigPayload = ${JSON.stringify(PNG_PIXEL)}.repeat(12000).slice(0, 1400000);
    cuts.prompts[0].result = 'data:image/png;base64,' + bigPayload;
    cuts.prompts[0].hasImage = true;
    cuts.prompts[0].error = '보관 저장 실패(실험용)';
    delete cuts.prompts[0].archiveId;
    delete cuts.prompts[0].localArchiveId;
    delete cuts.prompts[0].imageUrl;
    renderApp();
    await saveLastWorkNow({ force: true, deep: true, sync: false });
    return { documentScope: getCurrentDocumentWorkspaceScope?.() || '' };
  }`);
  await new Promise(resolve => setTimeout(resolve, 3500));
  const before = await readCut(cdp);

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const afterFirst = await readCut(cdp);

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, factoryCdpFixtureReadyExpression(), 60000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  const afterSecond = await readCut(cdp);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ projectId, seeded, before, afterFirst, afterSecond }, null, 2), 'utf8');
  console.log('[실험결과]');
  console.log('  심은 직후 :', JSON.stringify(before));
  console.log('  1차 F5 후 :', JSON.stringify(afterFirst));
  console.log('  2차 F5 후 :', JSON.stringify(afterSecond));
  const survives = afterFirst.hasResult && afterSecond.hasResult;
  console.log(survives
    ? '  => 보관 안 된 그림도 새로고침을 견딘다. 화면에 남기는 안은 안전하다.'
    : '  => 보관 안 된 그림은 새로고침에 사라진다. 화면에 남기면 사장님이 F5 한 번에 잃는다.');
  console.log(`  증거: ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[실험실패] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
