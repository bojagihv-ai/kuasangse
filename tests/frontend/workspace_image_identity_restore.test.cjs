const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { openBrowserContractHarness } = require('./browser_contract_harness.cjs');

const CORE02 = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-02.js'), 'utf8');
const CORE03 = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');

test('workspace restore validates inline pixels against the immutable input fingerprint', () => {
  assert.match(CORE02, /function workspaceValidatedImageStatePayload\(/);
  assert.match(CORE02, /const validatedIncomingImage = workspaceValidatedImageStatePayload/);
  assert.match(CORE03, /const validatedWorkspaceImage = workspaceValidatedImageStatePayload/);
});

test('mismatched inline restore pixels are rejected instead of entering the active workspace', async () => {
  const { openBrowserContractHarness } = require('./browser_contract_harness.cjs');
  const harness = await openBrowserContractHarness();
  try {
    const result = await harness.call(() => {
      const expectedBase64 = '/9j/' + 'A'.repeat(700);
      const foreignBase64 = '/9j/' + 'B'.repeat(700);
      const expected = factoryCurrentVisualImageFingerprint(expectedBase64, 'image/jpeg', '');
      const restored = workspaceValidatedImageStatePayload({
        direct: { base64: foreignBase64, mime: 'image/jpeg' },
        images: [{ base64: foreignBase64, mime: 'image/jpeg' }],
      }, expected);
      const missing = workspaceValidatedImageStatePayload({
        direct: { preview: '__stored_in_indexeddb__' },
        images: [],
      }, expected);
      return {
        expected,
        blocked: restored.blocked,
        restoredBase64: restored.payload?.base64 || '',
        missingBlocked: missing.blocked,
        missingPayload: missing.payload?.preview || '',
      };
    });
    assert.match(result.expected, /^\d+:/);
    assert.equal(result.blocked, true);
    assert.equal(result.restoredBase64, '');
    assert.equal(result.missingBlocked, false);
    assert.equal(result.missingPayload, '__stored_in_indexeddb__');
  } finally {
    await harness.close();
  }
});
