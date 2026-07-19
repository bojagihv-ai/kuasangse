import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_ROOT, '..', '..', '..');
const NODE_VALIDATOR = path.join(REPOSITORY_ROOT, 'control_tower', 'frontend', 'src', 'contracts.mjs');
const PYTHON_VALIDATOR = path.join(REPOSITORY_ROOT, 'control_tower', 'backend', 'contracts.py');
const FIXTURES = path.join(TEST_ROOT, 'fixtures');
const RUNNER = path.join(TEST_ROOT, 'run_node_fixtures.mjs');
const BUILD_EVIDENCE = path.join(TEST_ROOT, 'build_evidence.mjs');
const CONTRACTS_FIXTURE = path.join(FIXTURES, 'contracts.fixture.json');
const COMPATIBILITY_FIXTURE = path.join(FIXTURES, 'compatibility.fixture.json');
const GATE_FIXTURE = path.join(FIXTURES, 'gate-fixes.fixture.json');
const CATALOG = path.join(REPOSITORY_ROOT, 'control_tower', 'contracts', 'v1', 'version-catalog.json');
const FACTORY_SOURCE = path.join(REPOSITORY_ROOT, 'src', 'app-core-03.js');
const REQUIRED_ERROR_CODES = new Set([
  'capability_version_unsupported',
  'contract_version_unsupported',
  'decision_rule_missing',
  'event_sequence_not_monotonic',
  'field_status_invalid',
  'fingerprint_mismatch',
  'identifier_mismatch',
  'identifier_missing',
  'schema_invalid',
  'secret_key_forbidden',
]);

function runFixtureCli() {
  const completed = spawnSync(process.execPath, [RUNNER, FIXTURES], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(completed.status, 0, `${completed.stdout}${completed.stderr}`);
  return JSON.parse(completed.stdout);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('browser ESM validator matches every shared fixture', () => {
  // Given: both validator implementations are present at their public library paths.
  assert.ok(existsSync(NODE_VALIDATOR), `implementation missing: ${NODE_VALIDATOR}`);
  assert.ok(existsSync(PYTHON_VALIDATOR), `implementation missing: ${PYTHON_VALIDATOR}`);

  // When: a user runs the Node fixture CLI backed by the browser-compatible ESM module.
  const report = runFixtureCli();

  // Then: every expected triple matches and all required stable codes were exercised.
  assert.equal(report.allMatched, true);
  assert.equal(report.validProductCount, 2);
  assert.equal(report.staleReplayRejected, true);
  const actualCodes = new Set(report.results.map((result) => result.code));
  for (const code of REQUIRED_ERROR_CODES) assert.ok(actualCodes.has(code), code);
});

test('stale event replay leaves the canonical state digest unchanged', () => {
  // Given: the fixture contains an event from a stale input-image fingerprint.
  assert.ok(existsSync(NODE_VALIDATOR), `implementation missing: ${NODE_VALIDATOR}`);

  // When: the event is validated before its proposed state mutation is applied.
  const report = runFixtureCli();
  const stale = report.results.find((result) => result.name === 'stale_event_fingerprint');

  // Then: rejection is explicit and no state byte changes.
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'fingerprint_mismatch');
  assert.equal(stale.stateDigestBefore, stale.stateDigestAfter);
});

test('catalog and fixtures cover current capabilities, fields, boundaries, and five transition tables', () => {
  // Given: the independent gate fixtures and protected current factory field source.
  const cases = [...readJson(CONTRACTS_FIXTURE).cases, ...readJson(GATE_FIXTURE).cases];
  const casesByName = new Map(cases.map((fixtureCase) => [fixtureCase.name, fixtureCase]));
  const compatibility = readJson(COMPATIBILITY_FIXTURE).cases[0].payload;
  const source = readFileSync(FACTORY_SOURCE, 'utf8');
  const factorySection = source.split('const FACTORY_SINHWA_FIELD_SECTIONS = [')[1]
    .split('const FACTORY_STAGE_STATUS_LABELS')[0];

  // When: catalog membership, field IDs, boundary oracles, and real tables are collected.
  const currentFieldIds = new Set([...factorySection.matchAll(/\bid: '([^']+)'/g)].map((match) => match[1]));
  const registeredFieldIds = new Set(compatibility.entries.filter((entry) => entry.kind === 'field').map((entry) => entry.entryId));
  const tables = cases.filter((fixtureCase) => fixtureCase.payload.contractType === 'state-transition-table').map((fixtureCase) => fixtureCase.payload);
  const boundary256 = casesByName.get('identifier_exactly_256_characters');
  const boundary257 = casesByName.get('identifier_257_characters');

  // Then: every gate requirement has a machine-consumed canonical definition.
  assert.deepEqual(readJson(CATALOG).capabilityCatalog, { '1.0.0': ['image-generate'] });
  assert.deepEqual(casesByName.get('unknown_operation_capability').expected, { ok: false, code: 'capability_version_unsupported', path: '$.operation.capability' });
  assert.deepEqual(casesByName.get('unknown_contract_type').expected, { ok: false, code: 'schema_invalid', path: '$.contractType' });
  assert.equal(boundary256.payload.fieldId.length, 256);
  assert.deepEqual(boundary256.expected, { ok: true, code: 'ok', path: '$' });
  assert.equal(boundary257.payload.fieldId.length, 257);
  assert.deepEqual(boundary257.expected, { ok: false, code: 'schema_invalid', path: '$.fieldId' });
  assert.deepEqual(new Set(tables.map((table) => table.stateKind)), new Set(['batch', 'product', 'stage', 'review', 'registration']));
  for (const table of tables) {
    assert.ok(table.owner);
    assert.ok(table.allowedTransitions.length > 0);
    for (const transition of table.allowedTransitions) {
      assert.deepEqual(new Set(Object.keys(transition)), new Set(['from', 'to', 'owner', 'occurredAt', 'reason', 'attempt', 'cancellation', 'casPrerequisite', 'terminal', 'restartBehavior']));
    }
  }
  for (const fieldId of currentFieldIds) assert.ok(registeredFieldIds.has(fieldId), fieldId);
  for (const fieldId of ['category', 'purchase_price', 'option_count']) assert.ok(registeredFieldIds.has(fieldId), fieldId);
});

test('manual QA overall fails when an applicable adversarial check fails', () => {
  // Given: otherwise-green reports with only one completed Node repeat in the flaky log.
  const temporaryEvidence = mkdtempSync(path.join(tmpdir(), 'task-2-evidence-'));
  const results = [
    { name: 'stale_event_fingerprint', ok: false, code: 'fingerprint_mismatch', path: '$.inputImageFingerprint', matched: true, stateDigestBefore: 'same', stateDigestAfter: 'same' },
    { name: 'malformed_input', ok: false, code: 'schema_invalid', path: '$', matched: true, stateDigestBefore: null, stateDigestAfter: null },
    { name: 'non_monotonic_event_sequence', ok: false, code: 'event_sequence_not_monotonic', path: '$.eventSequence', matched: true, stateDigestBefore: null, stateDigestAfter: null },
  ];
  const report = { validator: 'python', allMatched: true, validProductCount: 2, staleReplayRejected: true, results };
  try {
    writeFileSync(path.join(temporaryEvidence, 'baseline.log'), 'synthetic baseline\n');
    writeFileSync(path.join(temporaryEvidence, 'python-fixtures.json'), `${JSON.stringify(report)}\n`);
    writeFileSync(path.join(temporaryEvidence, 'node-fixtures.json'), `${JSON.stringify({ ...report, validator: 'node' })}\n`);
    writeFileSync(path.join(temporaryEvidence, 'flaky-check.log'), '48 passed\n48 passed\nℹ pass 2\n');

    // When: the evidence builder aggregates all applicable adversarial checks.
    const completed = spawnSync(process.execPath, [BUILD_EVIDENCE, REPOSITORY_ROOT, temporaryEvidence], { encoding: 'utf8' });
    const manualQa = readJson(path.join(temporaryEvidence, 'manual-qa.json'));

    // Then: the false applicable check makes both the artifact and process fail.
    assert.notEqual(completed.status, 0);
    assert.equal(manualQa.adversarialQa.find((item) => item.class === 'flaky_order_dependence').ok, false);
    assert.equal(manualQa.ok, false);
  } finally {
    rmSync(temporaryEvidence, { recursive: true, force: true });
  }
});
