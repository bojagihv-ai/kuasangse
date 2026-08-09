const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const APP_CORE = path.resolve(__dirname, '../../src/app-core-02.js');
const RUNTIME_CORE = path.resolve(__dirname, '../../src/app-core-06.js');

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = [
    source.indexOf(`function ${nextName}(`, start + 1),
    source.indexOf(`async function ${nextName}(`, start + 1),
  ].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `${name} source not found`);
  assert.notEqual(end, -1, `${nextName} source boundary not found`);
  return source.slice(start, end);
}

test('Given a user edits a new-work field When the input becomes idle Then a durable last-work save is scheduled', () => {
  const source = fs.readFileSync(APP_CORE, 'utf8');
  const scheduleSource = functionSource(
    source,
    'scheduleLastWorkSave',
    'settleWorkspaceScopeTransitionPersistence',
  );
  const timers = [];
  const calls = { checkpoint: 0, sync: 0, persistent: 0 };
  const context = {
    LAST_WORK_INPUT_IDLE_MS: 1400,
    lastWorkSaveTimer: null,
    lastWorkSyncingVisibleInputs: false,
    lastWorkIsInteractiveInputWindow: () => true,
    scheduleLastWorkInputCheckpointSave: () => { calls.checkpoint += 1; },
    syncVisibleLastWorkInputs: () => { calls.sync += 1; },
    savePersistentState: () => { calls.persistent += 1; },
    setTimeout: callback => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  vm.runInNewContext(`${scheduleSource}; this.scheduleLastWorkSave = scheduleLastWorkSave;`, context);

  context.scheduleLastWorkSave(900, { lightweight: true });

  assert.equal(calls.checkpoint, 1);
  assert.equal(timers.length, 1, '입력 체크포인트 뒤 durable save 타이머가 예약되어야 합니다.');
  timers[0]();
  assert.equal(calls.sync, 1);
  assert.equal(calls.persistent, 1);
});

test('Given a long factory command owns a draft When autosave fires Then it saves a detached draft without committing the idle snapshot', () => {
  const source = fs.readFileSync(APP_CORE, 'utf8');
  const scheduleSource = functionSource(
    source,
    'scheduleLastWorkSave',
    'settleWorkspaceScopeTransitionPersistence',
  );
  const timers = [];
  const committed = { id: 'committed', goalRun: { progress: 0 } };
  const owned = { id: 'owned', goalRun: { progress: 66 } };
  const calls = { persistent: 0, saves: [] };
  const context = {
    LAST_WORK_INPUT_IDLE_MS: 1400,
    lastWorkSaveTimer: null,
    lastWorkSyncingVisibleInputs: false,
    lastWorkIsInteractiveInputWindow: () => false,
    factoryRuntimeReadFactory: () => owned,
    factoryRuntimeReadCommittedFactory: () => committed,
    factoryRuntimeDetachedValue: value => JSON.parse(JSON.stringify(value)),
    syncVisibleLastWorkInputs: () => {},
    savePersistentState: () => { calls.persistent += 1; },
    saveLastWorkNow: options => { calls.saves.push(options); },
    setTimeout: callback => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
  };
  vm.runInNewContext(`${scheduleSource}; this.scheduleLastWorkSave = scheduleLastWorkSave;`, context);

  context.scheduleLastWorkSave(1200);
  timers[0]();

  assert.equal(calls.persistent, 0, '실행 중 autosave가 committed snapshot을 저장하면 draft revision이 무효화됩니다.');
  assert.equal(calls.saves.length, 1);
  assert.notStrictEqual(calls.saves[0].factory, owned, '나중에 폐기될 proxy를 타이머가 보관하면 안 됩니다.');
  assert.deepEqual(calls.saves[0].factory, owned);
  assert.equal(calls.saves[0].sync, false);
});

test('Given a user types the new product identity in the factory When the global input handler runs Then autosave is not skipped', () => {
  const source = fs.readFileSync(RUNTIME_CORE, 'utf8');
  const skipSource = functionSource(
    source,
    'shouldSkipGlobalLastWorkInputSave',
    'handleClassicRuntimeInput',
  );
  const context = {};
  vm.runInNewContext(`${skipSource}; this.shouldSkip = shouldSkipGlobalLastWorkInputSave;`, context);
  const identityInput = {
    matches: selector => selector.split(',').map(value => value.trim()).includes('#factoryProductName'),
    closest: selector => {
      if (selector.includes('[data-factory-wizard-field]')) return null;
      if (selector === '.factory-page' || selector === '#factoryAutomationPanel') return {};
      return null;
    },
  };

  assert.equal(
    context.shouldSkip(identityInput, 'input'),
    false,
    '새 작업 상품명 input은 idle durable autosave 경로에 들어가야 합니다.',
  );
});
