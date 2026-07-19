import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_ROOT, '..', '..', '..');
const CONTRACTS_ROOT = path.join(REPOSITORY_ROOT, 'control_tower', 'contracts', 'v1');
const VALIDATOR_PATH = path.join(REPOSITORY_ROOT, 'control_tower', 'frontend', 'src', 'contracts.mjs');

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

function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

const fixturesRoot = process.argv[2] ?? path.join(TEST_ROOT, 'fixtures');
const { validateContract } = await import(pathToFileURL(VALIDATOR_PATH).href);
const catalog = readJson(path.join(CONTRACTS_ROOT, 'version-catalog.json'));
const schemas = Object.fromEntries(
  readdirSync(CONTRACTS_ROOT)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()
    .map((name) => [name, readJson(path.join(CONTRACTS_ROOT, name))]),
);
const cases = readdirSync(fixturesRoot)
  .filter((name) => name.endsWith('.fixture.json'))
  .sort()
  .flatMap((name) => readJson(path.join(fixturesRoot, name)).cases);
const results = cases.map((fixtureCase) => {
  const state = fixtureCase.stateBefore === undefined
    ? undefined
    : structuredClone(fixtureCase.stateBefore);
  const before = state === undefined ? null : canonicalDigest(state);
  const result = validateContract(fixtureCase.payload, {
    catalog,
    schemas,
    context: fixtureCase.context ?? {},
  });
  if (result.ok && state !== undefined) Object.assign(state, structuredClone(fixtureCase.mutationIfAccepted ?? {}));
  const after = state === undefined ? null : canonicalDigest(state);
  const expected = fixtureCase.expected;
  return {
    name: fixtureCase.name,
    ok: result.ok,
    code: result.code,
    path: result.path,
    matched: result.ok === expected.ok && result.code === expected.code && result.path === expected.path,
    stateDigestBefore: before,
    stateDigestAfter: after,
  };
});
const batchCase = cases.find((fixtureCase) => fixtureCase.name === 'valid_two_product_batch');
const stale = results.find((result) => result.name === 'stale_event_fingerprint');
const report = {
  validator: 'node',
  allMatched: results.every((result) => result.matched),
  validProductCount: batchCase.payload.products.length,
  staleReplayRejected: stale.ok === false && stale.stateDigestBefore === stale.stateDigestAfter,
  results,
};
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.allMatched && report.staleReplayRejected ? 0 : 1;
