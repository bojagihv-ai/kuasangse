'use strict';

// 회귀: 같은 빌드 번호가 다른 내용으로 다시 발급되면서, 새 빌드 알림이 영원히 침묵하던 문제.
//
// buildId 카운터(`...-v1254` 의 숫자)는 src/runtime-manifest.json 안에 있고,
// 그 파일은 git 이 추적한다. 그래서 `git restore` / `checkout` 한 번에 번호가 되감기고,
// 다음 빌드는 **이미 쓴 번호를 다시 발급**한다.
//
// 실제 피해: 2026-08-29 사용자 브라우저 탭이 v1258 을 들고 있었는데 그 번호는 어느
//   커밋에도 없었고, 같은 날 빌드는 v1255 를 발급했다. 커밋 이력은
//   v1247→v1248→v1249→v1250→v1253→v1254→v1255 로, v1255 는 재사용된 번호다.
//
// 위험한 쪽은 번호가 '내려가는' 것이 아니라 '같은 번호에 다른 내용' 이다.
// app-loader 의 새 빌드 감지는 순수 문자열 비교(nextBuildId === currentBuildId)라,
// 번호가 같으면 내용이 바뀌어도 알리지 않는다. 탭은 낡은 코드를 계속 돌린다.
//
// 계약:
//   1) 매니페스트에 내용 지문(sourceDigest)을 남긴다.
//   2) 가드는 (번호, 지문) 쌍으로 비교한다. 번호가 같아도 지문이 다르면 새 빌드다.
//   3) 내용이 바뀌었으면 dist 와 매니페스트의 번호가 어긋나 있어도 번호를 올린다.
//      (git restore 직후가 정확히 그 상태였고, 예전 코드는 여기서 번호를 그대로 뒀다.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const LOADER = path.join(ROOT, 'src', 'app-loader.js');
const builder = require(path.join(ROOT, 'tools', 'build_runtime_bundle.cjs'));

function loadGuard() {
  const source = fs.readFileSync(LOADER, 'utf8');
  const start = source.indexOf('function runtimeBuildId(');
  const end = source.indexOf('\n  async function loadApp(', start);
  assert.ok(start >= 0 && end > start, '가드 소스를 찾지 못했습니다.');
  const context = vm.createContext({ RUNTIME_BUILD_CHECK_INTERVAL_MS: 15000 });
  vm.runInContext(
    `${source.slice(start, end)}
     this.installGuard = installRuntimeBuildFreshnessGuard;
     this.signature = runtimeBuildSignature;`,
    context,
  );
  return context;
}

function fakeEnvironment() {
  const windowObject = {
    addEventListener() {}, removeEventListener() {},
    setInterval() { return 1; }, clearInterval() {},
  };
  const documentObject = {
    visibilityState: 'visible',
    addEventListener() {}, removeEventListener() {},
  };
  return { windowObject, documentObject };
}

test('번호가 같아도 내용 지문이 다르면 새 빌드로 알린다', async () => {
  // 예전 동작: nextBuildId === currentBuildId 라 영원히 침묵했다.
  const { installGuard, signature } = loadGuard();
  const current = { buildId: 'bridge-v1255', sourceDigest: 'aaaa1111' };
  const served = { buildId: 'bridge-v1255', sourceDigest: 'bbbb2222' };
  const staleCalls = [];
  const guard = installGuard('bridge-v1255', {
    ...fakeEnvironment(),
    readManifest: async () => served,
    onStale: (from, to) => staleCalls.push([from, to]),
  }, signature(current));

  assert.equal(await guard.checkNow(), true, '내용이 바뀌었는데 알리지 않으면 낡은 코드가 계속 돕니다.');
  assert.deepEqual(staleCalls, [['bridge-v1255', 'bridge-v1255']], '사람에게는 번호를 그대로 보여준다');
  guard.dispose();
});

test('번호도 지문도 같으면 조용히 있는다', async () => {
  const { installGuard, signature } = loadGuard();
  const same = { buildId: 'bridge-v1255', sourceDigest: 'aaaa1111' };
  let staleCount = 0;
  const guard = installGuard('bridge-v1255', {
    ...fakeEnvironment(),
    readManifest: async () => ({ ...same }),
    onStale: () => { staleCount += 1; },
  }, signature(same));

  assert.equal(await guard.checkNow(), false);
  assert.equal(await guard.checkNow(), false);
  assert.equal(staleCount, 0, '같은 빌드인데 알리면 작업 중에 계속 방해합니다.');
  guard.dispose();
});

test('지문이 없는 매니페스트에서는 예전처럼 번호만 본다', async () => {
  // 하위 호환. 지문을 아직 안 쓰는 매니페스트를 만나도 동작이 멈추면 안 된다.
  const { installGuard } = loadGuard();
  let staleCount = 0;
  const guard = installGuard('bridge-v1255', {
    ...fakeEnvironment(),
    readManifest: async () => ({ buildId: 'bridge-v1256' }),
    onStale: () => { staleCount += 1; },
  });
  assert.equal(await guard.checkNow(), true);
  assert.equal(staleCount, 1);
  guard.dispose();
});

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-buildid-reuse-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'runtime-manifest.json'), JSON.stringify({
    schema: 'kuasangse.runtime.v1',
    buildId: 'bridge-v100',
    bundle: 'dist/runtime.js',
    scripts: ['src/runtime.js'],
  }, null, 2));
  fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.rev = 1;\n');
  return root;
}

const readManifestFile = root =>
  JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8'));

test('빌드가 매니페스트에 내용 지문을 남긴다', () => {
  const root = scratchRepo();
  try {
    builder.writeRuntimeBundle(root);
    builder.writeRuntimeBundle(root);
    const manifest = readManifestFile(root);
    assert.ok(manifest.sourceDigest, '지문이 없으면 가드가 번호만 보게 되어 예전 문제로 돌아갑니다.');
    assert.match(
      fs.readFileSync(path.join(root, 'dist', 'runtime.js'), 'utf8'),
      new RegExp(`"sourceDigest":"${manifest.sourceDigest}"`),
      '매니페스트와 번들의 지문이 어긋나면 무엇을 믿을지 알 수 없습니다.',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('git restore 로 번호가 되감긴 뒤에도 내용이 바뀌었으면 번호를 올린다', () => {
  // 예전 동작: dist 와 매니페스트의 buildId 가 다르면 번호를 그대로 뒀다.
  // 그 결과 '같은 번호 다른 내용' 이 만들어지고 가드가 침묵했다.
  const root = scratchRepo();
  try {
    builder.writeRuntimeBundle(root);
    fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.rev = 2;\n');
    builder.writeRuntimeBundle(root);
    const advanced = readManifestFile(root);
    assert.equal(advanced.buildId, 'bridge-v101');

    // git restore 흉내: 매니페스트만 예전 번호로 되돌린다. dist 는 v101 그대로다.
    fs.writeFileSync(path.join(root, 'src', 'runtime-manifest.json'), JSON.stringify({
      schema: 'kuasangse.runtime.v1',
      buildId: 'bridge-v100',
      bundle: 'dist/runtime.js',
      scripts: ['src/runtime.js'],
    }, null, 2));
    fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.rev = 3;\n');

    builder.writeRuntimeBundle(root);
    const after = readManifestFile(root);
    assert.notEqual(
      after.buildId, 'bridge-v100',
      '내용이 바뀌었는데 번호를 그대로 두면 같은 번호가 다른 내용을 가리키게 됩니다.',
    );
    assert.ok(after.sourceDigest, '되감긴 뒤에도 지문은 남아야 합니다.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('내용이 그대로면 번호를 올리지 않는다', () => {
  // 재빌드마다 번호가 오르면 작업 중인 탭에 새 빌드 알림이 계속 뜬다.
  const root = scratchRepo();
  try {
    builder.writeRuntimeBundle(root);
    builder.writeRuntimeBundle(root);
    const settled = readManifestFile(root).buildId;
    builder.writeRuntimeBundle(root);
    builder.writeRuntimeBundle(root);
    assert.equal(readManifestFile(root).buildId, settled);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
