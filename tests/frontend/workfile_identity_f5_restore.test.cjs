const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { openBrowserContractHarness } = require('./browser_contract_harness.cjs');

const CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-02.js'), 'utf8');

function functionBody(name, nextName) {
  const start = CORE.indexOf(`function ${name}(`);
  const end = CORE.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `missing function ${name}`);
  assert.notEqual(end, -1, `missing function ${nextName}`);
  return CORE.slice(start, end);
}

test('minimal and emergency F5 fallbacks retain the complete immutable identity fields', () => {
  const minimal = functionBody('buildMinimalLocalSessionPayload', 'buildEmergencyLocalSessionPayload');
  const emergency = functionBody('buildEmergencyLocalSessionPayload', 'prepareLocalSessionPayload');
  for (const [name, body] of [['minimal', minimal], ['emergency', emergency]]) {
    assert.match(body, /workIdentity:\s*payload\.workIdentity\s*\|\|\s*null/, `${name} must keep workIdentity`);
    assert.match(body, /inputImageFingerprint:\s*payload\.inputImageFingerprint\s*\|\|\s*['"]['"]/, `${name} must keep input fingerprint`);
    assert.match(body, /currentProjectCreatedAt:\s*payload\.currentProjectCreatedAt\s*\|\|\s*null/, `${name} must keep project birth timestamp`);
  }
});

async function openReadyBrowser() {
  const browser = await openBrowserContractHarness();
  await browser.call(async () => {
    await Promise.resolve(window.__KUASANGSE_BOOTSTRAP_PROMISE__).catch(() => {});
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (window.__KUASANGSE_APP_LOADER__?.ready === true && document.querySelector('#app > .app')) {
        await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(() => {});
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('factory app readiness timed out');
  });
  return browser;
}

test('every local-session size fallback preserves the immutable work identity for F5 restore', async () => {
  const browser = await openReadyBrowser();
  try {
    const result = await browser.call(() => {
      const projectId = 'project_f5_identity_regression';
      const scopeId = `project:${projectId}`;
      const productName = '양단호박바늘쌈';
      const inputImageFingerprint = '4526768:/9j/4UIURX-regression';
      const createdAt = 1722470400000;
      const workIdentity = workspacePersistenceApi().createWorkIdentity({
        instanceId: `work:${projectId}:${createdAt}`,
        workspaceId: scopeId,
        initialProductName: productName,
        initialInputImageFingerprint: inputImageFingerprint,
        createdAt,
      });
      const payload = {
        step: 'factory',
        currentProjectId: projectId,
        currentProjectName: '2607.31양단호박바늘쌈',
        currentProjectCreatedAt: createdAt,
        workspaceScope: { id: scopeId },
        productName,
        inputImageFingerprint,
        workIdentity,
        factory: {
          currentProjectId: projectId,
          workspace: { id: projectId, name: '2607.31양단호박바늘쌈', createdAt },
          workIdentity,
          product: {
            productName,
            userProductName: productName,
            inputImageFingerprint,
            lockedInputImageFingerprint: inputImageFingerprint,
          },
        },
      };
      const snapshots = {
        compact: buildCompactLocalSessionPayload(payload),
        minimal: buildMinimalLocalSessionPayload(payload),
        emergency: buildEmergencyLocalSessionPayload(payload),
      };
      return Object.fromEntries(Object.entries(snapshots).map(([name, snapshot]) => [name, {
        workIdentity: snapshot.workIdentity || null,
        inputImageFingerprint: snapshot.inputImageFingerprint || '',
        currentProjectCreatedAt: snapshot.currentProjectCreatedAt || null,
        validation: workspacePersistenceApi().validateSnapshotIdentity(snapshot),
      }]));
    });

    for (const [fallback, restored] of Object.entries(result)) {
      assert.equal(restored.workIdentity?.instanceId, 'work:project_f5_identity_regression:1722470400000', `${fallback} lost workIdentity`);
      assert.equal(restored.inputImageFingerprint, '4526768:/9j/4UIURX-regression', `${fallback} lost input fingerprint`);
      assert.equal(restored.currentProjectCreatedAt, 1722470400000, `${fallback} lost project birth timestamp`);
      assert.equal(restored.validation.ok, true, `${fallback} no longer validates`);
      assert.equal(restored.validation.code, 'WORK_IDENTITY_VALID', `${fallback} degraded to legacy identity`);
    }
  } finally {
    await browser.close();
  }
});
