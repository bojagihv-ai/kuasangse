'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const JOB_ID = 'factory-job-dd6528fd8f124243a0261abc9c70de10';
const SCOPE = `project:batch:${JOB_ID}`;

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function buildPrepare(authorityResponses) {
  const core = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const prepare = sourceSlice(
    core,
    'async function factoryRuntimeControlPrepareProduct(',
    'async function factoryRuntimeControlRestoreRequiredValues(',
  );
  const authorityCalls = [];
  const cafe24CategoryCalls = [];
  const delays = [];
  const updates = [];
  const context = vm.createContext({
    state: { currentProjectId: '', currentProjectName: '', currentProjectCreatedAt: 0 },
    Date,
    setTimeout: (callback, delay) => { delays.push(delay); callback(); return 0; },
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeReadFactory: () => ({ goalRun: { jobId: JOB_ID } }),
    factoryRuntimeControlCheckpointProjectId: jobId => `batch:${jobId}`,
    getCurrentDocumentWorkspaceScope: projectId => `project:${projectId}`,
    ensureWorkspaceEditAuthority: async (scopeId, options) => {
      authorityCalls.push({
        scopeId,
        options: {
          force: options?.force === true,
          confirmedTakeover: options?.confirmedTakeover === true,
        },
      });
      return authorityResponses[Math.min(authorityCalls.length - 1, authorityResponses.length - 1)];
    },
    factoryRuntimeControlExecutionMode: () => 'manual',
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeControlRestoreInputPayloads: () => {},
    factoryRuntimeControlApplyProvidedColorOptions: () => {},
    factoryRuntimeControlApplyCafe24Category: async payload => {
      cafe24CategoryCalls.push(payload);
    },
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, mutate) => {
      updates.push(true);
      return mutate({});
    },
  });
  vm.runInContext(`${prepare}\nthis.prepare = factoryRuntimeControlPrepareProduct;`, context);
  return { authorityCalls, cafe24CategoryCalls, context, delays, updates };
}

function resumePayload(cafe24Registration) {
  return {
    jobId: JOB_ID,
    productName: 'authority retry fixture',
    source: { kind: 'workfile' },
    startFresh: false,
    ...(cafe24Registration ? { cafe24Registration } : {}),
  };
}

test('prepareProduct retries a transient null, readonly, or wrong-scope authority before writing', async (t) => {
  for (const transientAuthority of [
    null,
    { mode: 'readonly', scopeId: SCOPE },
    { mode: 'editing', scopeId: 'project:batch:other-job' },
  ]) {
    await t.test(`recovers from ${transientAuthority?.mode || 'null'}`, async () => {
      const { authorityCalls, context, delays, updates } = buildPrepare([
        transientAuthority,
        { mode: 'editing', scopeId: SCOPE },
      ]);

      await context.prepare(resumePayload());

      assert.deepEqual(authorityCalls, [
        { scopeId: SCOPE, options: { force: true, confirmedTakeover: true } },
        { scopeId: SCOPE, options: { force: true, confirmedTakeover: true } },
      ]);
      assert.deepEqual(delays, [400]);
      assert.equal(updates.length, 1);
    });
  }
});

test('prepareProduct keeps a healthy editing authority to one request', async () => {
  const { authorityCalls, context, delays, updates } = buildPrepare([
    { mode: 'editing', scopeId: SCOPE },
  ]);

  await context.prepare(resumePayload());

  assert.deepEqual(authorityCalls, [
    { scopeId: SCOPE, options: { force: true, confirmedTakeover: true } },
  ]);
  assert.deepEqual(delays, []);
  assert.equal(updates.length, 1);
});

test('prepareProduct applies a saved Cafe24 category before resuming', async () => {
  const { cafe24CategoryCalls, context } = buildPrepare([
    { mode: 'editing', scopeId: SCOPE },
  ]);

  await context.prepare(resumePayload({ categoryId: '84' }));

  assert.equal(cafe24CategoryCalls.length, 1);
  assert.equal(cafe24CategoryCalls[0].cafe24.categoryId, '84');
});

test('prepareProduct rejects after bounded authority retries without writing', async () => {
  const { authorityCalls, context, updates } = buildPrepare([
    { mode: 'readonly', scopeId: SCOPE },
  ]);

  await assert.rejects(
    () => context.prepare(resumePayload()),
    error => error.code === 'factory_product_workspace_authority_unavailable',
  );

  assert.equal(authorityCalls.length, 3);
  assert.equal(updates.length, 0);
});
