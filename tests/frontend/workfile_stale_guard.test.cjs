const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ADAPTER = path.resolve(__dirname, '../../src/modules/persistence/workfile-adapter.mjs');

async function loadAdapter() {
  return import(`${pathToFileURL(ADAPTER).href}?stale=${Date.now()}-${Math.random()}`);
}

function handle(initialText) {
  let text = initialText;
  let writes = 0;
  return {
    async getFile() { return { async text() { return text; } }; },
    async createWritable() {
      return {
        async write(value) { text = value; writes += 1; },
        async close() {},
        async abort() {},
      };
    },
    value: () => text,
    writes: () => writes,
  };
}

test('same handle overwrite re-reads digest and rejects external revision drift', async () => {
  const { createWorkfileAdapter, WorkfileStaleError } = await loadAdapter();
  const file = handle(JSON.stringify({ revision: 2, digest: 'newer' }));
  const adapter = createWorkfileAdapter({ root: {} });

  await assert.rejects(
    adapter.write({ snapshot: {} }, {
      handle: file,
      value: 'must-not-write',
      expectedFile: { revision: 1, digest: 'older' },
      currentAuthority: { mode: 'editing', fencingToken: 5 },
      fencingToken: 5,
    }),
    error => error instanceof WorkfileStaleError && error.code === 'WORKFILE_STALE',
  );
  assert.equal(file.writes(), 0);
});

test('Save As establishes distinct identity without reading or overwriting old handle', async () => {
  const { createWorkfileAdapter } = await loadAdapter();
  const oldFile = handle('old');
  const newFile = handle('');
  const adapter = createWorkfileAdapter({ root: {} });
  await adapter.write({ scopeId: 'project:new', snapshot: {} }, {
    handle: newFile,
    value: 'new',
    saveAs: true,
    currentAuthority: { mode: 'editing', fencingToken: 1 },
    fencingToken: 1,
  });

  assert.equal(oldFile.value(), 'old');
  assert.equal(newFile.value(), 'new');
});
