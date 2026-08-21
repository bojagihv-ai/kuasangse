// 회귀: 작업파일에 이미지컷 '입력 이미지'가 여러 벌 중복 저장되던 문제.
//
// 원 증상 (2026-08-21):
//   109.2MB 작업파일에 든 고유 이미지는 1장(5.19MB)뿐인데 20벌이 들어 있었다.
//   cuts 안 sourceBase64/sourcePreview/workImageBase64/workImagePreview 4필드가
//   접두어만 다른 같은 이미지였고, 그 cuts 가 assets / lightweight /
//   lightweight.assetPayload / persistenceEnvelope 에 반복 저장됐다.
//
//   원인은 stripCutsImages 의 `if (!preserveRecentResults)` 게이트였다.
//   preserveRecentResults 는 '최근 생성 결과' 보존 플래그인데, 무관한
//   '원본 입력 이미지' 제거까지 같이 막고 있었다.
//
// 계약:
//   - 직렬화 경로(dropInputImages:true)는 입력 이미지를 벗기고 마커만 남긴다.
//   - 런타임 state 대입 경로는 플래그를 주지 않으며 이미지를 그대로 유지해야 한다.
//   - assets 권위본(includeImages:true)은 stripCutsImages 를 지나지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 정의가 필요합니다`);
  const signatureEnd = source.slice(start).match(/\)\s*\{/);
  const braceStart = start + signatureEnd.index + signatureEnd[0].lastIndexOf('{');
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} 경계를 찾지 못했습니다`);
}

const IMAGE = 'A'.repeat(2048);

function makeCuts() {
  return {
    sourceBase64: IMAGE,
    sourcePreview: `data:image/jpeg;base64,${IMAGE}`,
    workImageBase64: IMAGE,
    workImagePreview: `data:image/jpeg;base64,${IMAGE}`,
    sourceMime: 'image/jpeg',
    prompts: [
      { id: 'p1', result: 'RESULT_1', completedAt: 200 },
      { id: 'p2', result: 'RESULT_2', completedAt: 100 },
    ],
    sizePrompts: [{ id: 's1', result: 'SIZE_1', completedAt: 300 }],
  };
}

function createStripper() {
  const context = vm.createContext({
    stripCutsRuntimeFlags: copy => copy,
    factoryRuntimeArchiveImageUrl: ({ imageUrl }) => imageUrl,
    IMAGE_STORED_MARKER: '__stored_in_indexeddb__',
  });
  vm.runInContext(`${extractFunction(CORE_02, 'stripCutsImages')}\nrun = stripCutsImages;`, context);
  return context.run;
}

const INPUT_FIELDS = ['sourceBase64', 'sourcePreview', 'workImageBase64', 'workImagePreview'];

test('직렬화 경로는 입력 이미지를 벗기고 존재 마커만 남긴다', () => {
  const strip = createStripper();
  const out = strip(makeCuts(), { preserveRecentResults: true, dropInputImages: true });

  for (const field of INPUT_FIELDS) {
    assert.equal(out[field], undefined, `${field} 가 직렬화본에 남으면 작업파일이 이미지 벌수만큼 부푼다`);
  }
  assert.equal(out.hasSourceImage, true, '복원용 존재 마커는 남아야 한다');
  assert.equal(out.hasWorkImage, true);
});

test('직렬화 경로에서도 최근 생성 결과는 그대로 보존한다', () => {
  const strip = createStripper();
  const out = strip(makeCuts(), {
    preserveRecentResults: true,
    dropInputImages: true,
    generalResultLimit: 16,
    sizeResultLimit: 8,
  });
  assert.deepEqual(out.prompts.map(p => p.result), ['RESULT_1', 'RESULT_2'], '입력 이미지 제거가 결과 보존을 깨면 안 된다');
  assert.deepEqual(out.sizePrompts.map(p => p.result), ['SIZE_1']);
});

test('런타임 대입 경로는 플래그가 없으므로 입력 이미지를 유지한다', () => {
  const strip = createStripper();
  // app-core-02 의 8016 / 10051 호출부와 같은 인자
  const out = strip(makeCuts(), { preserveRecentResults: true, generalResultLimit: 16, sizeResultLimit: 8 });
  for (const field of INPUT_FIELDS) {
    assert.equal(typeof out[field], 'string', `${field} 가 런타임에서 사라지면 작업 중 세션의 이미지가 없어진다`);
  }
});

test('preserveRecentResults 가 false 면 기존대로 입력 이미지를 벗긴다', () => {
  const strip = createStripper();
  const out = strip(makeCuts(), {});
  for (const field of INPUT_FIELDS) {
    assert.equal(out[field], undefined);
  }
});

test('직렬화 호출부만 dropInputImages 를 켜고 런타임 호출부는 켜지 않는다', () => {
  // 직렬화: 경량 세션 페이로드
  assert.match(
    CORE_02,
    /cuts: stripCutsImages\(payload\.cuts, \{[\s\S]{0,120}dropInputImages: true/,
    'buildLightweightSessionPayload 는 입력 이미지를 벗겨야 한다',
  );
  // 직렬화: assetPayload(includeImages:false)
  assert.match(
    CORE_02,
    /includeImages \? stripCutsRuntimeFlags[\s\S]{0,200}dropInputImages: true/,
    'assetPayload 는 includeImages:false 경로에서 입력 이미지를 벗겨야 한다',
  );
  // assets 권위본은 stripCutsImages 를 지나지 않는다
  assert.match(
    CORE_02,
    /cuts: includeImages \? stripCutsRuntimeFlags\(cloneData\(state\.cuts \|\| \{\}\)\)/,
    'assets 는 원본 이미지를 그대로 보관하는 권위본이어야 한다',
  );
  // 런타임 state 대입 경로 2곳은 dropInputImages 를 켜면 안 된다
  const runtimeAssign = CORE_02.match(/state\.cuts = \{[\s\S]{0,400}?stripCutsImages\(assets\.cuts, \{[\s\S]{0,160}?\}\)/);
  assert.ok(runtimeAssign, '런타임 대입 호출부를 찾지 못했습니다');
  assert.doesNotMatch(runtimeAssign[0], /dropInputImages/, '런타임 대입은 이미지를 유지해야 한다');
});
