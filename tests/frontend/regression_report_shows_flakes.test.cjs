'use strict';

// 계약: **재시도로 통과한 검사와, 원래 자주 흔들리는 검사가 보고서에 남는다.**
//
// 왜: 재시도가 붙은 뒤로 표에는 '통과' 만 남는다. 그러면
//   (가) 오늘 처음 깨진 진짜 회귀와
//   (나) 원래 열 번에 한 번 깨지던 검사가
// 똑같이 보인다. 실측 2026-09-02: GENERATE-01 이 손대기 전 기준선에서도 9번 중 1번
// 실패했는데 그 사실이 어디에도 없어서, 병합본에서 같은 실패를 보고 "내가 깨뜨렸나" 를
// 처음부터 다시 조사했다. 그 조사가 통째로 낭비였다 - 전수 진단 #25.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const RUNNER = path.join(__dirname, '..', '..', 'tools', 'run_daily_regression.cjs');
const source = fs.readFileSync(RUNNER, 'utf8');

// 러너는 실행되면 브라우저를 띄우므로 require 하지 않는다. 필요한 함수만 떼어 쓴다.
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 러너에 없습니다`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} 함수의 끝을 찾지 못했습니다`);
  return source.slice(start, end + 2);
}

const sandbox = { fs, path, MANUAL_EXTERNAL_GATES: ['(수동 게이트)'] };
// eslint-disable-next-line no-new-func
const load = new Function('fs', 'path', 'MANUAL_EXTERNAL_GATES',
  `${extract('readRecentRunHistory')}
   ${extract('summarizeFlakiness')}
   ${extract('markdownReport')}
   return { readRecentRunHistory, summarizeFlakiness, markdownReport };`);
const { readRecentRunHistory, summarizeFlakiness, markdownReport } =
  load(sandbox.fs, sandbox.path, sandbox.MANUAL_EXTERNAL_GATES);

function baseReport(results, flakiness = new Map()) {
  return {
    profile: 'daily',
    startedAt: '2026-09-02T00:00:00.000Z',
    finishedAt: '2026-09-02T00:10:00.000Z',
    summary: { total: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, durationMs: 600000 },
    results,
    flakiness,
  };
}

test('재시도 끝에 통과한 검사는 첫 실패 이유와 함께 남는다', () => {
  const report = baseReport([
    {
      id: 'GENERATE-01', area: '5 조립공장', title: '생성 진행', passed: true,
      attemptCount: 2, durationMs: 8000, logPath: 'x.log', tail: '',
      attempts: [
        { attempt: 1, passed: false, tail: 'CDP WebSocket closed\n[FAIL] 첫 시도가 이렇게 죽었다' },
        { attempt: 2, passed: true, tail: '[PASS]' },
      ],
    },
  ]);
  const markdown = markdownReport(report);
  assert.match(markdown, /이번에 한 번 넘어졌다가 통과한 검사/);
  assert.match(markdown, /GENERATE-01/);
  assert.match(markdown, /첫 시도가 이렇게 죽었다/, '첫 시도의 실패 이유가 보고서에 있어야 합니다');
});

test('한 번에 통과한 검사만 있으면 흔들림 절이 아예 없다', () => {
  const markdown = markdownReport(baseReport([
    { id: 'DB-01', area: '1 제품/DB', title: '조회', passed: true, attemptCount: 1, durationMs: 900, logPath: 'y.log', tail: '', attempts: [] },
  ]));
  assert.doesNotMatch(markdown, /넘어졌다가 통과/, '조용한 날에는 없는 절을 만들지 않습니다');
});

test('최근 이력에서 자주 깨진 검사가 표로 남는다', () => {
  const flakiness = new Map([
    ['GENERATE-01', { runs: 9, failed: 1, wobbled: 2 }],
    ['DB-01', { runs: 9, failed: 0, wobbled: 0 }],
  ]);
  const markdown = markdownReport(baseReport([
    { id: 'GENERATE-01', area: '5 조립공장', title: '생성 진행', passed: true, attemptCount: 1, durationMs: 900, logPath: 'z.log', tail: '', attempts: [] },
  ], flakiness));
  assert.match(markdown, /최근 실행 이력에서 자주 흔들린 검사/);
  assert.match(markdown, /GENERATE-01[^\n]*1회 실패[^\n]*2회 흔들림/);
  // 한 번도 안 흔들린 검사로 표를 채우지 않는다 - 175줄 표를 또 만들면 아무도 안 본다.
  assert.doesNotMatch(markdown.split('자주 흔들린 검사')[1] || '', /DB-01/);
});

test('이력 집계는 실패와 재시도-후-통과를 따로 센다', () => {
  const counts = summarizeFlakiness([
    { name: 'r1', results: [{ id: 'A', passed: false, attemptCount: 2 }] },
    { name: 'r2', results: [{ id: 'A', passed: true, attemptCount: 2 }] },
    { name: 'r3', results: [{ id: 'A', passed: true, attemptCount: 1 }] },
  ]);
  assert.deepEqual(counts.get('A'), { runs: 3, failed: 1, wobbled: 1 });
});

test('과거 보고서가 깨져 있어도 이번 실행을 막지 않는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-history-'));
  fs.mkdirSync(path.join(root, '2026-09-01T000000'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026-09-01T000000', 'report.json'), '{ 이건 JSON 이 아니다', 'utf8');
  fs.mkdirSync(path.join(root, '2026-09-02T000000'), { recursive: true });
  fs.writeFileSync(path.join(root, '2026-09-02T000000', 'report.json'),
    JSON.stringify({ results: [{ id: 'B', passed: false, attemptCount: 1 }] }), 'utf8');

  const history = readRecentRunHistory(root, 10);
  assert.equal(history.length, 1, '읽히는 보고서만 표본에 넣습니다');
  assert.equal(summarizeFlakiness(history).get('B').failed, 1);

  // 폴더가 아예 없어도 던지지 않는다.
  assert.deepEqual(readRecentRunHistory(path.join(root, '없는폴더'), 10), []);
  fs.rmSync(root, { recursive: true, force: true });
});
