const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const MODULE = path.join(ROOT, 'src/menus/factory/tabs/competitor-tab.mjs');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function escapeMarkup(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function populatedSnapshot() {
  const longLabel = `${'긴후보이름'.repeat(60)}<unsafe>`;
  return deepFreeze({
    factory: {
      automation: {
        activeTab: 'competitor',
        competitorPanelOpen: true,
        tasks: [{ id: 'competitor-candidates', tab: 'competitor' }],
      },
      product: { productName: '테스트 상품' },
    },
    competitors: {
      compPage: {
        analysisResult: {
          page_title: '분석 결과',
          page_score: { total: 8, grade: 'A', verdict: '검증됨' },
          sections_found: [{ id: 'hero' }],
          analyzedAt: '2026-07-18T00:00:00.000Z',
          compMarketImageSelection: { key: 'selection-a' },
        },
        analysisImageSelection: { key: 'selection-a' },
        analyzeLogs: [{ message: 'done' }],
        marketScrape: {
          totalTarget: 9,
          marketTargets: { coupang: 2, naver: 2, gmarket: 2, auction: 2, elevenst: 1 },
          candidateView: 'local',
          collectMode: 'local',
          loading: false,
          searchId: 'search-a',
          localResults: [{
            id: 'candidate-a',
            title: longLabel,
            platform: 'naver',
            product_url: 'https://example.test/item/a',
            thumbnail_url: 'https://example.test/item/a.webp',
          }],
          results: [],
          selectedIds: ['candidate-a'],
          detailOperation: { id: 'detail-a', selectedIds: ['candidate-a'] },
          scrapedImages: [{
            id: 'image-a',
            detailOperationId: 'detail-a',
            title: longLabel,
            platform: 'naver',
            src: 'https://example.test/image/a.webp',
            productUrl: 'https://example.test/item/a',
          }],
          selectedImageIds: ['detail:image-a:https://example.test/item/a:'],
          previewImageId: 'detail:image-a:https://example.test/item/a:',
          selectedImageSignature: { key: 'selection-a' },
        },
      },
    },
  });
}

function capabilities(options = {}) {
  const calls = [];
  const snapshot = options.snapshot || populatedSnapshot();
  let operationToken = 'workspace-a:fence-1';
  const actions = {
    runGuideAction(action) {
      calls.push({ kind: 'guide', action });
      return options.deferred || Promise.resolve(action);
    },
    runMarketAction(payload) {
      calls.push({ kind: 'market', payload });
      return options.deferred || Promise.resolve(payload);
    },
  };
  const renderHelpers = {
    escapeHtml: escapeMarkup,
    escAttr: escapeMarkup,
    disabledAttr(disabled, reason = '') {
      return disabled ? `disabled aria-disabled="true" title="${escapeMarkup(reason)}"` : '';
    },
    renderFactoryAutomationVmSearchInfo(_factory, _tone, market) {
      return `<div data-vm-info="${escapeMarkup(market?.candidateView || '')}"></div>`;
    },
    renderFactoryAutomationTaskChecklist(tasks) {
      return `<div data-task-count="${tasks.length}"></div>`;
    },
    renderFactoryAutomationStatusCard(label, value) {
      return `<div data-status-card="${escapeMarkup(label)}">${escapeMarkup(value)}</div>`;
    },
    renderFactoryLightImage(src, alt, attrs = '') {
      return `<img src="${escapeMarkup(src)}" alt="${escapeMarkup(alt)}" ${attrs}>`;
    },
    renderCompetitorAnalyzeLogItems(logs) {
      return `<div data-log-count="${logs.length}"></div>`;
    },
    renderCompMarketScrapePanel(_snapshot, market) {
      return `<div data-full-market-panel="${escapeMarkup(market?.searchId || '')}"></div>`;
    },
  };
  return {
    value: {
      getSnapshot: () => snapshot,
      assertMutable() {
        calls.push({ kind: 'authority' });
        if (options.readOnly) throw new Error('READ_ONLY');
      },
      getOperationToken: () => operationToken,
      isOperationCurrent: token => token === operationToken,
      reportError: error => calls.push({ kind: 'error', error }),
      actions,
      renderHelpers,
    },
    calls,
    snapshot,
    setOperationToken(value) { operationToken = value; },
  };
}

async function importFresh() {
  assert.equal(fs.existsSync(MODULE), true, 'competitor tab implementation must exist');
  return import(`${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`);
}

function fakeRoot() {
  const listeners = new Map();
  return {
    listeners,
    root: {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      contains(node) { return node?.inside !== false; },
    },
    dispatch(type, target) {
      const event = {
        type,
        target,
        preventDefault() {},
        stopPropagation() {},
      };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    activeCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

function delegatedTarget({ dataset = {}, id = '', value = '', selector, inside = true }) {
  return {
    dataset,
    id,
    value,
    inside,
    disabled: false,
    getAttribute() { return null; },
    closest(candidate) { return candidate.includes(selector) ? this : null; },
  };
}

test('FACTORY-COMP boundary exports only createCompetitorFactoryTab and preserves the immutable snapshot', async () => {
  const namespace = await importFresh();
  const harness = capabilities();
  const tab = namespace.createCompetitorFactoryTab(harness.value);

  assert.deepEqual(Object.keys(namespace), ['createCompetitorFactoryTab']);
  assert.equal(tab.version, 'factory-tab:v1');
  assert.equal(tab.id, 'factory/competitor');
  assert.equal(tab.owner, 'competitors');
  assert.strictEqual(tab.select({ forbidden: true }), harness.snapshot);
  assert.deepEqual([...tab.persistence.reads], ['competitors']);
  assert.deepEqual([...tab.persistence.writes], ['competitors']);
});

test('FACTORY-COMP render keeps every legacy selector reachable with overflow-safe long labels', async () => {
  const namespace = await importFresh();
  const harness = capabilities();
  const html = namespace.createCompetitorFactoryTab(harness.value).render(harness.snapshot);

  for (const selector of [
    'data-factory-comp-market-total-target',
    'data-factory-comp-market-target="coupang"',
    'data-comp-market-source-view="vm"',
    'data-comp-market-quick-action="select-all"',
    'data-comp-market-quick-action="clear-selection"',
    'data-comp-market-quick-action="detail-vm"',
    'data-comp-market-quick-action="detail-local"',
    'data-comp-market-toggle-result="candidate-a"',
    'data-comp-market-toggle-image="detail:image-a:https://example.test/item/a:"',
    'data-comp-market-preview-image="detail:image-a:https://example.test/item/a:"',
    'data-factory-guide-action="toggle-competitor-panel"',
    'data-factory-guide-action="open-competitor"',
    'data-factory-guide-action="open-competitor-report"',
    'data-factory-guide-action="go-tab:sections"',
  ]) assert.match(html, new RegExp(selector));
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /data-full-market-panel="search-a"/);
  const emptySnapshot = deepFreeze({
    factory: { automation: { activeTab: 'competitor' } },
    competitors: { compPage: { marketScrape: { searchId: 'search-empty' } } },
  });
  const emptyHarness = capabilities({ snapshot: emptySnapshot });
  const emptyHtml = namespace.createCompetitorFactoryTab(emptyHarness.value).render(emptySnapshot);
  assert.match(emptyHtml, /data-comp-market-quick-action="reload"/);
  assert.doesNotMatch(html, /white-space\s*:\s*nowrap/i);
  assert.doesNotMatch(emptyHtml, /white-space\s*:\s*nowrap/i);
  assert.doesNotMatch(html, /minmax\((?:118|132|260)px\s*,/i);
  assert.doesNotMatch(html, /<unsafe>/);
});

test('FACTORY-COMP falls back to visible VM results when source caches are present but empty', async () => {
  const namespace = await importFresh();
  const vmRow = {
    id: 'vm-visible-candidate',
    title: '모시바둑파우치 후보',
    platform: 'coupang',
    product_url: 'https://example.test/vm-visible-candidate',
    _search_runtime: 'vm',
  };
  const snapshot = deepFreeze({
    factory: { automation: { activeTab: 'competitor' } },
    competitors: {
      compPage: {
        marketScrape: {
          candidateView: 'vm',
          collectMode: 'vm',
          vmResults: [],
          vmGroupedResults: {},
          results: [vmRow],
          groupedResults: { coupang: [vmRow] },
          selectedIds: [],
          scrapedImages: [],
        },
      },
    },
  });
  const harness = capabilities({ snapshot });
  const html = namespace.createCompetitorFactoryTab(harness.value).render(snapshot);

  assert.match(html, /data-comp-market-toggle-result="vm-visible-candidate"/);
  assert.match(html, /VM 후보 1건 중/);
  assert.doesNotMatch(html, /후보가 0건이면 선택할 카드가 없습니다/);
});

test('FACTORY-COMP prominently explains when VM failure forced a last-resort local fallback', async () => {
  const namespace = await importFresh();
  const fallbackRow = {
    id: 'assisted-candidate',
    title: '호박바늘쌈 후보',
    platform: 'coupang',
    product_url: 'https://example.test/assisted-candidate',
    _search_runtime: 'market_assisted',
    _assisted_fallback_for_vm: true,
  };
  const snapshot = deepFreeze({
    factory: { automation: { activeTab: 'competitor' } },
    competitors: {
      compPage: {
        marketScrape: {
          candidateView: 'vm',
          collectMode: 'vm',
          phase: 'search-complete-assisted',
          vmFallback: {
            active: true,
            reason: 'VM 워커 health 응답 시간 초과',
            source: '오픈마켓 Chrome 보조수집',
          },
          results: [fallbackRow],
          groupedResults: { coupang: [fallbackRow] },
          selectedIds: [],
          scrapedImages: [],
        },
      },
    },
  });
  const harness = capabilities({ snapshot });
  const html = namespace.createCompetitorFactoryTab(harness.value).render(snapshot);

  assert.match(html, /data-factory-vm-fallback-warning/);
  assert.match(html, /VM 워커 health 응답 시간 초과/);
  assert.match(html, /오픈마켓 Chrome 보조수집/);
  assert.match(html, /VM 결과가 아니라 보조수집 결과/);
});

test('FACTORY-COMP makes VM and Windows Chrome explicit collection choices', async () => {
  const namespace = await importFresh();
  const snapshot = deepFreeze({
    factory: { automation: { activeTab: 'competitor' } },
    competitors: {
      compPage: {
        marketScrape: {
          collectMode: 'vm',
          candidateView: 'vm',
          results: [],
          selectedIds: [],
          scrapedImages: [],
        },
      },
    },
  });
  const harness = capabilities({ snapshot });
  const html = namespace.createCompetitorFactoryTab(harness.value).render(snapshot);

  assert.match(html, /data-comp-market-collection-choice/);
  assert.match(html, /data-factory-guide-action="rerun-vm-competitors"/);
  assert.match(html, /data-factory-guide-action="rerun-local-competitors"/);
  assert.doesNotMatch(html, /onclick=/);
  assert.match(html, /VM에서 수집/);
  assert.match(html, /내 Windows Chrome에서 수집/);
  assert.match(html, /자동 전환하지 않습니다/);
});

test('FACTORY-COMP delegated root events use declared actions after authority', async () => {
  const namespace = await importFresh();
  const harness = capabilities();
  const tab = namespace.createCompetitorFactoryTab(harness.value);
  const root = fakeRoot();
  const dispose = tab.bind(root.root);

  root.dispatch('click', delegatedTarget({
    dataset: { factoryGuideAction: 'rerun-vm-competitors' },
    selector: '[data-factory-guide-action]',
    inside: false,
  }));
  assert.equal(harness.calls.length, 0, 'delegation must ignore nodes outside the bound root');
  root.dispatch('click', delegatedTarget({
    dataset: { factoryGuideAction: 'rerun-vm-competitors' },
    selector: '[data-factory-guide-action]',
  }));
  root.dispatch('click', delegatedTarget({
    dataset: { compMarketQuickAction: 'detail-local' },
    selector: '[data-comp-market-quick-action]',
  }));
  root.dispatch('click', delegatedTarget({
    dataset: { compMarketToggleResult: 'candidate-a' },
    selector: '[data-comp-market-toggle-result]',
  }));
  root.dispatch('input', delegatedTarget({
    value: '7',
    selector: '[data-factory-comp-market-total-target]',
  }));

  assert.deepEqual(harness.calls.slice(0, 8).map(call => call.kind), [
    'authority', 'guide', 'authority', 'market', 'authority', 'market', 'authority', 'market',
  ]);
  assert.equal(harness.calls[3].payload.action, 'detail-local');
  assert.equal(harness.calls[5].payload.candidateId, 'candidate-a');
  assert.deepEqual(harness.calls[7].payload, {
    type: 'candidate-target', scope: 'total', siteId: '', value: '7', commit: false,
  });
  dispose();
  dispose();
  assert.equal(root.activeCount(), 0);
});

test('FACTORY-COMP authority blocks actions and stale async completion is rejected', async () => {
  const namespace = await importFresh();
  const blockedHarness = capabilities({ readOnly: true });
  const blocked = namespace.createCompetitorFactoryTab(blockedHarness.value);
  assert.throws(() => blocked.invoke('guideAction', 'rerun-vm-competitors'), /READ_ONLY/);
  assert.equal(blockedHarness.calls.some(call => call.kind === 'guide'), false);

  let resolve;
  const deferred = new Promise(done => { resolve = done; });
  const staleHarness = capabilities({ deferred });
  const stale = namespace.createCompetitorFactoryTab(staleHarness.value);
  const pending = stale.invoke('guideAction', 'rerun-vm-competitors');
  staleHarness.setOperationToken('workspace-b:fence-2');
  resolve('foreign');
  await assert.rejects(pending, /STALE_FACTORY_TAB_OPERATION/);
});

test('FACTORY-COMP 50 lifecycle cycles leave no listener and perform no lifecycle action', async () => {
  const namespace = await importFresh();
  const harness = capabilities();
  const tab = namespace.createCompetitorFactoryTab(harness.value);
  const root = fakeRoot();

  for (let cycle = 0; cycle < 50; cycle += 1) {
    tab.onEnter();
    const dispose = tab.bind(root.root);
    dispose();
    dispose();
    tab.onLeave();
    assert.equal(root.activeCount(), 0);
  }
  assert.equal(harness.calls.some(call => call.kind === 'guide' || call.kind === 'market'), false);
});

test('FACTORY-COMP sources stay below 250 pure LOC and do not access mutable globals', async () => {
  await importFresh();
  const directory = path.dirname(MODULE);
  const files = fs.readdirSync(directory)
    .filter(name => /^competitor-tab(?:-[a-z-]+)?\.mjs$/.test(name));
  assert.ok(files.length >= 4);
  for (const name of files) {
    const source = fs.readFileSync(path.join(directory, name), 'utf8');
    const pureLoc = source.split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('//')).length;
    assert.ok(pureLoc <= 250, `${name}: ${pureLoc} pure LOC`);
    assert.doesNotMatch(source, /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/);
    assert.doesNotMatch(source, /\bstate\s*(?:\.|\[)/);
  }
});
