'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const toUrl = relative => new URL(`file://${path.resolve(ROOT, relative).split(String.fromCharCode(92)).join('/')}`).href;
const INBOX_URL = toUrl('control_tower/frontend/src/next-action-model.mjs');
const BOARD_URL = toUrl('control_tower/frontend/src/production-board-model.mjs');

/**
 * 실측 2026-09-02: 조작자가 개요 첫 화면을 두고 "제품별 작업대 저것도 의미불명이야 너무
 * 허접하고 단 한 번도 쓴 적 없는 기능이야" 라고 말했다. 그 화면은 작업파일과 작업의 연결
 * 상태만 은어로 말할 뿐, 지금 사람이 무엇을 해야 하는지는 말하지 않았다.
 */

function job(overrides = {}) {
  return {
    jobId: 'job-1',
    productName: '방울수저집',
    workfileName: '방울수저집.kuasangse',
    status: 'waiting_manual',
    stageKey: 'sections',
    mode: 'manual',
    ...overrides,
  };
}

async function inboxFor(jobs, options = {}) {
  const { projectProductionBoard } = await import(BOARD_URL);
  const { buildNextActionInbox } = await import(INBOX_URL);
  return buildNextActionInbox({
    board: projectProductionBoard(jobs, options.boardOptions || {}),
    tabs: options.tabs || [],
    activeJobId: options.activeJobId || '',
  });
}

test('사람이 손댈 일만 위로 세우고, 기계가 하는 중인 것은 따로 접는다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-run', productName: '슬라브 겹보', status: 'running', stageKey: 'hero' }),
    job({ jobId: 'job-pick', productName: '방울수저집', status: 'waiting_manual', stageKey: 'sections',
      progress: { stages: [{ key: 'sections', label: '섹션 변형', candidates: [{ id: 'c1' }, { id: 'c2' }] }] } }),
    job({ jobId: 'job-queued', productName: '낙지발노리개', status: 'queued', stageKey: 'db' }),
  ]);
  assert.equal(inbox.schema, 'control-tower-next-action-inbox:v1');
  assert.deepEqual(inbox.items.map(item => item.jobId), ['job-pick']);
  assert.deepEqual(inbox.watching.map(item => item.jobId).sort(), ['job-queued', 'job-run']);
  assert.equal(inbox.summary.mine, 1);
  assert.equal(inbox.summary.watching, 2);
});

test('컷 고르기 줄은 무엇을 몇 개 중에 고르는지 말하고 그 단계로 보낸다', async () => {
  const inbox = await inboxFor([
    job({ progress: { stages: [{ key: 'sections', label: '섹션 변형', candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] } }),
  ]);
  const [item] = inbox.items;
  assert.equal(item.kind, 'pick');
  // 화면 어디서나 같은 이름을 쓴다. 보드가 쓰는 단계 이름(BOARD_STAGES)을 그대로 쓴다.
  assert.match(item.headline, /섹션/);
  assert.match(item.headline, /후보 3개/);
  assert.equal(item.primary.route, 'board');
  assert.equal(item.primary.stageKey, 'sections');
});

test('막힌 작업과 값 누락은 컷 고르기보다 먼저 온다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-pick', productName: 'ㄱ픽', status: 'waiting_manual',
      progress: { stages: [{ key: 'sections', label: '섹션 변형', candidates: [{ id: 'a' }] }] } }),
    job({ jobId: 'job-values', productName: 'ㄴ값', status: 'waiting_manual', missingRequiredValues: ['material', 'size'] }),
    job({ jobId: 'job-blocked', productName: 'ㄷ막힘', status: 'blocked', message: 'factory_worker_failed' }),
  ]);
  assert.deepEqual(inbox.items.map(item => item.kind), ['blocked', 'values', 'pick']);
  assert.match(inbox.items[1].headline, /소재/);
  assert.match(inbox.items[1].headline, /사이즈/);
});

test('작업파일 연결은 무엇보다 먼저 나오고 사람 말로 이유를 말한다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-blocked', status: 'blocked' }),
    job({ jobId: 'job-link', productName: '슬라브 겹보 R3', status: 'waiting_manual',
      progress: { stages: [{ key: 'sections', label: '섹션 변형', candidates: [{ id: 'a' }] }] } }),
  ], {
    tabs: [{ key: 'job:job-link', jobId: 'job-link', productName: '슬라브 겹보 R3', linkState: 'rebind_required', hasWorkfile: true }],
  });
  assert.equal(inbox.items[0].kind, 'link');
  assert.equal(inbox.items[0].jobId, 'job-link');
  assert.match(inbox.items[0].detail, /회차가 다릅니다/);
  assert.equal(inbox.items[0].primary.route, 'workfile-desk');
  assert.doesNotMatch(JSON.stringify(inbox.items[0]), /linkState|revision|checkpoint|rebind/u);
});

test('작업 없이 파일만 연 탭도 할 일로 세운다', async () => {
  const inbox = await inboxFor([], {
    tabs: [{ key: 'workfile:abc', jobId: '', workfileName: '새제품.kuasangse', linkState: 'unlinked', hasWorkfile: true }],
  });
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].kind, 'link');
  assert.equal(inbox.items[0].tabKey, 'workfile:abc');
});

test('같은 종류면 오래 기다린 것이 위로 온다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-new', productName: '새것', status: 'waiting_manual', timing: { totalWaitMs: 60_000 },
      progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
    job({ jobId: 'job-old', productName: '오래된것', status: 'waiting_manual', timing: { totalWaitMs: 3_600_000 },
      progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
  ]);
  assert.deepEqual(inbox.items.map(item => item.jobId), ['job-old', 'job-new']);
  assert.equal(inbox.items[0].waitLabel, '1시간째');
  assert.equal(inbox.items[1].waitLabel, '1분째');
});

test('등록까지 끝난 제품은 할 일에서 빠지고 완료로 센다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-done', productName: '끝난제품', status: 'completed', stageKey: 'cafe24' }),
    job({ jobId: 'job-cafe24', productName: '등록대기', status: 'completed', stageKey: 'final_detail' }),
  ]);
  assert.deepEqual(inbox.done.map(item => item.jobId), ['job-done']);
  assert.deepEqual(inbox.items.map(item => item.kind), ['cafe24']);
  assert.equal(inbox.items[0].primary.route, 'cafe24');
});

test('머리글은 숫자만 던지지 않고 지금 상태를 문장으로 말한다', async () => {
  const { inboxHeadline, buildNextActionInbox } = await import(INBOX_URL);
  assert.equal(inboxHeadline(buildNextActionInbox({ board: { rows: [] } })), '아직 투입된 제품이 없습니다.');
  const busy = await inboxFor([
    job({ jobId: 'job-run', status: 'running' }),
    job({ jobId: 'job-pick', progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
  ]);
  assert.match(inboxHeadline(busy), /손댈 일 1건/);
  assert.match(inboxHeadline(busy), /자동 진행 1건/);
  const idle = await inboxFor([job({ jobId: 'job-run', status: 'running' })]);
  assert.match(inboxHeadline(idle), /사람이 할 일은 없습니다/);
});

test('지금 조립공장이 붙잡고 있는 제품은 그 사실을 들고 있다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-live', progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
  ], { activeJobId: 'job-live' });
  assert.equal(inbox.items[0].live, true);
});

test('파일을 연 적 없는 작업은 연결이 필요하다고 말하지 않는다', async () => {
  // 실측 2026-09-02: 옛 화면은 큐의 여섯 줄 전부에 "연결 필요" 를 붙여 사람이 화면을 무시하게 만들었다.
  const inbox = await inboxFor([
    job({ jobId: 'job-pick', progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
  ], {
    tabs: [{ key: 'job:job-pick', jobId: 'job-pick', productName: '방울수저집', linkState: 'unlinked' }],
  });
  assert.deepEqual(inbox.items.map(item => item.kind), ['pick']);
});

test('파일을 열었는데 맞는 작업이 없으면 그때 연결을 요청한다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-pick', progress: { stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }] }] } }),
  ], {
    tabs: [{ key: 'job:job-pick', jobId: 'job-pick', productName: '방울수저집', linkState: 'unlinked', hasWorkfile: true }],
  });
  assert.deepEqual(inbox.items.map(item => item.kind), ['link']);
});

test('컷 선택 대기 중에 붙은 등록 차단 표시는 막힘으로 부르지 않는다', async () => {
  // 실측 2026-09-02: 실제 큐 아홉 줄 중 여덟 줄이 "막힌 작업" 으로 떴다. 그중 다섯은
  // 아직 컷을 고르는 중이었고, 등록 차단은 생산이 끝난 뒤에 푸는 일이었다.
  const inbox = await inboxFor([
    job({
      jobId: 'job-picking',
      status: 'waiting_manual',
      progress: {
        stages: [{ key: 'sections', label: '섹션', candidates: [{ id: 'a' }, { id: 'b' }] }],
        registration: { status: 'blocked', blockers: ['product_id', 'category_id'] },
      },
    }),
  ]);
  assert.deepEqual(inbox.items.map(item => item.kind), ['pick']);
});

test('생산이 끝난 뒤의 등록 차단은 무엇이 막고 있는지 이름을 댄다', async () => {
  const inbox = await inboxFor([
    job({
      jobId: 'job-done',
      status: 'completed',
      stageKey: 'final_detail',
      progress: { registration: { status: 'blocked', blockers: ['product_id', 'category_id'] } },
    }),
  ]);
  assert.equal(inbox.items[0].kind, 'cafe24');
  assert.match(inbox.items[0].headline, /막힘 풀기/);
  assert.match(inbox.items[0].detail, /product_id/);
});

test('긴 사유는 목록을 못 읽게 만들지 않는다', async () => {
  const inbox = await inboxFor([
    job({ jobId: 'job-long', status: 'blocked', message: '가'.repeat(400) }),
  ]);
  assert.ok(inbox.items[0].detail.length <= 111, String(inbox.items[0].detail.length));
});

test('후보가 아직 안 온 선택 대기 작업도 목록에서 사라지지 않는다', async () => {
  // 실측 2026-09-02: 실제 큐의 선택 대기 세 건은 후보가 아직 없어 인박스에서 통째로 빠졌다.
  // 화면에는 아무 일 없는 것처럼 보였고, 그 제품들은 잊힐 자리에 있었다.
  const inbox = await inboxFor([
    job({ jobId: 'job-waiting', productName: '슬라브 겹보 RP', status: 'waiting_manual', stageKey: 'representative' }),
  ]);
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].kind, 'pick');
  assert.match(inbox.items[0].headline, /대표이미지/);
  assert.equal(inbox.items[0].primary.route, 'board');
});

test('한 줄의 제목과 설명은 같은 단계를 말한다', async () => {
  // 실측 2026-09-02: 제목은 "색상옵션 확인하고 이어가기", 설명은 "최종 이어서 진행" 이었다.
  const inbox = await inboxFor([
    job({
      jobId: 'job-waiting',
      status: 'waiting_manual',
      progress: { awaitingStageKeys: ['final_detail'], stages: [{ key: 'representative', label: '대표', selectedId: '' }] },
    }),
  ]);
  const [item] = inbox.items;
  assert.equal(item.stageKey, 'final_detail');
  assert.match(item.headline, /최종/);
});
