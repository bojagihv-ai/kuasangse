const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');
const { buildAssetChecks, buildAssetSeed } = require('./factory_asset_restore_harness_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9800';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'factory-candidate-asset-restore-v224.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-candidate-asset-restore-v224.png');

async function capture(cdp, targetPath) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(targetPath, Buffer.from(screenshot.data, 'base64'));
}

function selectAssetCdpTarget(runtime) {
  const target = (runtime?.targets || []).find(item => item.type === 'page') || runtime?.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  return target;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seed = buildAssetSeed(Date.now());
  let runtime = null;
  let cdp = null;
  let proof = null;
  const cleanup = { cdpClosed: false, runtimeCleaned: false, errors: [] };
  let failure = null;

  try {
    runtime = await ensureCdp(CDP_URL);
    const target = selectAssetCdpTarget(runtime);
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const verifyUrl = new URL(APP_URL);
    verifyUrl.searchParams.set('candidateAssetRestore', `verify-v224-${seed.projectId}`);
    await cdp.send('Page.navigate', { url: verifyUrl.href });
    await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
      && typeof applyWorkspacePayload === 'function'
      && typeof applySessionAssetsPayload === 'function'
      && typeof normalizeFactoryState === 'function'
      && typeof factoryCandidateReviewCanApply === 'function'
      && typeof factoryCandidateReviewScopeKey === 'function'`, 60000);
    proof = await evaluateFactoryCdpFixture(cdp, `async ({ readAppState, readFactory, replaceFactory, renderApp }) => {
      const seed = ${JSON.stringify(seed)};
      applyWorkspacePayload({
        name: seed.productName,
        productName: seed.productName,
        step: 'factory',
        factory: normalizeFactoryState(seed.factory),
      }, {
        projectId: seed.projectId,
        createdAt: 1735689600000,
        skipPersistence: true,
        skipSideEffects: true,
        replaceWorkspace: true,
      });
      const applied = applySessionAssetsPayload({
        ...seed.serverAssets,
        factory: normalizeFactoryState(seed.serverAssets.factory),
      }, {
        preserveInlineImages: true,
        allowScopedInlineImages: true,
      });
      const restored = readFactory();
      replaceFactory({
        ...restored,
        automation: { ...(restored.automation || {}), activeTab: 'db' },
      });
      renderApp();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const app = readAppState();
      const factory = readFactory();
      const inspect = candidate => ({
        scope: candidate?.reviewProductScopeKey || '',
        identity: candidate?.reviewProductIdentityKey || '',
        canApply: factoryCandidateReviewCanApply(candidate, factory),
      });
      const button = selector => {
        const element = document.querySelector(selector);
        return { exists: !!element, disabled: element ? element.disabled : null, title: element ? element.title : '' };
      };
      return {
        applied,
        appWorkspaceId: app.currentProjectId || '',
        factoryWorkspaceId: factory.workspace?.id || factory.currentProjectId || '',
        currentScope: factoryCandidateReviewScopeKey(factory),
        db: (factory.product?.pendingDbCandidates || []).map(inspect),
        cafe24: (factory.product?.pendingCafe24Candidates || []).map(inspect),
        buttons: {
          dbDraft: button('[data-factory-apply-db-candidate="0"]'),
          dbForeign: button('[data-factory-apply-db-candidate="1"]'),
          cafeDraft: button('[data-factory-apply-cafe24-candidate="0"]'),
          cafeForeign: button('[data-factory-apply-cafe24-candidate="1"]'),
        },
      };
    }`);
    await evaluate(cdp, `document.querySelector('[data-factory-apply-db-candidate="0"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await capture(cdp, SCREENSHOT_PATH);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (cdp) cdp.close();
      cleanup.cdpClosed = true;
    } catch (error) {
      cleanup.errors.push({ stage: 'cdp-close', error: error?.stack || String(error) });
      failure = failure || error;
    } finally {
      try {
        await runtime?.cleanup?.();
        cleanup.runtimeCleaned = true;
      } catch (error) {
        cleanup.errors.push({ stage: 'runtime-cleanup', error: error?.stack || String(error) });
        failure = failure || error;
      }
    }
  }

  const completeProof = { ...(proof || {}), expected: seed, cleanup };
  const checks = Object.values(buildAssetChecks(completeProof));
  const result = { ok: !failure && checks.every(check => check.ok), proof: completeProof, checks, screenshotPath: SCREENSHOT_PATH };
  if (failure) result.error = failure?.stack || String(failure);
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  if (failure) throw failure;
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { main, selectAssetCdpTarget };

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
