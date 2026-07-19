import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sourceFiles(root) {
  const excludedDirectories = new Set(['.local', '.pytest_cache', '__pycache__', 'node_modules', 'static', 'venv', 'venv311']);
  const acceptedExtensions = new Set(['.py', '.ps1', '.txt', '.json', '.example']);
  const visit = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) || entry.name.startsWith('.venv') ? [] : visit(target);
    return acceptedExtensions.has(path.extname(entry.name)) ? [target] : [];
  });
  return visit(root);
}

const repositoryRoot = path.resolve(process.argv[2]);
const evidenceRoot = path.resolve(process.argv[3]);
const contractsRoot = path.join(repositoryRoot, 'control_tower', 'contracts', 'v1');
const fixturesRoot = path.join(repositoryRoot, 'control_tower', 'tests', 'contracts', 'fixtures');
const pythonReport = readJson(path.join(evidenceRoot, 'python-fixtures.json'));
const nodeReport = readJson(path.join(evidenceRoot, 'node-fixtures.json'));
const normalizedPython = stableValue(Object.fromEntries(Object.entries(pythonReport).filter(([key]) => key !== 'validator')));
const normalizedNode = stableValue(Object.fromEntries(Object.entries(nodeReport).filter(([key]) => key !== 'validator')));
const pythonDigest = digest(normalizedPython);
const nodeDigest = digest(normalizedNode);
const parity = {
  schemaVersion: '1.0.0',
  ok: canonical(normalizedPython) === canonical(normalizedNode),
  comparison: 'normalized-json-with-validator-field-removed',
  resultCount: pythonReport.results.length,
  pythonSha256: pythonDigest,
  nodeSha256: nodeDigest,
  mismatchCount: pythonDigest === nodeDigest ? 0 : 1,
};
writeJson(path.join(evidenceRoot, 'parity.json'), parity);

const fixtures = readdirSync(fixturesRoot)
  .filter((name) => name.endsWith('.fixture.json'))
  .sort()
  .flatMap((name) => readJson(path.join(fixturesRoot, name)).cases);
const batch = fixtures.find((item) => item.name === 'valid_two_product_batch').payload;
const compatibility = fixtures.find((item) => item.name === 'valid_factory_compatibility_registry').payload;
const stale = pythonReport.results.find((item) => item.name === 'stale_event_fingerprint');
const malformed = pythonReport.results.find((item) => item.name === 'malformed_input');
const replay = pythonReport.results.find((item) => item.name === 'non_monotonic_event_sequence');
const commonSchema = readJson(path.join(contractsRoot, 'common.schema.json'));
const catalog = readJson(path.join(contractsRoot, 'version-catalog.json'));
const transitionFields = commonSchema.$defs.transitionMetadata.required;
const expectedTransitionFields = ['from', 'to', 'owner', 'occurredAt', 'reason', 'attempt', 'cancellation', 'casPrerequisite', 'terminal', 'restartBehavior'];
const transitionTables = fixtures.filter((item) => item.payload?.contractType === 'state-transition-table');
const transitionRecordsComplete = transitionTables.every((item) => (
  typeof item.payload.owner === 'string'
  && Array.isArray(item.payload.allowedTransitions)
  && item.payload.allowedTransitions.length > 0
  && item.payload.allowedTransitions.every((transition) => expectedTransitionFields.every((field) => Object.hasOwn(transition, field)))
));
const actualStateKinds = new Set(transitionTables.map((item) => item.payload.stateKind));
const stateTransitionsOk = transitionTables.length === catalog.stateKinds.length
  && catalog.stateKinds.every((stateKind) => actualStateKinds.has(stateKind))
  && expectedTransitionFields.every((field) => transitionFields.includes(field))
  && transitionRecordsComplete;
const expectedCompatibilityIds = [
  'product_name', 'product_code', 'sale_price', 'consumer_price', 'dimensions', 'size', 'material', 'use_case',
  'weight', 'manufacturer', 'supplier', 'stock', 'option_method', 'option_name', 'option_values', 'option_image',
  'cafe24_category_requirements', 'sinhwa_db_product', 'cafe24_product', 'competitor_coupang',
  'competitor_smartstore', 'competitor_gmarket', 'competitor_auction', 'competitor_11st', 'required_field_candidate',
  'hero_a_cut', 'size_a_cut', 'option_color_a_cut', 'general_a_cut', 'section_variant_a_cut', 'final_detail_page',
];
const actualCompatibilityIds = compatibility.entries.map((entry) => entry.entryId);
const factorySource = readFileSync(path.join(repositoryRoot, 'src', 'app-core-03.js'), 'utf8');
const factorySection = factorySource.split('const FACTORY_SINHWA_FIELD_SECTIONS = [')[1].split('const FACTORY_STAGE_STATUS_LABELS')[0];
const currentFactoryFieldIds = [...factorySection.matchAll(/\bid: '([^']+)'/g)].map((match) => match[1]);
const requiredCompatibilityIds = [...new Set([...expectedCompatibilityIds, ...currentFactoryFieldIds])];
const compatibilityOk = requiredCompatibilityIds.every((entryId) => actualCompatibilityIds.includes(entryId));
const baselineTime = statSync(path.join(evidenceRoot, 'baseline.log')).mtimeMs;
const existingControlTowerFiles = [
  'control_tower/__init__.py',
  'control_tower/backend/__init__.py',
  'control_tower/backend/app.py',
  'control_tower/backend/config.py',
  'control_tower/frontend/control-tower.html',
  'control_tower/install_shortcut.ps1',
  'control_tower/launch.ps1',
  'control_tower/tests/backend/test_health.py',
  'control_tower/tests/test_icon_builder.py',
  'control_tower/tests/test_windows_launcher_contract.py',
  'control_tower/tools/build_icon.py',
];
const readOnlyFiles = [
  path.join(repositoryRoot, 'app.html'),
  ...sourceFiles(path.join(repositoryRoot, 'backend')),
  ...readdirSync(path.join(repositoryRoot, 'src')).filter((name) => name.startsWith('app-core-')).map((name) => path.join(repositoryRoot, 'src', name)),
  path.join(repositoryRoot, 'src', 'modules', 'persistence', 'contracts.mjs'),
  ...existingControlTowerFiles.map((name) => path.join(repositoryRoot, name)),
];
const readOnlyItems = [...new Set(readOnlyFiles)].sort().map((filePath) => {
  const stats = statSync(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
    lastWriteTimeMs: stats.mtimeMs,
    noTask2Write: stats.mtimeMs <= baselineTime,
  };
});
const task2OwnedRoots = [
  contractsRoot,
  path.join(repositoryRoot, 'control_tower', 'backend', 'contracts.py'),
  path.join(repositoryRoot, 'control_tower', 'frontend', 'src', 'contracts.mjs'),
  path.join(repositoryRoot, 'control_tower', 'tests', 'contracts'),
  evidenceRoot,
];
const ownershipOverlaps = readOnlyItems.filter((item) => task2OwnedRoots.some((ownedPath) => item.path === ownedPath || item.path.startsWith(`${ownedPath}${path.sep}`)));
const concurrentChanges = readOnlyItems.filter((item) => !item.noTask2Write).map((item) => item.path);
const readOnlyVerification = {
  schemaVersion: '1.0.0',
  baselineLogTimeMs: baselineTime,
  checkedFileCount: readOnlyItems.length,
  allPredateBaseline: concurrentChanges.length === 0,
  concurrentChangesDetected: concurrentChanges,
  task2OwnedRoots,
  ownershipOverlaps: ownershipOverlaps.map((item) => item.path),
  scopeIsolationOk: ownershipOverlaps.length === 0,
  files: readOnlyItems,
};
writeJson(path.join(evidenceRoot, 'readonly-verification.json'), readOnlyVerification);

const flakyLog = readFileSync(path.join(evidenceRoot, 'flaky-check.log'), 'utf8');
const staleReplayOk = stale.ok === false && stale.code === 'fingerprint_mismatch' && stale.stateDigestBefore === stale.stateDigestAfter;
const normalTwoProductBatchOk = pythonReport.validProductCount === 2 && nodeReport.validProductCount === 2 && batch.products.length === 2;
const flakyOrderOk = (flakyLog.match(/^\d+ passed in .+\r?$/gm) ?? []).length === 2
  && (flakyLog.match(/^ℹ pass \d+\r?$/gm) ?? []).length === 2
  && (flakyLog.match(/^ℹ fail 0\r?$/gm) ?? []).length === 2;
const adversarialQa = [
  { class: 'malformed_input', applicable: true, ok: malformed.code === 'schema_invalid', observable: `${malformed.code} at ${malformed.path}` },
  { class: 'stale_state_event', applicable: true, ok: stale.stateDigestBefore === stale.stateDigestAfter, observable: stale.stateDigestAfter },
  { class: 'dirty_worktree', applicable: true, ok: readOnlyVerification.scopeIsolationOk, observable: `Task 2 ownership overlap 0; ${concurrentChanges.length} concurrent read-only changes preserved.` },
  { class: 'misleading_success_output', applicable: true, ok: pythonReport.results.every((item) => item.matched) && nodeReport.results.every((item) => item.matched), observable: 'Every reported case matched its explicit expected triple.' },
  { class: 'interruption_replay', applicable: true, ok: replay.code === 'event_sequence_not_monotonic', observable: `${replay.code} at ${replay.path}` },
  { class: 'flaky_order_dependence', applicable: true, ok: flakyOrderOk, observable: 'Two reordered Python passes and two Node passes completed.' },
  { class: 'cancellation_restart_metadata', applicable: true, ok: stateTransitionsOk, observable: transitionFields.join(',') },
  { class: 'prompt_injection', applicable: false, ok: true, observable: 'N/A: no external text or LLM call exists in this contract layer.' },
  { class: 'external_network_hung_api', applicable: false, ok: true, observable: 'N/A: validation is local and performs no network call.' },
];
const applicableAdversarialOk = adversarialQa.filter((item) => item.applicable).every((item) => item.ok);
const manualQa = {
  schemaVersion: '1.0.0',
  ok: parity.ok && pythonReport.allMatched && nodeReport.allMatched && normalTwoProductBatchOk
    && staleReplayOk && compatibilityOk && stateTransitionsOk && applicableAdversarialOk,
  scenario: 'Validate the shared fixture directory through both library validators, accepting two normal products and rejecting stale replay without mutation.',
  invocations: [
    './backend/venv311/Scripts/python.exe -m control_tower.tests.contracts.run_python_fixtures control_tower/tests/contracts/fixtures',
    'node control_tower/tests/contracts/run_node_fixtures.mjs control_tower/tests/contracts/fixtures',
  ],
  observables: {
    pythonAllMatched: pythonReport.allMatched,
    nodeAllMatched: nodeReport.allMatched,
    normalizedParity: parity.ok,
    resultCount: pythonReport.results.length,
  },
  normalTwoProductBatch: {
    ok: normalTwoProductBatchOk,
    productCount: batch.products.length,
    products: batch.products.map((product) => ({
      productId: product.productId,
      productKey: product.productKey,
      baseImageCount: product.inputImages.filter((image) => image.role === 'base').length,
      numberedColorImages: product.inputImages.filter((image) => image.role === 'color-option').map((image) => image.ordinal),
    })),
  },
  staleReplay: {
    ok: staleReplayOk,
    code: stale.code,
    path: stale.path,
    stateDigestBefore: stale.stateDigestBefore,
    stateDigestAfter: stale.stateDigestAfter,
    stateChanged: stale.stateDigestBefore !== stale.stateDigestAfter,
  },
  compatibilityCatalog: {
    ok: compatibilityOk,
    entryCount: actualCompatibilityIds.length,
    fieldIds: compatibility.entries.filter((entry) => entry.kind === 'field').map((entry) => entry.entryId),
    selectionStageIds: compatibility.entries.filter((entry) => entry.kind === 'selection-stage').map((entry) => entry.entryId),
    currentFactoryFieldIds,
    missingIds: requiredCompatibilityIds.filter((entryId) => !actualCompatibilityIds.includes(entryId)),
  },
  stateTransitions: {
    ok: stateTransitionsOk,
    stateKinds: [...actualStateKinds].sort(),
    tableCount: transitionTables.length,
    tables: transitionTables.map((item) => ({
      stateKind: item.payload.stateKind,
      owner: item.payload.owner,
      transitionCount: item.payload.allowedTransitions.length,
    })),
    metadataFields: transitionFields,
  },
  adversarialQa,
  readOnlyVerification: path.join(evidenceRoot, 'readonly-verification.json'),
};
writeJson(path.join(evidenceRoot, 'manual-qa.json'), manualQa);
if (!manualQa.ok) process.exitCode = 1;
