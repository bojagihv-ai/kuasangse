const fs = require('fs');
const path = require('path');

const root = process.cwd();
const uiPath = path.join(root, 'src', 'app-core-05.js');
const callPath = path.join(root, 'src', 'app-core-06.js');
const outPath = path.join(root, 'output', 'debug-evidence', 'comp-market-targets-contract-v145.json');
const ui = fs.readFileSync(uiPath, 'utf8');
const call = fs.readFileSync(callPath, 'utf8');

const checks = {
  defaultMarketTargetFour: /COMP_MARKET_DEFAULT_TARGET\s*=\s*4/.test(ui),
  defaultTotalTargetTwenty: /COMP_MARKET_DEFAULT_TOTAL_TARGET\s*=\s*20/.test(ui),
  fiveTargetInputs: /data-comp-market-target/.test(ui) && /compMarketTotalTarget/.test(ui),
  persistedTargetMap: /marketTargets/.test(ui) && /totalTarget/.test(ui),
  requestCompatibility: /market_targets/.test(call) && /marketTargets/.test(call) && /total_target/.test(call) && /totalTarget/.test(call),
  identityRequestFields: ['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId'].every(field => call.includes(field)),
  sharedNormalizedState: /collectionStatus/.test(ui) && /compMarketNormalizeCollectionStatus/.test(call),
  sourceAndShortfall: /sourceLabel/.test(call) && /shortfallReason/.test(call) && /requested/.test(ui) && /accepted/.test(ui),
  safeConnectorError: /connectorId/.test(call) && /endpointId/.test(call) && /HTTP/.test(call),
  guideLocalCandidateAction: /data-factory-guide-action="rerun-local-competitors"/.test(ui),
  guideLocalDetailAction: /data-comp-market-quick-action="detail-local"/.test(ui),
  guideLocalActionHandler: /action === 'rerun-local-competitors'/.test(call) && /runCompMarketScrape\('local'\)/.test(call),
  quickLocalActionHandler: /action === 'start-local'/.test(ui) && /action === 'detail-local'/.test(ui),
};
const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const payload = { ok: failures.length === 0, checks, failures, files: [uiPath, callPath] };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ...payload, evidencePath: outPath }, null, 2));
if (failures.length) process.exit(1);
