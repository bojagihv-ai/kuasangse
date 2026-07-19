const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const COMMANDS = path.resolve(__dirname, '../../src/modules/composition-commands.mjs');

async function loadCommands() {
  return import(`${pathToFileURL(COMMANDS).href}?guard=${Date.now()}-${Math.random()}`);
}

test('direct command invocation rejects before dispatch while readonly', async () => {
  const { createCompositionCommands, WorkspaceReadOnlyError } = await loadCommands();
  const actions = [];
  const commands = createCompositionCommands({
    dispatch(action) { actions.push(action); },
    authority: { snapshot: () => ({ mode: 'readonly', reasonCode: 'LEASE_HELD' }) },
  });

  assert.throws(() => commands.productToOptions({ value: 1 }), WorkspaceReadOnlyError);
  assert.deepEqual(actions, []);
});

test('offline unique draft can dispatch but saved project cannot use hidden force override', async () => {
  const { createCompositionCommands } = await loadCommands();
  const actions = [];
  let snapshot = { mode: 'offline-edit', scopeId: 'draft:unique' };
  const commands = createCompositionCommands({
    dispatch(action) { actions.push(action); },
    authority: { snapshot: () => snapshot },
  });
  commands.productToOptions({ force: true });
  snapshot = { mode: 'readonly', scopeId: 'project:alpha', reasonCode: 'AUTHORITY_UNAVAILABLE' };

  assert.throws(() => commands.productToOptions({ force: true }), /read.?only|읽기 전용/i);
  assert.equal(actions.length, 1);
});
