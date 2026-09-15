const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'src', 'modules', 'native-batch-console-view.mjs');
const MODEL_TEXT = '판단 모델: GPT OAuth · gpt-5.6-sol · 추론 low · 원본 조립공장 설정 사용';
const LONG_MODEL_TEXT = '판단 모델: GPT OAuth · gpt56solultralongunbrokenmodelidentifierwithoutanywhitespace · 추론 low · 원본 조립공장 설정 사용';

test('bulk verdict preserves Korean words and permits wrapping long tokens', () => {
  const css = fs.readFileSync(path.join(ROOT, 'control_tower', 'frontend', 'src', 'bulk-intake.css'), 'utf8');
  const verdict = css.match(/(?:^|})\s*\.bulk-card-verdict\s*\{([^}]+)\}/)?.[1];
  assert.ok(verdict, 'bulk verdict must retain its scoped CSS rule');
  assert.match(verdict, /(?:^|;)\s*word-break\s*:\s*keep-all\s*(?:;|$)/);
  assert.match(verdict, /(?:^|;)\s*overflow-wrap\s*:\s*anywhere\s*(?:;|$)/);
});

function viewModuleUrl() {
  const source = fs.readFileSync(SOURCE, 'utf8')
    // The start helper is unused by this view-only render; this shim does not cover production async behavior.
    .replace("import { createSingleFlight } from './batch-control-polling.mjs';", 'const createSingleFlight = () => callback => callback();')
    .replace(/^export /gm, '');
  return `data:text/javascript;base64,${Buffer.from(`${source}\nglobalThis.__nativeBatchConsoleView = createNativeBatchConsoleView;\n`).toString('base64')}`;
}

async function renderModel(page, text, narrowCjkBoundary = false) {
  await page.setContent(`<!doctype html><html lang="ko"><head><style>
    :root {--space-3:12px;--space-4:16px;--border:#2a2a36;--bg-card:#1a1a23;--bg:#0f0f13;--text:#f8fafc;--text-d:#a1a1aa;--warn:#f59e0b;--radius-lg:12px}
    * {margin:0;padding:0;box-sizing:border-box} html,body {width:369px;min-height:500px;background:var(--bg);color:var(--text)} body {font-family:Pretendard,'Noto Sans KR',sans-serif} #app {min-height:1px}
  </style></head><body><main id="app"></main></body></html>`);
  return page.evaluate(async ({ moduleUrl, modelText, narrow }) => {
    await import(moduleUrl);
    globalThis.__nativeBatchConsoleView(document, () => {});
    const element = document.getElementById('nativeBatchModels');
    element.textContent = modelText;
    let boundaryWidth = null;
    const start = modelText.lastIndexOf('사용');
    if (narrow) {
      const prefix = document.createRange();
      element.style.inlineSize = 'max-content';
      prefix.setStart(element.firstChild, 0);
      prefix.setEnd(element.firstChild, start + 1);
      const elementLeft = element.getBoundingClientRect().left;
      boundaryWidth = Math.ceil((prefix.getBoundingClientRect().right - elementLeft) * 64) / 64 + 0.25;
      element.style.inlineSize = `${boundaryWidth}px`;
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const range = document.createRange();
    range.setStart(element.firstChild, start);
    range.setEnd(element.firstChild, start + 2);
    const suffix = document.createRange();
    suffix.setStart(element.firstChild, modelText.lastIndexOf('설정'));
    suffix.setEnd(element.firstChild, modelText.length);
    const computed = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      boundaryWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overflowWrap: computed.overflowWrap,
      wordBreak: computed.wordBreak,
      textWrap: computed.textWrap,
      suffixRects: [...suffix.getClientRects()].map(rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })),
      wordRects: [...range.getClientRects()].map(rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })),
    };
  }, { moduleUrl: viewModuleUrl(), modelText: text, narrow: narrowCjkBoundary });
}

test('native model guide keeps CJK words intact and wraps an unbroken model ID at 375px', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 500 } });
  const evidenceDir = process.env.KUASANGSE_CJK_EVIDENCE_DIR;
  try {
    const cjk = await renderModel(page, MODEL_TEXT, true);
    assert.equal(cjk.wordRects.length, 1, `사용 must remain one rendered line: ${JSON.stringify(cjk.wordRects)}`);
    assert.equal(cjk.suffixRects.length, 1, `설정 사용 must remain one rendered line: ${JSON.stringify(cjk.suffixRects)}`);

    const longModel = await renderModel(page, LONG_MODEL_TEXT);
    assert.equal(longModel.documentScrollWidth, longModel.documentClientWidth, 'unbroken model ID must not cause horizontal overflow');

    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'cjk-375-green.json'), `${JSON.stringify({ cjk, longModel }, null, 2)}\n`);
      await renderModel(page, MODEL_TEXT, true);
      await page.screenshot({ path: path.join(evidenceDir, 'cjk-375-green.png') });
    }
  } finally {
    await browser.close();
    if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'fixture-cleanup.json'), '{"browserClosed":true}\n');
  }
});

test('native queue rows keep Korean status words intact in a narrow 768px column', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 768, height: 320 } });
  const evidenceDir = process.env.KUASANGSE_CJK_EVIDENCE_DIR;
  try {
    await page.setContent(`<!doctype html><html lang="ko"><head><style>
      :root {--space-3:12px;--space-4:16px;--border:#2a2a36;--bg-card:#1a1a23;--bg:#0f0f13;--text:#f8fafc;--text-d:#a1a1aa;--warn:#f59e0b;--radius-lg:12px}
      * {margin:0;padding:0;box-sizing:border-box} html,body {width:768px;min-height:500px;background:var(--bg);color:var(--text)} body {font-family:Pretendard,'Noto Sans KR',sans-serif} #app {min-height:1px}
    </style></head><body><main id="app"></main></body></html>`);
    const observation = await page.evaluate(async moduleUrl => {
      await import(moduleUrl);
      globalThis.__nativeBatchConsoleView(document, () => {});
      const queuePanel = document.getElementById('nativeBatchQueue');
      queuePanel.hidden = false;
      const row = document.createElement('article');
      row.className = 'native-batch-queue-row';
      const name = document.createElement('strong');
      name.textContent = '02 · 슬라브 겔보 55x55 R3';
      const stage = document.createElement('span');
      stage.textContent = '복구 필요';
      const message = document.createElement('p');
      message.textContent = '상세페이지 섹션 현재 상태를 확인하세요.';
      const button = document.createElement('button');
      button.textContent = '저장본 열기';
      row.append(name, stage, message, button);
      queuePanel.querySelector('.native-batch-queue-list').append(row);

      stage.style.inlineSize = 'max-content';
      const text = stage.firstChild;
      const wordStart = stage.textContent.indexOf('필요');
      const prefix = document.createRange();
      prefix.setStart(text, 0);
      prefix.setEnd(text, wordStart);
      const firstGlyph = document.createRange();
      firstGlyph.setStart(text, wordStart);
      firstGlyph.setEnd(text, wordStart + 1);
      const stageLeft = stage.getBoundingClientRect().left;
      const narrowWidth = (prefix.getBoundingClientRect().right - stageLeft)
        + firstGlyph.getBoundingClientRect().width + 0.1;
      stage.style.inlineSize = `${narrowWidth}px`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const word = document.createRange();
      word.setStart(text, wordStart);
      word.setEnd(text, wordStart + 2);
      return {
        narrowWidth,
        wordRects: [...word.getClientRects()].map(rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })),
        wordBreak: getComputedStyle(stage).wordBreak,
        overflowWrap: getComputedStyle(stage).overflowWrap,
        rowWidth: row.getBoundingClientRect().width,
      };
    }, viewModuleUrl());
    assert.equal(observation.wordRects.length, 1, `필요 must remain one rendered line at 768px: ${JSON.stringify(observation)}`);
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'queue-768-cjk-green.json'), `${JSON.stringify(observation, null, 2)}\n`);
      await page.screenshot({ path: path.join(evidenceDir, 'queue-768-cjk-green.png') });
    }
  } finally {
    await browser.close();
    if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'queue-768-cleanup.json'), '{"browserClosed":true}\n');
  }
});

test('native conditional header controls respect hidden with the real theme at 375/768/1280px', async () => {
  const theme = fs.readFileSync(path.join(ROOT, 'src', 'factory-theme.css'), 'utf8');
  const conditionalIds = ['nativeBatchReconcile', 'nativeBatchLocalRecovery'];
  const visibleIds = ['nativeBatchStart', 'nativeBatchSave', 'nativeBatchResume',
    'nativeBatchTab-input', 'nativeBatchTab-queue', 'nativeBatchTab-factory'];
  const evidenceDir = process.env.KUASANGSE_CJK_EVIDENCE_DIR;
  if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const observations = [];
  try {
    for (const width of [375, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 280 } });
      await page.setContent(`<!doctype html><html lang="ko"><head><style>${theme}
        * {margin:0;padding:0;box-sizing:border-box}
        body {font-family:Pretendard,'Noto Sans KR',sans-serif;background:var(--bg);color:var(--text)}
      </style></head><body><main id="app"></main></body></html>`);
      await page.evaluate(async ({ moduleUrl, modelText }) => {
        await import(moduleUrl);
        globalThis.__nativeBatchConsoleView(document, () => {});
        document.getElementById('nativeBatchModels').textContent = modelText;
      }, { moduleUrl: viewModuleUrl(), modelText: MODEL_TEXT });
      // View-only CSS states; controller conditions and command workflows are not exercised here.
      for (const [state, hidden] of [['default', null], ['shown', false], ['rehidden', true]]) {
        if (hidden !== null) await page.evaluate(({ ids, hidden }) => {
          for (const id of ids) document.getElementById(id).hidden = hidden;
        }, { ids: conditionalIds, hidden });
        const controls = await page.evaluate(ids => ids.map(id => {
          const node = document.getElementById(id);
          const css = getComputedStyle(node);
          return { id, hidden: node.hidden, disabled: node.disabled, display: css.display,
            rectCount: node.getClientRects().length, color: css.color, background: css.backgroundColor,
            padding: css.padding, font: css.font, borderRadius: css.borderRadius };
        }), [...conditionalIds, ...visibleIds]);
        const reachable = [];
        for (const id of [...visibleIds, ...(hidden === false ? conditionalIds : [])]) {
          const action = page.locator(`#${id}`);
          await action.scrollIntoViewIfNeeded();
          reachable.push(await action.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return { id: node.id, width: rect.width, height: rect.height, scrollY,
              inViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
              hitTarget: node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
          }));
        }
        const layout = await page.evaluate(() => {
          scrollTo(0, 0);
          return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
            consoleWidth: document.getElementById('nativeBatchConsole').getBoundingClientRect().width,
            rootScrollHeight: document.scrollingElement.scrollHeight, viewportHeight: innerHeight,
            bodyOverflowY: getComputedStyle(document.body).overflowY };
        });
        observations.push({ width, state, controls, reachable, layout });
        if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, `conditional-${width}-${state}.png`), fullPage: true });
      }
      await page.close();
    }
    if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'conditional-controls.json'), `${JSON.stringify({ browser: browser.version(), observations }, null, 2)}\n`);
    for (const observation of observations) {
      const { width, state, controls, reachable, layout } = observation;
      const hidden = state !== 'shown';
      assert.deepEqual(controls.slice(0, 2).map(control => ({ id: control.id, hidden: control.hidden,
        displayNone: control.display === 'none', noRects: control.rectCount === 0 })),
      conditionalIds.map(id => ({ id, hidden, displayNone: hidden, noRects: hidden })), `${width}px ${state}`);
      assert.ok(controls.slice(2).every(control => !control.hidden && control.display !== 'none' && control.rectCount > 0), `${width}px ${state}: visible header actions`);
      assert.ok(reachable.every(action => action.inViewport && action.hitTarget && action.width > 0 && action.height > 0), `${width}px ${state}: scroll reachability`);
      assert.ok(layout.scrollWidth <= layout.clientWidth, `${width}px ${state}: horizontal overflow`);
      assert.equal(layout.consoleWidth, width, `${width}px ${state}: fixture follows the real viewport`);
      assert.equal(layout.bodyOverflowY, 'auto', `${width}px ${state}: main vertical scrolling`);
    }
  } finally {
    await browser.close();
    if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'conditional-cleanup.json'), `${JSON.stringify({ browserClosed: !browser.isConnected() })}\n`);
  }
});
