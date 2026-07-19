const fs = require('fs');
const path = require('path');

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'app-core-06.js');
const loaderPath = path.join(root, 'src', 'app-loader.js');
const manifestPath = path.join(root, 'src', 'runtime-manifest.json');
const appHtmlPath = path.join(root, 'app.html');
const evidencePath = path.join(root, 'output', 'debug-evidence', 'comp-market-quick-action-fallback-v173.json');
const source = fs.readFileSync(sourcePath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const buildId = String(manifest.buildId || '').trim();

const checks = {
  delegatedFallbackGuard: /__compMarketQuickActionFallbackBound/.test(source),
  delegatedQuickActionSelector: /\[data-comp-market-quick-action\]/.test(source),
  preservesDirectHandlers: /typeof button\.onclick === 'function'/.test(source),
  vmCollectionAction: /action === 'start-vm'[\s\S]*runCompMarketScrape\('vm'\)/.test(source),
  localCollectionAction: /action === 'start-local'[\s\S]*runCompMarketScrape\('local'\)/.test(source),
  vmDetailAction: /action === 'detail-vm'[\s\S]*runCompMarketDetailCapture\(\)/.test(source),
  localDetailAction: /action === 'detail-local'[\s\S]*runCompMarketDetailCapture\(null, \{ runtime: 'local' \}\)/.test(source),
  analysisAction: /action === 'analyze-vm'[\s\S]*runCompMarketDetailCaptureAndAnalyze\(\)/.test(source),
  legacyVmDetailAction: /compMarketDetailSelected[\s\S]*runCompMarketDetailCapture\(\)/.test(source),
  legacyCandidateToggle: /data-comp-market-toggle-result[\s\S]*market\.selectedIds/.test(source),
  legacyCandidateSelection: /compMarketSelectAllCandidates[\s\S]*market\.selectedIds/.test(source),
  freshLoaderBuildId: buildId !== '20260713-candidate-scope-oauth-refresh-ui-v168',
  appHtmlUsesRuntimeManifest: !!buildId && appHtml.includes('src/runtime-manifest.json') && /manifest\.buildId/.test(appHtml),
};
const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const payload = { ok: failures.length === 0, checks, failures, buildId, files: [sourcePath, loaderPath, manifestPath, appHtmlPath] };

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ...payload, evidencePath }, null, 2));
if (failures.length) process.exit(1);
