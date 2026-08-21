const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(__dirname, '../../frontend/src/operator-queue-model.mjs');

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

  assert.deepEqual(manual, {
    orderLabel: '01',
    stepLabel: '2 / 8단계',
    stageLabel: '대표 이미지',
    modeLabel: '수동 선택',
    stateLabel: '내 선택 대기',
    actionLabel: '컷 고르기',
    needsSelection: true,
  });
  assert.deepEqual(automatic, {
    orderLabel: '02',
    stepLabel: '6 / 8단계',
    stageLabel: '섹션 변형',
    modeLabel: '자동 진행',
    stateLabel: '자동 생성 중',
    actionLabel: '진행 관찰',
    needsSelection: false,
  });
});
