'use strict';

// 계약: '모른다' 를 '지워도 된다' 로 번역하지 않는다.
//
// 사용자 규칙(2026-08-29):
//   "필수값뿐만아니라 모든게 이미지고른거든 뭐든 안날라가야돼. 새작업 누르기전에는"
//
// 왜 이 계약이 필요한가:
//   판정이 참/거짓 둘뿐이면 '판단할 근거가 없다' 가 곧 '내 것이 아니다' 가 되고,
//   소비자는 그것을 '지워도 된다' 로 읽는다. 오늘 사고가 정확히 그 모양이었다 —
//   작업파일을 가르는 순간 저장 ID가 잠시 비었고, 그러자 모든 값이 남의 것으로 몰려 지워졌다.
//
// 그래서 네 갈래로 나눈다:
//   'mine' / 'foreign' / 'unknown' / 'auto'
//   삭제는 **확실할 때만**. 'unknown' 은 건드리지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 자체가 검사 대상이므로 스텁으로 대체하지 않고 실물을 싣는다.
function loadOwnership(currentProjectId) {
  const source = sourceSlice(
    CORE_03,
    'function factoryManualFieldSettingOwnership(',
    'function factoryManualFieldSettingMatchesCurrentWork(',
  );
  const context = vm.createContext({
    state: { currentProjectId },
    factoryIdentityKeysCompatible: (a, b) => !!a && !!b && (String(a).includes(String(b)) || String(b).includes(String(a))),
    factoryCurrentProductKey: () => '수저집파우치',
    factoryCurrentWorkflowRunId: () => 'run-1',
    factoryCurrentInputImageFingerprint: () => 'img-1',
  });
  vm.runInContext(`${source}\nthis.ownership = factoryManualFieldSettingOwnership;`, context);
  return context.ownership;
}

const FACTORY = { workspace: { id: 'project_mine' }, product: {}, automation: {} };
const STAMPED = {
  manualTouched: true,
  workspaceId: 'project_mine',
  productKey: '수저집파우치',
  currentRunId: 'run-1',
  inputImageFingerprint: 'img-1',
  stageId: 'field:size',
};

test('도장이 지금 작업과 맞으면 내 것이다', () => {
  const ownership = loadOwnership('project_mine');
  assert.equal(ownership(STAMPED, FACTORY, 'size', '수저집파우치'), 'mine');
});

test('도장이 있는데 다르면 남의 것이 확실하다', () => {
  // 남의 작업 값이 섞이는 것은 계속 걸러야 한다. 보호를 없앤 것이 아니다.
  const ownership = loadOwnership('project_mine');
  const foreign = { ...STAMPED, workspaceId: 'project_other' };
  assert.equal(ownership(foreign, FACTORY, 'size', '수저집파우치'), 'foreign');
});

test('지금 작업을 모르면 판단하지 않는다', () => {
  // 오늘 사고의 조건. 작업파일을 가르는 순간 저장 ID가 비었다.
  const ownership = loadOwnership('');
  const bare = { workspace: { id: '' }, product: {}, automation: {} };
  assert.equal(
    ownership(STAMPED, bare, 'size', '수저집파우치'),
    'unknown',
    "모른다를 '남의 것' 으로 답하면 그 값은 지워집니다.",
  );
});

test('값에 도장이 아예 없으면 낡은 것이지 남의 것이 아니다', () => {
  const ownership = loadOwnership('project_mine');
  const legacy = { manualTouched: true, stageId: 'field:size' };
  assert.equal(ownership(legacy, FACTORY, 'size', '수저집파우치'), 'unknown');
});

test('사람이 넣은 값이 아니면 auto 로 구분한다', () => {
  // 자동값은 다시 만들어낼 수 있으므로 정리 대상이 될 수 있다. 다만 그것도 확실할 때만.
  const ownership = loadOwnership('project_mine');
  assert.equal(ownership({ manualTouched: false }, FACTORY, 'size', '수저집파우치'), 'auto');
  assert.equal(ownership({}, FACTORY, 'size', '수저집파우치'), 'auto');
});

test('삭제 자리가 unknown 을 건너뛴다', () => {
  const repair = sourceSlice(
    CORE_03,
    'function repairFactoryProductIdentityDrift(',
    'function factoryMergeIdentityScope(',
  );
  // 사람이 넣은 값은 애초에 손대지 않는다.
  assert.match(repair, /if \(setting && setting\.manualTouched === true\) return;/);
  // 자동값이라도 판단할 근거가 없으면 건드리지 않는다.
  assert.match(repair, /factoryManualFieldSettingOwnership\(setting, normalized, fieldId, identityKey\) === 'unknown'\) return;/);
  const unknownAt = repair.indexOf("=== 'unknown') return;");
  const deleteAt = repair.indexOf('delete product.dbFieldSettings[fieldId];');
  assert.ok(unknownAt >= 0 && deleteAt > unknownAt, "'모른다' 검사가 삭제보다 뒤에 있습니다.");
});

test('사라진 값은 반드시 기록에 남는다', () => {
  // 이 기록이 없으면 브라우저 검증기들의 공통 보존 검사가 아무것도 못 본다.
  const repair = sourceSlice(
    CORE_03,
    'function repairFactoryProductIdentityDrift(',
    'function factoryMergeIdentityScope(',
  );
  assert.match(repair, /factoryRecordFieldLoss\(fieldId, 'identity-drift-repair'/);
  const recordAt = repair.indexOf('factoryRecordFieldLoss(');
  const deleteAt = repair.indexOf('delete product.dbFieldSettings[fieldId];');
  assert.ok(recordAt >= 0 && deleteAt > recordAt, '기록보다 삭제가 먼저면 무엇이 사라졌는지 못 남깁니다.');
});
