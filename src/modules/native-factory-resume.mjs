import { sameCommandIdentity as same, sameCommandData } from './native-command-journal.mjs';

const fail = (code, diagnostic) => {
  if (diagnostic) console.warn('[생산관제 재개] 상태 검사 중단', JSON.stringify(diagnostic));
  throw new Error(code);
};
const active = (job, currentJobId = job.jobId) => job.dispatched || ['queued', 'running'].includes(job.status)
  || job.pendingSelection || (job.autoResumePending && (job.jobId === currentJobId
    || !['waiting_manual', 'blocked', 'completed'].includes(job.status)));

export function createNativeFactoryResume(io) {
  let hold = io.journal.resume;
  let flight = null;
  const setHold = value => { io.journal.writeResume(value); hold = value; };
  function assertCurrent(basis, revisions = true, phase = '재개 검사', verifiedCheckpoint = false) {
    const current = io.readLocal();
    const newerVerifiedDocument = verifiedCheckpoint && Number.isSafeInteger(basis.session.revision)
      && Number.isSafeInteger(current.session.revision) && current.session.revision >= basis.session.revision;
    const revisionMatches = same(current.session, basis.session, ['storeRevision'])
      && (same(current.session, basis.session, ['revision']) || newerVerifiedDocument);
    if (current.jobId !== basis.jobId || current.store !== basis.store
      || !basis.store.isOperationCurrent(basis.token) || !same(current.session, basis.session)
      || (revisions && !revisionMatches)) fail('native_resume_stale_scope', {
        phase, storeSame: current.store === basis.store, operationCurrent: basis.store.isOperationCurrent(basis.token),
        jobSame: current.jobId === basis.jobId, identitySame: same(current.session, basis.session),
        documentRevision: [basis.session.revision, current.session.revision],
        storeRevision: [basis.session.storeRevision, current.session.storeRevision],
      });
  }
  async function readJobs(jobId, idle) {
    const response = await io.apiRequest('/api/factory/jobs');
    if (!Array.isArray(response?.jobs)) fail('native_resume_jobs_unknown');
    const job = response.jobs.find(item => item.jobId === jobId);
    if (!job || (idle && response.jobs.some(item => active(item, jobId)))) fail('native_resume_worker_busy');
    if (idle && job.status !== 'waiting_manual') fail('native_resume_manual_wait_required');
    return job;
  }
  function assertCheckpoint(job, projection, minimumRevision, connected = true) {
    const saved = projection?.session;
    if ((connected && projection?.connected !== true) || projection.registration?.jobId !== job.jobId
      || projection.session?.workspaceId !== `batch:${job.jobId}` || !job.checkpointAvailable
      || !Number.isInteger(saved.revision) || !Number.isInteger(job.checkpointRevision)
      || saved.revision < job.checkpointRevision
      || saved.runId !== job.checkpointRunId || job.checkpointRevision < minimumRevision) fail('native_resume_checkpoint_unverified');
  }
  async function assertReloadedResult(current, projection, job) {
    const local = await io.readLocalProjection();
    if (!same(local.session, current.session) || !same(local.session, current.session, ['revision', 'storeRevision'])
      || !(await io.readSavedLocalProof())) fail('native_resume_local_readback_required', { phase: '새로고침 저장본 대조' });
    for (const stage of projection.stages || []) {
      const actual = local.stages?.find(item => item.key === stage.key);
      if (!actual || (stage.candidates || []).some(candidate => !actual.candidates?.some(item => item.id === candidate.id))
        || !sameCommandData([...(actual.selectedIds || [])].sort(), [...(stage.selectedIds || [])].sort())) fail('native_resume_local_readback_required', { phase: '새로고침 이미지 대조', stage: stage.key });
    }
    for (const group of projection.inputs || []) {
      const actual = local.inputs?.find(item => item.key === group.key);
      let items = actual?.items;
      const workflow = items?.[0]?.workflow;
      if (group.key === 'operator_controls' && items?.length === 1 && group.items?.length === 1
        && workflow?.status === '' && workflow.stageKey === ''
        && same(group.items[0].workflow, job, ['status', 'stageKey'])) {
        items = [{ ...items[0], workflow: group.items[0].workflow }];
      }
      if (!actual || actual.count !== group.count || !sameCommandData(items, group.items)) fail('native_resume_local_readback_required', { phase: '새로고침 입력 대조', group: group.key, count: [actual?.count, group.count] });
    }
    assertCurrent(current, true, '새로고침 결과 대조 후', true);
  }
  async function readback() {
    if (!hold) return null;
    const expected = hold;
    for (let count = 0; count < (io.maxPolls ?? 450); count += 1) {
      const job = await readJobs(expected.jobId, false);
      const projection = await io.readProjection();
      if (hold !== expected || !same(projection?.session, expected.session)
        || projection.registration?.jobId !== expected.jobId) fail('native_resume_stale_scope');
      if (Number.isInteger(job.attempts) && job.attempts > expected.attempts
        && !active(job) && ['waiting_manual', 'blocked', 'completed'].includes(job.status)) {
        assertCheckpoint(job, projection, expected.session.revision, false);
        const restoring = !io.readLocal().jobId && !io.readLocal().session.productKey;
        if (restoring) {
          await io.restoreLocalDraft({ jobId: expected.jobId, session: projection.session });
        }
        const current = io.readLocal();
        const reloaded = expected === io.journal.restored?.resume;
        if (current.jobId !== expected.jobId || !same(current.session, projection.session)
          || !Number.isSafeInteger(current.session.revision) || current.session.revision < projection.session.revision
          || (!restoring && !reloaded && !same(current.session, projection.session, ['revision', 'storeRevision']))) fail('native_resume_local_readback_required', {
            phase: '결과 작업공간 대조', restoring, reloaded, jobSame: current.jobId === expected.jobId,
            identitySame: same(current.session, projection.session), documentRevision: [current.session.revision, projection.session.revision],
            storeRevision: [current.session.storeRevision, projection.session.storeRevision],
          });
        if (reloaded) await assertReloadedResult(current, projection, job);
        if (!(await io.verifySavedCheckpoint({ ...projection.session, jobId: job.jobId, projectId: projection.session.workspaceId }))) fail('native_resume_checkpoint_unverified');
        assertCurrent(current, true, '재개 결과 복원 후', true);
        setHold(null);
        io.publish(`${job.productName || job.jobId} · ${job.message || job.status} · 기존 자료를 유지했습니다.`);
        return job;
      }
      io.publish(`${job.productName || job.jobId} · ${job.message || '재개 접수 확인 중'} · 완료로 판단하지 않고 같은 작업 결과를 기다립니다.`);
      await io.wait(2000);
    }
    fail('native_resume_result_pending');
  }
  async function run() {
    const before = io.readLocal();
    if (!before.jobId || before.session.workspaceId !== `batch:${before.jobId}`) fail('native_resume_current_job_required');
    await readJobs(before.jobId, true);
    assertCurrent(before, true, '저장 전');
    const result = await io.saveCheckpoint();
    const receipt = result?.value;
    if (receipt?.action !== 'save-checkpoint' || receipt.jobId !== before.jobId) fail('native_resume_checkpoint_unverified');
    const saved = io.readLocal();
    if (!same(saved.session, before.session) || saved.jobId !== before.jobId || io.dirty()) fail('native_resume_stale_scope', {
      phase: '저장 직후', identitySame: same(saved.session, before.session), jobSame: saved.jobId === before.jobId, dirty: io.dirty(),
    });
    const projection = await io.readProjection();
    const job = await readJobs(before.jobId, true);
    assertCurrent(saved, true, '저장 후 조회');
    assertCheckpoint(job, projection, receipt.checkpoint.revision);
    if (!same(projection.session, receipt.projection.session)
      || !same(projection.session, receipt.projection.session, ['storeRevision'])
      || job.checkpointRevision !== receipt.checkpoint.revision
      || JSON.stringify(projection.inputs) !== JSON.stringify(receipt.projection.inputs)
      || JSON.stringify(projection.stages) !== JSON.stringify(receipt.projection.stages)
      || !Number.isInteger(job.attempts) || job.attempts < 0) fail('native_resume_checkpoint_unverified');
    if (!(await io.verifySavedCheckpoint(receipt.checkpoint))) fail('native_resume_checkpoint_unverified');
    assertCurrent(saved, true, '영속 저장 확인 후', true);
    const payload = io.buildResumePayload({ job, projection: receipt.projection });
    setHold({ jobId: job.jobId, session: receipt.projection.session, attempts: job.attempts });
    io.publish('저장 영수증 확인 · 현재 작업을 재개합니다. 완료한 공정은 유지합니다.');
    const accepted = await io.apiRequest(`/api/factory/jobs/${encodeURIComponent(job.jobId)}/resume`, {
      method: 'POST', body: JSON.stringify(payload),
    });
    if (accepted?.accepted !== true || accepted.job?.jobId !== job.jobId) fail('native_resume_acceptance_unknown');
    return readback();
  }
  function start(operation) {
    flight = Promise.resolve().then(operation).catch(error => {
      io.publish(hold ? '재개 결과 확인 필요 · 다시 전송하지 않습니다. 명령 결과 다시 확인을 누르세요.' : `작업 재개 중단 · ${error.message} · 현재 자료를 유지합니다.`);
      throw error;
    }).finally(() => { flight = null; io.publish(''); });
    io.publish('현재 작업 저장·재개 확인 중입니다.');
    return flight;
  }
  return Object.freeze({
    get pending() { return !!flight || !!hold; },
    allowsWorker: jobId => !!hold && hold.jobId === jobId,
    resume() {
      if (flight) return flight;
      if (hold || io.blocked()) fail('native_command_pending');
      return start(run);
    },
    reconcile() { return flight || (hold ? start(readback) : Promise.resolve(null)); },
  });
}
