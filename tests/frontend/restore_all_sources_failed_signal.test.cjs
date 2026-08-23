// 회귀: 복원 소스가 전부 실패해도 '저장본 없음'과 똑같이 보이던 문제.
//
// workspace-persistence-orchestrator 의 restore 는 소스별 실패를 catch 로 삼키고
// 후보가 없으면 null 을 돌려준다. 소스 하나가 실패하면 다음 소스로 넘어가는 것은
// 옳지만, 전부 실패한 경우까지 '저장된 작업이 없음'과 구분되지 않으면
// 사용자는 작업이 사라진 줄 알고, 개발자는 원인을 볼 수 없다.
// (같은 종류의 위장 실패로 2026-08-21 '분석 진행 중' 고착을 겪었다.)
//
// 계약: 시도한 모든 소스가 예외로 끝났을 때만 onDiagnostics 로 알린다.
//       반환값과 제어 흐름은 그대로여서 기존 호출자에 영향이 없어야 한다.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_URL = pathToFileURL(
  path.join(ROOT, 'src', 'modules', 'workspace-persistence-orchestrator.mjs'),
).href;

const SCOPE = 'project:restore-signal';

function stubAdapter({ read }) {
  return { read, write: async () => ({}) };
}

async function loadFactory() {
  const ns = await import(`${MODULE_URL}?restore-signal=${Date.now()}-${Math.random()}`);
  return ns.createWorkspacePersistence;
}

function adaptersWhere(behaviour) {
  const names = ['session', 'indexeddb', 'server', 'workfile', 'archive'];
  const adapters = {};
  for (const name of names) adapters[name] = stubAdapter({ read: () => behaviour(name) });
  return adapters;
}

test('복원 소스가 전부 실패하면 저장본 없음과 구분해 알린다', async () => {
  const createWorkspacePersistence = await loadFactory();
  const seen = [];
  const persistence = createWorkspacePersistence({
    adapters: adaptersWhere(name => { throw new Error(`${name} 읽기 실패`); }),
    onDiagnostics: info => seen.push(info),
  });

  const result = await persistence.restore({ scopeId: SCOPE });

  assert.equal(result, null, '반환값과 제어 흐름은 그대로여야 기존 호출자가 깨지지 않는다');
  assert.equal(seen.length, 1, '전부 실패는 정확히 한 번 알려야 한다');
  assert.equal(seen[0].kind, 'restore-all-sources-failed');
  assert.equal(seen[0].scopeId, SCOPE);
  assert.equal(seen[0].attempted, seen[0].failures.length, '시도 수와 실패 수가 같아야 전부 실패다');
  assert.ok(seen[0].failures.every(f => /읽기 실패/.test(f.message)), '원인 메시지를 실어야 한다');
});

test('저장본이 정말 없는 경우(예외 없이 null)는 알리지 않는다', async () => {
  const createWorkspacePersistence = await loadFactory();
  const seen = [];
  const persistence = createWorkspacePersistence({
    adapters: adaptersWhere(() => null),
    onDiagnostics: info => seen.push(info),
  });

  const result = await persistence.restore({ scopeId: SCOPE });

  assert.equal(result, null);
  assert.deepEqual(seen, [], '데이터가 없는 정상 상태를 실패로 알리면 안 된다');
});

test('일부만 실패하고 다른 소스가 없으면 전부 실패가 아니므로 알리지 않는다', async () => {
  const createWorkspacePersistence = await loadFactory();
  const seen = [];
  let n = 0;
  const persistence = createWorkspacePersistence({
    adapters: adaptersWhere(() => {
      n += 1;
      if (n === 1) throw new Error('첫 소스만 실패');
      return null;
    }),
    onDiagnostics: info => seen.push(info),
  });

  await persistence.restore({ scopeId: SCOPE });

  assert.deepEqual(seen, [], '한 소스만 실패한 것은 다음 소스로 넘어가는 정상 경로다');
});

test('onDiagnostics 를 주지 않아도 복원은 그대로 동작한다', async () => {
  const createWorkspacePersistence = await loadFactory();
  const persistence = createWorkspacePersistence({
    adapters: adaptersWhere(() => { throw new Error('실패'); }),
  });

  // 콜백이 없다고 예외가 새어나가면 안 된다.
  assert.equal(await persistence.restore({ scopeId: SCOPE }), null);
});

test('브라우저 팩토리는 전부 실패를 기존 저하 보고 채널로 넘긴다', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'modules', 'workspace-persistence.mjs'),
    'utf8',
  );
  assert.match(source, /onDiagnostics/, '브라우저 팩토리가 진단을 배선해야 한다');
  assert.match(
    source,
    /restore-all-sources-failed[\s\S]{0,400}reportDegraded\(/,
    '전부 실패만 골라 저하 보고로 넘겨야 한다',
  );
  assert.match(
    source,
    /저장본이 없는 것이 아니라 복원 경로가 모두 실패/,
    '사용자가 두 경우를 구분할 수 있는 문구여야 한다',
  );
});
