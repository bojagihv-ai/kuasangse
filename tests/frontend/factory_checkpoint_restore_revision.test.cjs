'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const JOB_ID = 'factory-job-9412f418cfb3474b83dd3dde6c545349';

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function loadMatcher() {
  const slice = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryRuntimeControlProjectionMatchesCheckpoint(',
    'function factoryRuntimeControlServerSnapshotMatchesCheckpoint(',
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${slice}
this.matches = factoryRuntimeControlProjectionMatchesCheckpoint;`, context);
  return context.matches;
}

function checkpoint(overrides = {}) {
  return {
    schema: 'factory-product-checkpoint:v1',
    jobId: JOB_ID,
    projectId: `batch:${JOB_ID}`,
    productId: 'factory:슬라브겹보55x55ra',
    productKey: '슬라브겹보55x55ra',
    runId: 'factory_work_run_mt4fffhc_3drhxg',
    inputFingerprint: '7459896:base:tail',
    revision: 8,
    status: 'waiting_manual',
    stageKey: 'representative',
    savedAt: 1787407876402,
    ...overrides,
  };
}

function projection(overrides = {}) {
  const base = checkpoint();
  return {
    registration: { jobId: JOB_ID },
    session: {
      workspaceId: base.projectId,
      productId: base.productId,
      productKey: base.productKey,
      runId: base.runId,
      inputFingerprint: base.inputFingerprint,
      revision: base.revision,
      ...overrides,
    },
  };
}

function snapshotMatcherSource() {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('function factoryRuntimeControlServerSnapshotMatchesCheckpoint(');
  assert.notEqual(at, -1, '스냅샷 선택 함수를 찾지 못했습니다');
  const end = core.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), at);
  assert.notEqual(end, -1);
  return core.slice(at, end);
}

function restoreSource() {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(');
  assert.notEqual(at, -1, '복원 함수를 찾지 못했습니다');
  const end = core.indexOf(String.fromCharCode(10) + 'async function ', at + 10);
  assert.notEqual(end, -1);
  return core.slice(at, end);
}

test('저장이 앞서 나간 같은 작업도 복원 대상으로 받아들인다', () => {
  // 완전 일치를 요구하면 저장이 한 번이라도 앞서는 순간 그 작업은 영영 복원되지 않는다.
  const matches = loadMatcher();
  assert.equal(matches(projection({ revision: 42 }), checkpoint(), JOB_ID), true);
});

test('체크포인트와 판이 같으면 당연히 복원한다', () => {
  const matches = loadMatcher();
  assert.equal(matches(projection(), checkpoint(), JOB_ID), true);
});

test('체크포인트보다 뒤처진 판은 복원 대상이 아니다', () => {
  // 뒤처진 문서를 받아들이면 이미 고른 컷과 만들어 둔 결과가 사라진다.
  const matches = loadMatcher();
  assert.equal(matches(projection({ revision: 3 }), checkpoint(), JOB_ID), false);
});

test('판이 앞서도 신원이 다르면 거부한다', () => {
  const matches = loadMatcher();
  for (const field of ['workspaceId', 'productKey', 'runId', 'inputFingerprint']) {
    assert.equal(
      matches(projection({ revision: 99, [field]: 'other-value' }), checkpoint(), JOB_ID),
      false,
      `${field} 가 달라도 복원했습니다`,
    );
  }
  assert.equal(matches(projection({ revision: 99 }), checkpoint(), 'factory-job-other'), false);
  assert.equal(
    matches(projection({ revision: 99, productId: 'factory:다른제품' }), checkpoint(), JOB_ID),
    false,
  );
});

test('판을 읽을 수 없으면 복원하지 않는다', () => {
  const matches = loadMatcher();
  assert.equal(matches(projection({ revision: undefined }), checkpoint(), JOB_ID), false);
  assert.equal(matches(projection(), checkpoint({ revision: undefined }), JOB_ID), false);
});

test('불러온 로컬 문서는 판을 비교하지 않는다', () => {
  // 같은 문서를 연속으로 불러와도 판이 11 과 7 로 달라지는 것을 실측했다. 비교할 수 없는
  // 값으로 막으면 제품을 바꿀 때마다 복원이 불일치로 끝나 큐가 진행되지 않는다.
  const matches = loadMatcher();
  assert.equal(
    matches(projection({ revision: 3 }), checkpoint(), JOB_ID, { ignoreRevision: true }),
    true,
  );
});

test('판을 무시해도 신원은 그대로 엄격히 본다', () => {
  const matches = loadMatcher();
  for (const field of ['workspaceId', 'productKey', 'runId', 'inputFingerprint']) {
    assert.equal(
      matches(projection({ [field]: 'other' }), checkpoint(), JOB_ID, { ignoreRevision: true }),
      false,
      `${field} 가 달라도 복원했습니다`,
    );
  }
  assert.equal(matches(projection(), checkpoint(), 'factory-job-other', { ignoreRevision: true }), false);
});

test('스냅샷 선택은 부르는 쪽이 판을 볼지 정한다', () => {
  // 기본은 판을 본다. 세션을 건너뛰는 복원만 판을 접는다.
  const region = snapshotMatcherSource();
  assert.ok(region.includes('revision,'), '스냅샷의 판을 넘기지 않습니다');
  assert.ok(
    region.includes('options.ignoreRevision === true'),
    '부르는 쪽이 판 비교 여부를 정할 수 없습니다',
  );
});

test('스냅샷 선택은 같은 작업의 낡은 판을 계속 거른다', () => {
  // 판이 뒤처진 스냅샷을 실으면 만들어 둔 결과를 잃는다. 여기서는 판을 그대로 본다.
  const region = restoreSource();
  assert.ok(
    region.includes('factoryRuntimeControlServerSnapshotMatchesCheckpoint(snapshot, checkpoint, jobId)'),
    '스냅샷 선택에서 판 비교를 건너뜁니다',
  );
});


test('서버에서 실어 온 뒤에는 판을 다시 비교하지 않는다', () => {
  // 어느 스냅샷을 실을지는 위에서 이미 골랐다. 실은 뒤의 판 번호는 이 창이 문서를
  // 새로 열며 매긴 값이라, 체크포인트(96)와 새 문서(29)를 비교하면 탭을 새로 연
  // 작업이 영원히 복원되지 않는다.
  assert.ok(
    restoreSource().includes('hydratedServerCheckpoint === true'),
    '실어 왔다는 사실을 마지막 비교에 반영하지 않습니다',
  );
});

test('판 번호가 없는 저장 문서도 신원이 같으면 실어 온다', () => {
  // 실측: 저장된 문서에 workspaceRevision.counter 가 아예 없었다. 없는 값을 낡은 것으로
  // 치는 바람에 신원이 완전히 같은 작업이 탭 새로고침 뒤 영영 복원되지 않았다.
  const region = snapshotMatcherSource();
  assert.ok(region.includes('Number.isFinite(revision)'), '판을 읽을 수 있는지 보지 않습니다');
  assert.ok(
    region.includes('ignoreRevision: revisionUnreadable'),
    '판이 없을 때만 넘어가도록 하지 않았습니다',
  );
});

test('문서를 불러왔으면 판 비교를 끈다', () => {
  // loadProjectRecord 는 참/거짓이 아니라 불러온 기록을 돌려준다. 실측에서 기록을
  // 제대로 불러오고도 `restored === true` 가 거짓이라 판 비교(96 대 29)가 켜졌고,
  // 그 작업은 새 탭에서 영영 복원되지 않았다.
  const region = restoreSource();
  assert.ok(
    region.includes('ignoreRevision: Boolean(restored)'),
    '불러온 기록을 참/거짓으로 비교합니다',
  );
  assert.ok(
    !region.includes('ignoreRevision: restored === true'),
    '아직 === true 로 비교합니다',
  );
});

test('복원 뒤의 확인은 어디서도 판을 비교하지 않는다', () => {
  // 복원 뒤 확인은 방금 실어 온 그 문서를 다시 보는 것이다. 실측에서 한 번의 복원 안에서
  // 판이 31 → 72 → 33 으로 계속 바뀌었다. 한 군데라도 판을 비교하면 그 작업이 막힌다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(');
  assert.notEqual(at, -1);
  const end = core.indexOf(String.fromCharCode(10) + 'async function ', at + 10);
  const region = core.slice(at, end);

  const strict = 'factoryRuntimeControlProjectionMatchesCheckpoint(projection, checkpoint, jobId)';
  assert.equal(region.includes(strict), false, '판을 그대로 비교하는 자리가 남아 있습니다');
  assert.ok(region.includes('RESTORED_IDENTITY_ONLY'), '신원 기준 확인을 쓰지 않습니다');
});

test('복원은 서버 문서를 읽기 전에 그 작업으로 먼저 옮긴다', () => {
  // 서버 복원은 "지금 열려 있는" 작업공간의 문서를 읽는다. 실측: 워커가 단색을 물고 있는
  // 상태에서 R3 를 복원하려 하자 단색 문서를 읽고 신원 불일치로 실패했다.
  const region = restoreSource();
  const adoptAt = region.indexOf('factoryRuntimeControlAdoptProductProject(jobId)');
  const hydrateAt = region.indexOf('hydrateServerLastWorkSnapshot(');
  assert.notEqual(adoptAt, -1, '복원이 대상 작업으로 옮기지 않습니다');
  assert.notEqual(hydrateAt, -1);
  assert.ok(adoptAt < hydrateAt, '서버 문서를 읽은 뒤에야 작업을 옮깁니다');
});

test('이미 그 문서를 열고 있으면 실어 올 것이 없어도 복원 성공이다', () => {
  // hydrate 는 "바꿀 것이 없다"는 뜻으로도 거짓을 돌려준다. 실측: R3 문서를 이미 연
  // 상태에서 복원하자 신원이 완전히 일치하는데도 hydration_failed 로 막혔다.
  const region = restoreSource();
  assert.ok(region.includes('alreadyOnCheckpoint'), '이미 열린 경우를 구분하지 않습니다');
  const failAt = region.indexOf("'factory_product_checkpoint_hydration_failed'");
  assert.notEqual(failAt, -1);
  const guard = region.slice(Math.max(0, failAt - 200), failAt);
  assert.ok(guard.includes('!alreadyOnCheckpoint'), '이미 열려 있어도 실패로 셉니다');
});

test('거절당한 스냅샷은 여전히 불일치로 알린다', () => {
  // 신원이 다른 문서를 실어 오려 한 것은 "바꿀 것 없음"과 전혀 다른 사건이다.
  const region = restoreSource();
  assert.ok(region.includes('hydration.rejected'), '거절과 무변경을 구분하지 않습니다');
});

test('복원은 불러올 작업의 범위를 서버 복원에 명시한다', () => {
  // 실측: R3 저장본을 확인해 놓고, 화면에 남아 있던 단색 문서를 도로 실어 왔다.
  // 복원한 결과가 엉뚱한 제품이면 그 값이 그대로 스토어로 나간다.
  const region = restoreSource();
  assert.ok(
    region.includes('documentScopeId: getCurrentDocumentWorkspaceScope(checkpoint.projectId)'),
    '서버 복원에 대상 작업 범위를 넘기지 않습니다',
  );
});

test('서버 복원은 넘겨받은 범위를 화면 문서보다 우선한다', () => {
  const core = source('src/app-core-02.js');
  const at = core.indexOf('const documentScopeId = !takeoverIdentity');
  assert.notEqual(at, -1, '문서 범위 결정부를 찾지 못했습니다');
  const region = core.slice(at, at + 300);
  assert.ok(region.includes('options.documentScopeId'), '넘겨받은 범위를 쓰지 않습니다');
  assert.ok(
    region.indexOf('options.documentScopeId') < region.indexOf('getCurrentDocumentWorkspaceScope()'),
    '화면 문서를 먼저 봅니다',
  );
});

test('부팅 중 다른 제품을 불러오는 중이면 한 번 더 요청한다', () => {
  // 실측: 앱이 켜지며 단색을 불러오는 중에 R3 복원을 걸자, 첫 요청은 그 작업이 끝나기만
  // 기다렸다가 거짓을 돌려주고 화면은 단색으로 바뀌어 복원이 실패했다.
  const region = restoreSource();
  assert.ok(region.includes('requestHydration'), '요청을 다시 보낼 수 없는 모양입니다');
  assert.ok(
    region.includes('if (hydrated !== true && !rejected) hydrated = await requestHydration();'),
    '무변경 응답에 한 번 더 요청하지 않습니다',
  );
});

test('거절당한 스냅샷은 다시 요청하지 않는다', () => {
  // 신원이 다른 문서는 몇 번을 더 요청해도 달라지지 않는다.
  const region = restoreSource();
  const retryLine = region
    .split(String.fromCharCode(10))
    .find(line => line.includes('hydrated = await requestHydration();') && line.includes('if ('));
  assert.ok(retryLine, '다시 요청하는 줄을 찾지 못했습니다');
  assert.ok(retryLine.includes('!rejected'), '거절당해도 다시 요청합니다');
});

test('Cafe24 에 올린 뒤에도 자기 저장본으로 다시 열 수 있다', () => {
  // 등록하면 제품 신원이 factory:키 에서 cafe24:번호 로 바뀐다. 스냅샷 판정에 그 번호를
  // 주지 않으면 승격을 알아볼 수 없어, 한 번 등록한 제품은 영영 다시 열리지 않는다.
  // 실측: RP 문서가 cafe24:3013 을 달고 있어 factory:슬라브겹보55x55rp 체크포인트와 어긋났다.
  const region = snapshotMatcherSource();
  assert.ok(
    region.includes("productId: productNo ? `cafe24:${productNo}` : ''"),
    '등록 번호를 판정에 넘기지 않습니다',
  );
});

test('판 번호가 null 인 문서를 가장 낡은 판으로 오해하지 않는다', () => {
  // Number(null) 은 0 이다. 그대로 두면 판이 없는 문서가 "판 0" 으로 둔갑해 항상 낡은
  // 것으로 거절된다.
  const region = snapshotMatcherSource();
  assert.ok(region.includes('rawRevision === null'), 'null 을 따로 걸러내지 않습니다');
  assert.ok(region.includes('rawRevision === undefined'), 'undefined 를 따로 걸러내지 않습니다');
});

test('막 복원해 놓은 문서를 바로 다음 줄에서 판으로 거절하지 않는다', () => {
  // 실측: RP 를 제대로 실어 놓고(신원 일치) 바로 다음 검사에서 판 59 와 비교해 막혔다.
  // 복원은 성공해 놓고도 실패로 끝난다.
  const region = restoreSource();
  assert.ok(region.includes('restoredOntoCheckpoint'), '방금 복원했다는 사실을 남기지 않습니다');
  assert.ok(
    region.includes('|| restoredOntoCheckpoint,'),
    '바깥 검사가 방금 복원한 사실을 반영하지 않습니다',
  );
});

test('로컬 기록을 불러온 뒤의 하이드레이션도 무변경을 실패로 세지 않는다', () => {
  // 실측: 방울수저집은 loadProjectRecord 가 성공했는데도 뒤이은 강제 하이드레이션이
  // "바꿀 것 없음"(false) 을 돌려주자 hydration_failed 로 죽었다. 멀쩡히 열린 작업이
  // 복원 실패가 된다.
  const region = restoreSource();
  const at = region.indexOf('if (canHydrateServerCheckpoint && !hydratedServerCheckpoint');
  assert.notEqual(at, -1, '두 번째 하이드레이션 블록을 찾지 못했습니다');
  const block = region.slice(at, at + 1200);
  assert.ok(block.includes('const onCheckpoint ='), '이미 그 작업에 서 있는지 보지 않습니다');
  assert.ok(
    block.includes("hydration.hydrated !== true && !onCheckpoint"),
    '무변경 응답을 조건 없이 실패로 셉니다',
  );
});

test('두 번째 하이드레이션도 거절은 여전히 불일치로 알린다', () => {
  const region = restoreSource();
  const at = region.indexOf('if (canHydrateServerCheckpoint && !hydratedServerCheckpoint');
  const block = region.slice(at, at + 1200);
  assert.ok(block.includes('if (hydration.rejected)'), '거절과 무변경을 구분하지 않습니다');
});
