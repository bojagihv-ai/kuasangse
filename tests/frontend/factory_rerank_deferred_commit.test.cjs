'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function createRuntimeHarness() {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const runtime = sourceSlice(
    source,
    'var factoryRuntimeOwnedRenderDraft = null;',
    'function factoryRuntimeWorkspaceId(',
  );
  const leaseRuntime = sourceSlice(
    source,
    'function factoryRuntimeWithOperationLease(',
    'function factoryRuntimeFollowupCommandReceipt(',
  );
  const timers = new Map();
  const commits = [];
  const commitRevisions = [];
  const acquireCalls = [];
  const identity = { version: 'factory-store:v1' };
  let workspaceId = 'project:test';
  let fence = 1;
  let nextTimerId = 0;
  let activeLease = false;
  let revision = 0;

  const store = {
    getSnapshot: () => ({ factory: { product: {} } }),
    getOperationToken: () => Object.freeze({ ...identity, workspaceId, fence, revision }),
    isOperationCurrent: token => token?.version === identity.version
      && token?.workspaceId === workspaceId
      && token?.fence === fence,
    switchWorkspace(nextWorkspaceId) {
      workspaceId = nextWorkspaceId;
      fence += 1;
      activeLease = false;
    },
    hasActiveOperationLease: () => activeLease,
    acquireOperationLease(operationKey, token) {
      acquireCalls.push({ operationKey, revision: token.revision });
      if (activeLease) return { acquired: false, signal: null, release: () => false };
      activeLease = true;
      return {
        acquired: true,
        signal: null,
        release() {
          activeLease = false;
          return true;
        },
      };
    },
    updateDraft(mutator, _metadata, commandName) {
      const startingRevision = revision;
      const startingToken = this.getOperationToken();
      const draft = { product: {} };
      const result = mutator(draft);
      const commit = value => {
        if (!this.isOperationCurrent(startingToken)) {
          throw new Error(`STALE_FACTORY_STORE_OPERATION: ${commandName}`);
        }
        if (startingRevision !== revision) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${startingRevision}, current ${revision}`);
        }
        revision += 1;
        commitRevisions.push(startingRevision);
        commits.push(commandName);
        return { snapshot: { factory: draft }, result: value, assignments: [] };
      };
      return result && typeof result.then === 'function'
        ? Promise.resolve(result).then(commit)
        : commit(result);
    },
  };

  const context = vm.createContext({
    factoryRuntimeStore: store,
    factoryRuntimeRequireStore: () => store,
    factoryRuntimeBootstrapFactory: {},
    state: { factory: {} },
    render() {},
    factoryRuntimeStaleActionError(actionName) {
      return Object.assign(new Error(`STALE_FACTORY_RUNTIME_ACTION: ${actionName}`), {
        code: 'STALE_FACTORY_RUNTIME_ACTION',
      });
    },
    setTimeout(callback) {
      const timerId = ++nextTimerId;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
  });
  vm.runInContext(
    `${runtime}\n${leaseRuntime}\nthis.run = factoryRuntimeUpdateOwnedFactory;\nthis.runLease = factoryRuntimeWithOperationLease;`,
    context,
  );
  return {
    context,
    timers,
    commits,
    commitRevisions,
    acquireCalls,
    store,
    getRevision: () => revision,
    flushTimers() {
      while (timers.size) {
        const [timerId, callback] = timers.entries().next().value;
        timers.delete(timerId);
        callback();
      }
    },
    getPendingTimerCount: () => timers.size,
  };
}

function createCafe24RerankRaceHarness() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
  const start = source.indexOf('function factoryStartCafe24CandidateRerank(');
  const end = source.indexOf('\nfunction factoryUpdateCandidateReviewStageStatus', start);
  assert.notEqual(start, -1, 'missing Cafe24 rerank source marker');
  assert.notEqual(end, -1, 'missing Cafe24 rerank source end marker');
  const timers = [];
  const commits = [];
  const commitRevisions = [];
  const identity = Object.freeze({ version: 'factory-store:v1' });
  let workspaceId = 'project:test';
  let fence = 1;
  const candidate = { product_no: 'c1', product_name: '초기 후보', score: 1 };
  let snapshot = {
    product: {
      naturalHint: '자연어 힌트',
      pendingCafe24Candidates: [candidate],
      cafe24RerankRunning: false,
      cafe24RerankKey: '',
      selectedCafe24CandidateKey: '',
    },
  };
  let revision = 0;
  let resolveFetch;
  let resolveRank;
  let rejectRank;
  const rankGate = new Promise((resolve, reject) => {
    resolveRank = resolve;
    rejectRank = reject;
  });
  let fetchReject;
  const controlledFetchGate = new Promise((resolve, reject) => {
    resolveFetch = resolve;
    fetchReject = reject;
  });
  let lastTransaction = null;
  let mutatorWasPromise = null;
  let externalWorkCalls = 0;
  let ownedMutationCalls = 0;
  const logs = [];
  const context = vm.createContext({
    console,
    getAnalysisMatchSettings: () => ({ cafe24RankEngine: 'remote' }),
    normalizeAnalysisAiEngine: value => value,
    getAnalysisEngineRunInfo: () => ({ providerLabel: 'LLM' }),
    factoryCafe24RerankKey: () => 'rerank-key',
    factoryRuntimeReadFactory: () => snapshot,
    factoryRuntimeIsOperationCurrent: token => token?.version === identity.version
      && token?.workspaceId === workspaceId
      && token?.fence === fence,
    factoryCafe24CaptureOperationToken: () => Object.freeze({ ...identity, workspaceId, fence, revision }),
    getCafe24CandidateImageAttachLimit: () => 1,
    selectCafe24CandidatesForImagePayloads: values => values,
    fetchCafe24CandidateImagePayloads: () => {
      externalWorkCalls += 1;
      return controlledFetchGate;
    },
    rerankCafe24CandidatesWithGpt: () => {
      externalWorkCalls += 1;
      return rankGate;
    },
    factorySlimReviewCandidateList: values => values,
    factoryDedupeCafe24Candidates: values => values,
    factoryCandidateScore: value => value.score || 0,
    factoryUpdateCandidateReviewStageStatus() {},
    factoryLog(message) { logs.push(message); },
    factoryCafe24RunOwnedDraftMutation(commandName, options, mutator) {
      ownedMutationCalls += 1;
      if (options.operationToken && !(
        options.operationToken.version === identity.version
        && options.operationToken.workspaceId === workspaceId
        && options.operationToken.fence === fence
      )) return false;
      const startingRevision = revision;
      const draft = {
        ...snapshot,
        product: { ...snapshot.product, pendingCafe24Candidates: [...(snapshot.product.pendingCafe24Candidates || [])] },
      };
      const result = mutator(draft);
      mutatorWasPromise = !!(result && typeof result.then === 'function');
      const commit = value => {
        if (startingRevision !== revision) {
          throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${startingRevision}, current ${revision}`);
        }
        snapshot = draft;
        revision += 1;
        commits.push(commandName);
        commitRevisions.push(startingRevision);
        return { snapshot, result: value, assignments: [] };
      };
      const transaction = mutatorWasPromise ? Promise.resolve(result).then(commit) : commit(result);
      lastTransaction = Promise.resolve(transaction);
      return transaction;
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.start = factoryStartCafe24CandidateRerank;`, context);
  return {
    snapshot: () => snapshot,
    commits,
    commitRevisions,
    logs,
    getExternalWorkCalls: () => externalWorkCalls,
    getOwnedMutationCalls: () => ownedMutationCalls,
    getMutatorWasPromise: () => mutatorWasPromise,
    start: () => context.start(['검색어'], [candidate], { factory: snapshot }),
    flushTimer() {
      assert.equal(timers.length, 1, 'rerank should schedule one delayed worker');
      timers.shift()();
    },
    switchWorkspace(nextWorkspaceId) {
      workspaceId = nextWorkspaceId;
      fence += 1;
      snapshot = {
        ...snapshot,
        product: { ...snapshot.product, workspaceId: nextWorkspaceId },
      };
      return JSON.parse(JSON.stringify(snapshot));
    },
    normalWrite() {
      snapshot = {
        ...snapshot,
        product: { ...snapshot.product, externalWrite: true },
      };
      commits.push('factory/normal-write');
      commitRevisions.push(revision);
      revision += 1;
    },
    resolveFetch,
    rejectFetch: error => fetchReject(error),
    resolveRank,
    rejectRank,
    async waitForMutation() {
      for (let i = 0; i < 20 && !lastTransaction; i += 1) await Promise.resolve();
      return lastTransaction;
    },
  };
}

test('active one-click lease defers Cafe24 rerank until release instead of invalidating the outer CAS', async () => {
  const harness = createRuntimeHarness();
  let deferredRerank;
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      deferredRerank = harness.context.run(
        'factory/cafe24:rerank-candidates',
        'cafe24',
        current => {
          current.product.reranked = true;
          return true;
        },
      );
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);

  harness.flushTimers();
  await deferredRerank;

  assert.deepEqual(harness.commits, ['factory/one-click', 'factory/cafe24:rerank-candidates']);
  assert.equal(harness.commits.filter(command => command === 'factory/cafe24:rerank-candidates').length, 1);
});

test('active factory lease defers option-sorter send until release instead of losing the click commit', async () => {
  const harness = createRuntimeHarness();
  let deferredSend;
  let commitsWhileLeaseActive;
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      deferredSend = harness.context.run(
        'factory/optionsorter:sendResultsToFactory',
        'factory-assets',
        current => {
          current.product.optionSorterSent = true;
          return { ok: true, sentCount: 3 };
        },
      );
      commitsWhileLeaseActive = [...harness.commits];
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);
  assert.deepEqual(commitsWhileLeaseActive, []);

  harness.flushTimers();
  const receipt = await deferredSend;

  assert.deepEqual(receipt.result, { ok: true, sentCount: 3 });
  assert.deepEqual(harness.commits, [
    'factory/one-click',
    'factory/optionsorter:sendResultsToFactory',
  ]);
  assert.deepEqual(harness.commitRevisions, [0, 1]);
});

test('multiple deferred Cafe24 reranks drain FIFO so each commit reads the latest revision', async () => {
  const harness = createRuntimeHarness();
  const deferredReranks = [];
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      for (const marker of ['first', 'second']) {
        deferredReranks.push(harness.context.run(
          'factory/cafe24:rerank-candidates',
          'cafe24',
          async current => {
            current.product.reranked = marker;
            return marker;
          },
        ));
      }
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);
  harness.flushTimers();
  const results = await Promise.all(deferredReranks);

  assert.deepEqual(results.map(receipt => receipt.result), ['first', 'second']);
  assert.deepEqual(harness.commits, [
    'factory/one-click',
    'factory/cafe24:rerank-candidates',
    'factory/cafe24:rerank-candidates',
  ]);
  assert.equal(harness.getRevision(), 3, 'outer commit plus two FIFO rerank commits must advance revision twice after release');
});

test('reranks arriving during an async drain stay queued and commit FIFO at the latest revision', async () => {
  const harness = createRuntimeHarness();
  let releaseFirstRerank;
  const firstRerankReady = new Promise(resolve => { releaseFirstRerank = resolve; });
  const deferredReranks = [];
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      deferredReranks.push(harness.context.run(
        'factory/cafe24:rerank-candidates',
        'cafe24',
        async current => {
          await firstRerankReady;
          current.product.reranked = 'first';
          return 'first';
        },
      ));
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);
  harness.flushTimers();
  deferredReranks.push(harness.context.run(
    'factory/cafe24:rerank-candidates',
    'cafe24',
    current => {
      current.product.reranked = 'second';
      return 'second';
    },
  ));
  assert.deepEqual(harness.commits, ['factory/one-click']);

  releaseFirstRerank();
  const results = await Promise.all(deferredReranks);

  assert.deepEqual(results.map(receipt => receipt.result), ['first', 'second']);
  assert.deepEqual(harness.commits, [
    'factory/one-click',
    'factory/cafe24:rerank-candidates',
    'factory/cafe24:rerank-candidates',
  ]);
  assert.deepEqual(harness.commitRevisions, [0, 1, 2]);
  assert.equal(harness.getPendingTimerCount(), 0, 'deferred retry timers settle after the FIFO drain');
});

test('a new factory lease waits for a paused rerank drain and acquires at the latest revision', async () => {
  const harness = createRuntimeHarness();
  let releaseRerank;
  const rerankReady = new Promise(resolve => { releaseRerank = resolve; });
  let deferredRerank;
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      deferredRerank = harness.context.run(
        'factory/cafe24:rerank-candidates',
        'cafe24',
        async current => {
          await rerankReady;
          current.product.reranked = 'first';
          return 'first';
        },
      );
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);
  harness.flushTimers();
  const waitingLease = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    operation => harness.store.updateDraft(draft => {
      draft.product.followup = true;
      return 'followup';
    }, { owner: 'factory', expectedRevision: operation.operationToken.revision }, 'factory/one-click'),
  );

  assert.equal(typeof waitingLease?.then, 'function', 'new lease must wait while a deferred drain is active');
  assert.equal(harness.acquireCalls.length, 1, 'waiting lease must not acquire before the drain finishes');
  assert.deepEqual(harness.commits, ['factory/one-click']);

  releaseRerank();
  const [rerankReceipt, followupReceipt] = await Promise.all([deferredRerank, waitingLease]);

  assert.equal(rerankReceipt.result, 'first');
  assert.equal(followupReceipt.result, 'followup');
  assert.deepEqual(harness.acquireCalls.map(call => call.revision), [0, 2]);
  assert.deepEqual(harness.commits, [
    'factory/one-click',
    'factory/cafe24:rerank-candidates',
    'factory/one-click',
  ]);
  assert.deepEqual(harness.commitRevisions, [0, 1, 2]);
  assert.equal(harness.getRevision(), 3);
  assert.equal(harness.getPendingTimerCount(), 0, 'waiting lease completion must leave no deferred retry timer');
});

test('a contextless lease captures its request token and rejects after a paused-drain workspace switch', async () => {
  const harness = createRuntimeHarness();
  let releaseRerank;
  const rerankReady = new Promise(resolve => { releaseRerank = resolve; });
  let deferredRerank;
  const outerResult = harness.context.runLease(
    'factory/runDb',
    { operationToken: harness.store.getOperationToken() },
    () => harness.store.updateDraft(draft => {
      draft.product.outer = true;
      deferredRerank = harness.context.run(
        'factory/cafe24:rerank-candidates',
        'cafe24',
        async current => {
          await rerankReady;
          current.product.reranked = 'first';
          return 'first';
        },
      );
      return true;
    }, { owner: 'factory', expectedRevision: 0 }, 'factory/one-click'),
  );

  assert.equal(outerResult.result, true);
  harness.flushTimers();
  const waitingLease = harness.context.runLease(
    'factory/runDb',
    undefined,
    operation => harness.store.updateDraft(draft => {
      draft.product.followup = true;
      return 'followup';
    }, { owner: 'factory', expectedRevision: operation.operationToken.revision }, 'factory/one-click'),
  );

  assert.equal(typeof waitingLease?.then, 'function', 'contextless request must wait for the paused drain');
  assert.equal(harness.acquireCalls.length, 1, 'contextless request must not acquire during the drain');
  harness.store.switchWorkspace('project:switched');
  releaseRerank();
  const [rerankOutcome, leaseOutcome] = await Promise.allSettled([deferredRerank, waitingLease]);

  assert.equal(rerankOutcome.status, 'fulfilled');
  assert.equal(rerankOutcome.value, false, 'the queued rerank must fail closed after the workspace switch');
  assert.equal(leaseOutcome.status, 'rejected');
  assert.match(leaseOutcome.reason?.message || '', /STALE_FACTORY_RUNTIME_ACTION|STALE/);
  assert.deepEqual(harness.commits, ['factory/one-click'], 'stale contextless lease must create zero new commits');
  assert.deepEqual(harness.commitRevisions, [0]);
  assert.equal(harness.acquireCalls.length, 1, 'stale contextless lease must never acquire in the switched workspace');
  assert.equal(harness.getPendingTimerCount(), 0, 'stale rejection must settle all retry timers');
});

test('Cafe24 rerank performs external awaits before a synchronous latest-revision draft commit', async () => {
  const cafe24Source = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
  const rerankStart = cafe24Source.indexOf('function factoryStartCafe24CandidateRerank(');
  const rerankEnd = cafe24Source.indexOf('\nfunction factoryUpdateCandidateReviewStageStatus', rerankStart);
  assert.doesNotMatch(
    cafe24Source.slice(rerankStart, rerankEnd),
    /factoryCafe24RunOwnedDraftMutation\([\s\S]*async\s+current\s*=>/,
    'Cafe24 rerank owned draft mutators must not await external work',
  );
  const harness = createCafe24RerankRaceHarness();
  harness.start();
  harness.flushTimer();
  harness.normalWrite();
  harness.resolveFetch({ payloads: [] });
  await Promise.resolve();
  const rankedCandidate = { product_no: 'c2', product_name: '재정렬 후보', score: 9 };
  harness.resolveRank({ candidates: [rankedCandidate], engineLabel: 'LLM' });
  const transaction = await harness.waitForMutation();

  assert.ok(transaction, 'rerank should reach the owned draft commit after external work');
  assert.equal(harness.getMutatorWasPromise(), false, 'owned rerank mutator must be synchronous');
  assert.deepEqual(harness.commits, ['factory/normal-write', 'factory/cafe24:rerank-candidates']);
  assert.deepEqual(harness.commitRevisions, [0, 1], 'rerank must commit against the latest revision after the external write');
  assert.equal(harness.snapshot().product.externalWrite, true);
  assert.equal(harness.snapshot().product.cafe24RerankRunning, false);
  assert.deepEqual(harness.snapshot().product.pendingCafe24Candidates, [rankedCandidate]);
});

test('Cafe24 rerank failure commits synchronous error state after a prior normal write', async () => {
  const harness = createCafe24RerankRaceHarness();
  harness.start();
  harness.flushTimer();
  harness.normalWrite();
  harness.rejectFetch(new Error('image payload failed'));
  const transaction = await harness.waitForMutation();

  assert.ok(transaction, 'failed external rerank should reach the owned draft commit');
  assert.equal(harness.getMutatorWasPromise(), false, 'failure mutator must be synchronous');
  assert.deepEqual(harness.commits, ['factory/normal-write', 'factory/cafe24:rerank-candidates']);
  assert.deepEqual(harness.commitRevisions, [0, 1], 'failure status must commit at the latest revision');
  assert.equal(harness.snapshot().product.externalWrite, true);
  assert.equal(harness.snapshot().product.cafe24RerankRunning, false);
  assert.match(harness.snapshot().product.cafe24ApiStatus, /이미지\/LLM 재점수만 실패했습니다: image payload failed/);
  assert.ok(harness.logs.some(message => message.includes('image payload failed')));
});

test('same-key rerank scheduled in workspace A does not fetch or commit after switching to workspace B', () => {
  const harness = createCafe24RerankRaceHarness();
  harness.start();
  const workspaceB = harness.switchWorkspace('project:b');
  harness.flushTimer();

  assert.equal(harness.getExternalWorkCalls(), 0, 'stale timer must not start image/GPT work');
  assert.equal(harness.getOwnedMutationCalls(), 0, 'stale timer must not invoke an owned mutation');
  assert.deepEqual(harness.commits, []);
  assert.deepEqual(harness.snapshot(), workspaceB, 'workspace B state must remain unchanged');
});
