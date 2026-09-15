const vm = require('node:vm');
const assert = require('node:assert/strict');
const { driver, fn } = require('./native_factory_command_fixture.cjs');
const { mountConsole } = require('./native_console_dom_fixture.cjs');

async function manualResumeFixture(options = {}) {
  const h = await driver({ originalActions: true, ...options });
  const { createDbFactoryTab } = await import('../../src/menus/factory/tabs/db-tab.mjs');
  const { assertNativeFactoryJobOpen } = await import('../../src/modules/native-factory-command-routing.mjs');
  const read = () => h.readLocal().store.getSnapshot().factory;
  const job = h.server.manualJob ||= { jobId: 'a', productName: '상품', status: 'waiting_manual', stageKey: 'db', attempts: 1 };
  const resumePosts = [], stateReads = [];
  const core = h.context;
  if (!options.bootEmpty) h.change({ automation: { activeTab: 'db' } });
  core.factoryRuntimeControlTabWorkflow = () => ({ status: job.status, stageKey: job.stageKey });
  const actions = {
    confirmNoDbCandidate: (_value, context) => core.factoryRuntimeBridgeAction('factory/db:confirmNoDbCandidate', context, draft => { draft.product.dbCandidateResolution = 'none'; return true; }),
    confirmNoCafe24Candidate: (_value, context) => core.factoryRuntimeBridgeAction('factory/db:confirmNoCafe24Candidate', context, draft => { draft.product.cafe24CandidateResolution = 'none'; return true; }),
    runDb: () => { h.calls.push('new-run'); h.change({ product: { ...read().product, currentRunId: 'wrong-new-run' } }); },
    goToFields: () => { h.calls.push('navigate-fields'); return true; },
    dispatchFactoryCommand: request => h.routing.dispatch(request),
  };
  h.tabs.db = createDbFactoryTab({ actions, renderHelpers: {}, getSnapshot: () => h.readLocal().store.getSnapshot(),
    assertMutable: () => h.readLocal().store.assertMutable('product-db'), getOperationToken: () => h.readLocal().token,
    isOperationCurrent: token => h.readLocal().store.isOperationCurrent(token), reportError() {} });
  core.factoryRuntimeDbTab = h.tabs.db;
  Object.assign(core, {
    factoryRuntimeControlPrepareProduct: async () => {},
    factoryCandidateReviewIdentityKey: () => 'proof',
    factoryRuntimeControlDbReferenceCandidates: () => [{ id: 'candidate', index: 0 }],
    factoryRuntimeControlCompetitorSnapshot: () => ({ candidates: [{ id: 'competitor-a', platform: 'coupang' }], selectedIds: [], detailImages: [], analysis: null }),
    compMarketNormalizeSite: value => value, compMarketResultId: value => value.id,
    factoryRuntimeControlProvidedFieldEntries: () => [],
    factoryAutomationReviewSummary: () => ({ fields: [{ id: 'material', label: '소재', required: true, value: read().product.finalDb.material }] }),
    factoryFieldReviewMatchesCurrentWork: () => true,
    factoryManualFieldSettingMatchesCurrentWork: () => true,
    factoryRunGoalLoop: async () => { throw new Error('completed image work must not regenerate during manual-reference resume'); },
  });
  const commit = core.factoryCommitAutomationWizardFieldValue;
  core.factoryCommitAutomationWizardFieldValue = (id, value, label, render, draft) => {
    commit(id, value, label, render, draft);
    draft.automation ||= {}; draft.automation.fieldReview ||= {};
    draft.automation.fieldReview[id] = { value };
  };
  for (const name of ['factoryRuntimeControlDecisionMode', 'factoryRuntimeControlEnsureDbReferencePolicy',
    'factoryRuntimeControlEnsureRequiredPolicy', 'factoryRuntimeControlEnsureCompetitorPolicy',
    'factoryRuntimeControlEnsureAutoReferences', 'factoryRuntimeControlRunProduct']) vm.runInContext(fn(name), core);
  const originalApi = h.io.apiRequest;
  const publicJob = () => ({ ...job, checkpointAvailable: true, checkpointRevision: h.server.savedRevision,
    checkpointRunId: h.server.savedSnapshot.factory.product.currentRunId, ...options.jobPatch });
  h.io.apiRequest = async (url, init = {}) => {
    if (url === '/api/factory/jobs') {
      await options.jobsGate?.promise;
      return { jobs: [publicJob(), ...(options.otherJobs || [])] };
    }
    if (url === '/api/factory/jobs/a/resume') {
      const payload = JSON.parse(init.body); resumePosts.push(payload); h.calls.push('resume');
      assert.equal(payload.restoreOnly, undefined);
      assert.equal(payload.expectedCheckpointRevision, publicJob().checkpointRevision);
      assert.equal(payload.expectedCheckpointRunId, h.server.savedSnapshot.factory.product.currentRunId);
      await assertNativeFactoryJobOpen('a');
      job.attempts += 1;
      const result = await core.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'a',
        productName: '상품', mode: 'auto', expectedStageKey: job.stageKey,
        decisionModes: { sinhwa_db_product: 'manual', cafe24_product: 'manual', required_field_candidate: 'manual', competitor_product: 'manual' } });
      Object.assign(job, { status: result.status, stageKey: result.stageKey, message: result.message });
      h.server.manualProjection = structuredClone(result.projection);
      await options.afterResume?.();
      if (options.lostResume) throw new Error('resume-response-lost');
      if (options.unknownResume) return undefined;
      return { accepted: true, job: publicJob() };
    }
    return originalApi(url, init);
  };
  const originalProjection = h.io.readProjection;
  h.io.readProjection = async () => {
    const projection = options.bootEmpty && !h.readLocal().jobId && h.server.manualProjection
      ? structuredClone(h.server.manualProjection) : await originalProjection();
    stateReads.push(projection);
    if (options.projectionPatch) return options.projectionPatch(projection);
    return projection;
  };
  const ui = await mountConsole(h);
  return { ...h, h, ui, job, resumePosts, stateReads, publicJob, options };
}
module.exports = { manualResumeFixture };
