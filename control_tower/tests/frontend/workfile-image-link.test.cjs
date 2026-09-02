const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(__dirname, '../../frontend/src/workfile-job-tabs-model.mjs');

const live = {
  workspaceId: 'batch:factory-job-88e6ba8fa26a41b0ae396d2be6cb160a',
  productId: 'cafe24:3011',
  productKey: '방울수저집',
  runId: 'factory_work_run_mss7zm8b_9i1ifd',
  inputFingerprint: '190196:live-task16-input',
  revision: 23,
};

function projection(identity) {
  return {
    schema: 'factory-control-projection:v1',
    connected: true,
    sequence: identity.revision,
    cursor: String(identity.revision),
    session: identity,
    inputs: [],
    stages: [],
    progress: {},
    registration: { jobId: 'factory-job-88e6ba8fa26a41b0ae396d2be6cb160a' },
  };
}

function workfile(identity, sha256) {
  return {
    fileName: '방울수저집.kuasangse',
    sha256,
    identity,
    classification: { product: { name: '방울수저집' }, inputs: {}, outputs: {} },
  };
}

test('Task16 live identity만 연결하고 같은 이름의 다른 job 작업파일은 거부한다', async () => {
  const { createWorkfileJobTabRegistry } = await import(`${pathToFileURL(MODULE).href}?task16=${Date.now()}`);
  const jobs = [{
    jobId: 'factory-job-88e6ba8fa26a41b0ae396d2be6cb160a',
    productName: '방울수저집',
    workfileName: '방울수저집.kuasangse',
    status: 'blocked',
  }];
  const registry = createWorkfileJobTabRegistry();
  registry.syncJobs(jobs, projection(live));

  const wrong = registry.registerWorkfile(workfile({
    ...live,
    workspaceId: 'batch:factory-job-c63197a636584d16b33f6a3c60ebc048',
    productId: '',
    runId: 'factory_work_run_msvled4l_mbtq1l',
    inputFingerprint: '232304:different-task-input',
  }, '6'.repeat(64)));
  assert.equal(wrong.status, 'unlinked');
  assert.equal(registry.workfileFor('job:factory-job-88e6ba8fa26a41b0ae396d2be6cb160a'), null);

  const correct = registry.registerWorkfile(workfile(live, 'a'.repeat(64)));
  assert.equal(correct.status, 'linked');
  assert.equal(registry.workfileFor(correct.tabKey).identity.workspaceId, live.workspaceId);
  assert.equal(registry.workfileFor(correct.tabKey).identity.runId, live.runId);
  assert.equal(registry.workfileFor(correct.tabKey).identity.inputFingerprint, live.inputFingerprint);
});
