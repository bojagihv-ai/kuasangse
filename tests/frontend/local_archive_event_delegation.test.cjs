'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'src', 'app-core-06.js');
const RENDER_CORE = path.join(ROOT, 'src', 'app-core-05.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 필요합니다.`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} 함수 시그니처 경계가 필요합니다.`);
  const braceStart = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 함수 본문 경계를 찾지 못했습니다.`);
}

function bindPartialAssetsActions() {
  const source = fs.readFileSync(CORE, 'utf8');
  const calls = [];
  const refresh = { onclick: null };
  const restore = { onclick: null };
  const load = { dataset: { factoryLocalArchiveLoad: 'legacy-hero' }, onclick: null };
  const root = {
    querySelector(selector) {
      if (selector === '#factoryRefreshLocalArchiveAssets') return refresh;
      if (selector === '#factoryRestoreLocalArchiveToCurrentWork') return restore;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-factory-local-archive-load]' ? [load] : [];
    },
  };
  const context = vm.createContext({
    factoryRefreshLocalArchiveAssets: () => calls.push('refresh'),
    factoryRestoreLocalArchiveToCurrentWork: () => calls.push('restore'),
    factoryLoadLocalArchiveAsset: archiveId => calls.push(`load:${archiveId}`),
  });
  vm.runInContext(
    `${extractFunction(source, 'factoryBindLocalArchiveActionButtons')}\nglobalThis.bind = factoryBindLocalArchiveActionButtons;`,
    context,
  );
  context.bind(root);
  refresh.onclick();
  restore.onclick();
  load.onclick();
  return calls;
}

function runInlineAction(button) {
  const source = fs.readFileSync(CORE, 'utf8');
  const calls = [];
  const context = vm.createContext({
    factoryRefreshLocalArchiveAssets: () => calls.push('refresh'),
    factoryRestoreLocalArchiveToCurrentWork: () => calls.push('restore'),
    factoryLoadLocalArchiveAsset: archiveId => calls.push(`load:${archiveId}`),
  });
  vm.runInContext(
    `${extractFunction(source, 'factoryLocalArchiveActionButtonInline')}\nglobalThis.handle = factoryLocalArchiveActionButtonInline;`,
    context,
  );
  const event = {
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  const result = context.handle(button, event);
  return { calls, event, result };
}

function runStableDocumentAction(button) {
  const source = fs.readFileSync(CORE, 'utf8');
  const calls = [];
  const context = vm.createContext({
    factoryRefreshLocalArchiveAssets: () => calls.push('refresh'),
    factoryRestoreLocalArchiveToCurrentWork: () => calls.push('restore'),
    factoryLoadLocalArchiveAsset: archiveId => calls.push(`load:${archiveId}`),
    factoryLog: () => {},
    saveLastWorkNow: () => {},
    factoryRenderLocalArchivePanel: () => {},
  });
  vm.runInContext(
    `${extractFunction(source, 'handleFactoryLocalArchiveActionClick')}\nglobalThis.handle = handleFactoryLocalArchiveActionClick;`,
    context,
  );
  const event = {
    target: button,
    prevented: false,
    stopped: false,
    immediateStopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
  };
  context.handle(event);
  return { calls, event };
}

test('부분 렌더로 교체된 보관함 버튼도 현재 DOM에 직접 다시 연결한다', () => {
  assert.deepEqual(bindPartialAssetsActions(), ['refresh', 'restore', 'load:legacy-hero']);
});

test('별도 로컬 보관함 패널 부분 패치는 morphNode 직후 action 버튼을 다시 연결한다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const patch = extractFunction(source, 'factoryPatchLocalArchiveMiniPanel');

  assert.match(
    patch,
    /renderFactoryLocalArchiveMiniPanel\(factory\)/,
  );
  assert.match(patch, /morphNode\(currentPanel, nextPanel\);\s*factoryBindLocalArchiveActionButtons\(currentPanel\);/);
});

test('보관함 자동 새로고침은 별도 패널과 assets 탭을 모두 부분 갱신한다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const renderer = extractFunction(source, 'factoryRenderLocalArchivePanel');

  assert.match(renderer, /const localPanelPatched = factoryPatchLocalArchiveMiniPanel\(factory\);/);
  assert.match(renderer, /if \(localPanelPatched \|\| automationPatched\) return true;/);
});

test('전체 렌더도 초기에 같은 보관함 action 바인더를 사용한다', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const bindFactoryEvents = extractFunction(source, 'bindFactoryEvents');

  assert.match(bindFactoryEvents, /const factory = factoryRuntimeReadFactory\(\);\s*factoryBindLocalArchiveActionButtons\(document\);/);
});

test('부분 렌더 뒤 inline fallback은 보관함 복원·새로고침·가져오기를 실행한다', () => {
  const restore = runInlineAction({
    disabled: false,
    dataset: { factoryLocalArchiveAction: 'restore' },
    getAttribute: () => null,
  });
  const refresh = runInlineAction({
    disabled: false,
    dataset: { factoryLocalArchiveAction: 'refresh' },
    getAttribute: () => null,
  });
  const load = runInlineAction({
    disabled: false,
    dataset: { factoryLocalArchiveAction: 'load', factoryLocalArchiveLoad: 'legacy-hero' },
    getAttribute: () => null,
  });

  assert.deepEqual(restore.calls, ['restore']);
  assert.deepEqual(refresh.calls, ['refresh']);
  assert.deepEqual(load.calls, ['load:legacy-hero']);
  assert.equal(restore.event.prevented, true);
  assert.equal(restore.event.stopped, true);
  assert.equal(restore.result, false);
});

test('보관함 렌더는 lifecycle 바인딩과 무관한 inline fallback을 제공한다', () => {
  const renderSource = fs.readFileSync(RENDER_CORE, 'utf8');
  const runtimeSource = fs.readFileSync(CORE, 'utf8');

  assert.match(renderSource, /id=\"factoryRestoreLocalArchiveToCurrentWork\"[^>]*data-factory-local-archive-action=\"restore\"[^>]*onclick=\"return window\.factoryLocalArchiveActionButtonInline\(this,event\)\"/);
  assert.match(renderSource, /id=\"factoryRefreshLocalArchiveAssets\"[^>]*data-factory-local-archive-action=\"refresh\"[^>]*onclick=\"return window\.factoryLocalArchiveActionButtonInline\(this,event\)\"/);
  assert.match(renderSource, /data-factory-local-archive-load=\"\$\{escAttr\(archiveId\)\}\"[^>]*data-factory-local-archive-action=\"load\"[^>]*onclick=\"return window\.factoryLocalArchiveActionButtonInline\(this,event\)\"/);
  assert.match(runtimeSource, /window\.factoryLocalArchiveActionButtonInline = factoryLocalArchiveActionButtonInline;/);
});

test('stable document capture는 부분 렌더 뒤 보관 action을 정확히 한 번 실행한다', () => {
  const makeButton = dataset => ({
    disabled: false,
    dataset,
    getAttribute: () => null,
    closest: selector => selector === '[data-factory-local-archive-action]' ? button : null,
  });
  let button = makeButton({ factoryLocalArchiveAction: 'restore' });
  const restore = runStableDocumentAction(button);
  button = makeButton({ factoryLocalArchiveAction: 'refresh' });
  const refresh = runStableDocumentAction(button);
  button = makeButton({ factoryLocalArchiveAction: 'load', factoryLocalArchiveLoad: 'legacy-hero' });
  const load = runStableDocumentAction(button);

  assert.deepEqual(restore.calls, ['restore']);
  assert.deepEqual(refresh.calls, ['refresh']);
  assert.deepEqual(load.calls, ['load:legacy-hero']);
  assert.equal(restore.event.prevented, true);
  assert.equal(restore.event.stopped, true);
  assert.equal(restore.event.immediateStopped, true);
});

test('classic runtime listener lifecycle keeps the stable archive action capture bound', () => {
  const source = fs.readFileSync(CORE, 'utf8');
  const bind = extractFunction(source, 'bindClassicRuntimeDocumentEvents');

  assert.match(bind, /document\.addEventListener\('click', handleFactoryLocalArchiveActionClick, true\);/);
  assert.match(bind, /document\.removeEventListener\('click', handleFactoryLocalArchiveActionClick, true\);/);
});
