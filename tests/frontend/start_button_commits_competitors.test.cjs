'use strict';

// 계약: 수집에 **성공하면** 그 결과가 작업에 남아야 한다.
//
// 2026-08-30 실측으로 잡은 사고:
//   파란 시작 버튼으로 경쟁사 후보 19건을 잘 수집했다. 화면 카드에도 다 보였다.
//   그런데 작업(factory.product.competitors)은 0건이었다.
//
//   원인은 필터가 아니었다. 후보는 판정을 전부 통과했다.
//   수집이 **성공했을 때만** 실행되는 한 줄이 문제였다 —
//     app-core-06.js 의 factorySyncCompetitorMarketToOwnedFactory(factory, updated)
//   이 줄은 드래프트에 factory.competitors.compPage 를 쓴다. 그런데 시작 버튼이 쓰는
//   명령 정책 factory/start:runDb 에 'competitors' 경로가 없었다.
//   그래서 커밋 순간 FACTORY_COMMAND_PATH_REJECTED 가 나고 **드래프트가 통째로 폐기**됐다 —
//   후보 19건, 실행번호, 실행 상태, 단계, 사전점검, 로그까지 한꺼번에.
//   시장 결과만 살아남은 건 그게 작업 밖(state.compPage)에 있기 때문이다.
//
//   같은 함수를 단독으로 부르는 factory/competitor:runVmCandidatesForSelection 에는
//   그 경로가 있었다. 그래서 '다시 수집' 버튼은 되고 파란 시작 버튼만 안 됐다.
//
//   수집이 실패하면(0건) 그 줄에 도달하지 않으므로 커밋은 성공했다.
//   **잘될수록 잃는** 모양이라 더 알아채기 어려웠다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function policyBlock(commandName) {
  const marker = `add(['${commandName}']`;
  const start = CORE_03.indexOf(marker);
  assert.notEqual(start, -1, `명령 정책을 찾지 못했습니다: ${commandName}`);
  const end = CORE_03.indexOf(']);', start);
  assert.notEqual(end, -1, `정책 끝을 찾지 못했습니다: ${commandName}`);
  return CORE_03.slice(start, end);
}

// 시작 버튼 흐름이 실제로 competitors 를 쓰는지부터 확인한다.
// 이 전제가 무너지면 아래 계약들은 지킬 것이 없어진다.
test('수집이 성공하면 작업에 경쟁사 상태를 쓴다', () => {
  assert.match(
    CORE_06,
    /factorySyncCompetitorMarketToOwnedFactory\(factory, updated\);/,
    '수집 성공 시 작업에 반영하는 줄이 사라졌습니다.',
  );
  assert.match(
    CORE_06,
    /factory\.competitors\.compPage\.marketScrape = cloneData\(market\);/,
    '이 함수가 competitors 경로를 쓰기 때문에 정책에도 그 경로가 있어야 합니다.',
  );
});

for (const command of ['factory/start:runDb', 'factory/db:runDb', 'factory/db:rerunDbVmOnly']) {
  test(`${command} 정책이 competitors 경로를 허용한다`, () => {
    const block = policyBlock(command);
    assert.match(
      block,
      /part\('competitors', \['competitors'\]\)/,
      `이 경로가 없으면 수집에 성공하는 순간 커밋이 거절되어 작업이 통째로 폐기됩니다.`,
    );
  });
}

test('시작 버튼 정책이 형제 명령과 같은 범위를 덮는다', () => {
  // '다시 수집' 은 되는데 시작 버튼은 안 되는 상황이 다시 생기지 않게 한다.
  const sibling = policyBlock('factory/competitor:runVmCandidatesForSelection');
  const start = policyBlock('factory/start:runDb');
  for (const part of ['factoryWorkflow', 'product', 'factoryWorkflowAssets', "part('competitors', ['competitors'])"]) {
    assert.ok(
      sibling.includes(part) && start.includes(part),
      `형제 명령에는 있고 시작 버튼에는 없는 범위가 있습니다: ${part}`,
    );
  }
});

test('시작 흐름이 쓰는 나머지 경로도 정책에 있다', () => {
  // factoryStartNewWorkflowRun 이 openMarketSync 를 건드린다.
  // 이것이 빠지면 같은 방식으로 통째 폐기된다.
  assert.match(
    CORE_03,
    /factory\.openMarketSync\.cafe24RegistrationMode = 'create';/,
    '시작 흐름이 openMarketSync 를 쓰는 줄이 사라졌습니다.',
  );
  for (const command of ['factory/start:runDb', 'factory/db:runDb']) {
    assert.match(
      policyBlock(command),
      /part\('cafe24', \['openMarketSync'\]\)/,
      `${command} 에 openMarketSync 가 없으면 실행 시작만으로 커밋이 거절됩니다.`,
    );
  }
});

test('커밋 거절을 조용히 묻지 않는다', () => {
  // 이 침묵 때문에 원인을 찾는 데 하루가 걸렸다.
  // state.error 한 줄만 적고 끝나면 화면에도 로그에도 아무 말이 없다.
  const start = CORE_03.indexOf('function factoryRuntimeReportError(');
  assert.notEqual(start, -1);
  const block = CORE_03.slice(start, CORE_03.indexOf('\n}', start));
  assert.match(block, /console\.error\('\[factory\] 작업 저장 실패: '/);
  assert.match(block, /FACTORY_COMMAND_PATH_REJECTED\|STALE_FACTORY_/);
  assert.match(block, /작업 저장이 거절되어 이번 작업 내용이 반영되지 않았습니다/);
});

// 실제 판정 모듈로 돌려 본다. 문자열 검사만으로는 "정책이 실제로 통과시키는가" 를 못 지킨다.
const DATA_MODULE = path.join(ROOT, 'src/modules/factory-store-data.mjs');
const moduleUrl = `file://${DATA_MODULE.split(path.sep).join('/')}`;

// 실제 정책과 같은 모양으로 만든다: { 명령이름: { coordinator, targetPath, parts:[{owner,paths}] } }
function buildPolicy(parts) {
  return {
    'factory/start:runDb': { coordinator: 'factory', targetPath: 'factory', parts },
  };
}
const WORKFLOW = { owner: 'factory', paths: ['automation', 'goalRun', 'logs'] };
const PRODUCT = { owner: 'product-db', paths: ['product'] };
const COMPETITORS = { owner: 'competitors', paths: ['competitors'] };

// 수집이 성공했을 때 흐름이 실제로 만드는 변화를 그대로 흉내낸다.
const BEFORE = { product: { competitors: [] }, automation: {}, goalRun: {}, logs: [], competitors: {} };
const AFTER = {
  product: { competitors: [{ id: 'row1' }] },
  automation: { currentRunId: 'factory_work_run_x' },
  goalRun: { running: true },
  logs: [{ message: '수집' }],
  competitors: { compPage: { marketScrape: { results: [{ id: 'row1' }] } } },
};

test('실제 판정 모듈이 이 변경을 통과시킨다', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await import(moduleUrl);
  const policies = normalizeCommandPolicies(buildPolicy([WORKFLOW, PRODUCT, COMPETITORS]));
  const policy = policies.get('factory/start:runDb');
  assert.ok(policy, '정책 정규화 결과를 읽지 못했습니다.');
  assert.doesNotThrow(
    () => validateCommandDiff(policy, BEFORE, AFTER),
    '수집 성공 시의 변화가 정책에 걸립니다. 작업이 통째로 폐기됩니다.',
  );
});

test('competitors 를 빼면 실제로 거절된다 — 검사에 힘이 있다', async () => {
  const { normalizeCommandPolicies, validateCommandDiff } = await import(moduleUrl);
  const policies = normalizeCommandPolicies(buildPolicy([WORKFLOW, PRODUCT]));
  const policy = policies.get('factory/start:runDb');
  assert.throws(
    () => validateCommandDiff(policy, BEFORE, AFTER),
    /FACTORY_COMMAND_PATH_REJECTED/,
    '경로를 빼도 통과한다면 이 검사는 아무것도 지키지 못합니다.',
  );
});
