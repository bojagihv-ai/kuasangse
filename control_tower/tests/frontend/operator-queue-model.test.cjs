const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(__dirname, '../../frontend/src/operator-queue-model.mjs');

test('참조와 필수값 대기는 생성컷 선택으로 오인하지 않는다', async () => {
  const { buildOperatorQueueRow } = await import(pathToFileURL(MODULE).href);
  for (const [stageKey, stageLabel, actionLabel, stepLabel] of [
    ['db', 'DB 확정', 'DB 확정하기', '2 / 7단계'],
    ['required_fields', '필수값', '필수값 확인', '3 / 7단계'],
    ['competitors', '경쟁사', '경쟁사 선택', '4 / 7단계'],
  ]) {
    const row = buildOperatorQueueRow({ status: 'waiting_manual', stageKey, mode: 'auto' });
    assert.equal(row.stageLabel, stageLabel);
    assert.equal(row.actionLabel, actionLabel);
    assert.equal(row.stepLabel, stepLabel);
  }
});

test('자동과 수동 작업을 같은 대량생산 행 정보로 표시한다', async () => {
  const queue = await import(`${pathToFileURL(MODULE).href}?queue-model=${Date.now()}`);

  const manual = queue.buildOperatorQueueRow({
    jobId: 'factory-job-manual',
    mode: 'manual',
    status: 'waiting_manual',
    stageKey: 'representative',
    policy: { resolved: { representative_image: 'manual' } },
  }, 0);
  const automatic = queue.buildOperatorQueueRow({
    jobId: 'factory-job-auto',
    mode: 'auto',
    status: 'running',
    stageKey: 'sections',
    policy: { resolved: { section_variant: 'auto' } },
  }, 1);
  const mixed = queue.buildOperatorQueueRow({
    jobId: 'factory-job-mixed',
    mode: 'auto',
    status: 'waiting_manual',
    stageKey: 'option_color',
    policy: { resolved: { option_image: 'auto' } },
  }, 2);

  assert.deepEqual(manual, {
    orderLabel: '01',
    stepLabel: '5 / 7단계',
    stageLabel: '대표 이미지',
    modeLabel: '수동 선택',
    stateLabel: '내 선택 대기',
    actionLabel: '컷 고르기',
    needsSelection: true,
  });
  assert.deepEqual(automatic, {
    orderLabel: '02',
    stepLabel: '6 / 7단계',
    stageLabel: '섹션 변형',
    modeLabel: '자동 진행',
    stateLabel: '자동 생성 중',
    actionLabel: '진행 관찰',
    needsSelection: false,
  });
  assert.deepEqual(mixed, {
    orderLabel: '03',
    stepLabel: '5 / 7단계',
    stageLabel: '옵션·색상',
    modeLabel: '자동 진행 후 수동 선택',
    stateLabel: '내 선택 대기',
    actionLabel: '컷 고르기',
    needsSelection: true,
  });
});

test('export 대기 작업은 DB가 아니라 Cafe24 사전점검으로 표시한다', async () => {
  const queue = await import(`${pathToFileURL(MODULE).href}?queue-cafe24=${Date.now()}`);
  const row = queue.buildOperatorQueueRow({
    jobId: 'factory-job-export',
    mode: 'auto',
    status: 'waiting_manual',
    stageKey: '',
    progress: { stageKey: 'export' },
  }, 0, { progress: { stageKey: 'export' } });
  assert.deepEqual(row, {
    orderLabel: '01',
    stepLabel: '7 / 7단계',
    stageLabel: 'Cafe24',
    modeLabel: '승인 대기',
    stateLabel: '승인 대상 확인',
    actionLabel: '사전점검 열기',
    needsSelection: false,
  });
});

test('비활성 대기열 행도 작업 progress의 Cafe24 전송 단계를 그대로 표시한다', async () => {
  const queue = await import(`${pathToFileURL(MODULE).href}?queue-progress=${Date.now()}`);
  const row = queue.buildOperatorQueueRow({
    jobId: 'factory-job-export-direct-progress',
    mode: 'auto',
    status: 'waiting_manual',
    stageKey: '',
  }, 0, { stageKey: 'export', status: 'manual', percent: 100 });

  assert.equal(row.stepLabel, '7 / 7단계');
});
