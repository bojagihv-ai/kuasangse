const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessHandoff,
  runtimeSourceDigest,
} = require('../../tools/verify_handoff_gate.cjs');

const CURRENT_SNAPSHOT = {
  files: {
    'app.html': { bytes: 10, sha256: 'a'.repeat(64) },
    'src/app-loader.js': { bytes: 20, sha256: 'b'.repeat(64) },
  },
};

function passingReport(overrides = {}) {
  return {
    schema: 'kuasangse.daily-regression.v1',
    profile: 'daily',
    startedAt: '2026-07-27T07:00:00.000Z',
    finishedAt: '2026-07-27T07:10:00.000Z',
    runtimeSourceSnapshot: CURRENT_SNAPSHOT,
    runtimeSourceDigest: runtimeSourceDigest(CURRENT_SNAPSHOT),
    summary: { total: 2, passed: 2, failed: 0, durationMs: 600000 },
    results: [
      { id: 'UNIT', passed: true },
      { id: 'BROWSER', passed: true },
    ],
    ...overrides,
  };
}

test('전체 회귀에 실패가 하나라도 있으면 정상 앱 인계가 차단된다', () => {
  const report = passingReport({
    summary: { total: 2, passed: 1, failed: 1, durationMs: 600000 },
    results: [
      { id: 'UNIT', passed: true },
      { id: 'BROWSER', passed: false },
    ],
  });

  const result = assessHandoff({
    report,
    currentSnapshot: CURRENT_SNAPSHOT,
    bundleVerified: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('REGRESSION_FAILED'));
});

test('검증 뒤 runtime source가 바뀌면 과거의 초록 보고서를 재사용할 수 없다', () => {
  const changedSnapshot = structuredClone(CURRENT_SNAPSHOT);
  changedSnapshot.files['app.html'].sha256 = 'c'.repeat(64);

  const result = assessHandoff({
    report: passingReport(),
    currentSnapshot: changedSnapshot,
    bundleVerified: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('RUNTIME_SOURCE_CHANGED'));
});

test('집중 fast 결과만으로는 정상 앱 인계를 승인하지 않는다', () => {
  const result = assessHandoff({
    report: passingReport({ profile: 'fast' }),
    currentSnapshot: CURRENT_SNAPSHOT,
    bundleVerified: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('FULL_PROFILE_REQUIRED'));
});

test('현재 source와 bundle에 묶인 전체 초록 보고서만 인계를 승인한다', () => {
  const result = assessHandoff({
    report: passingReport(),
    currentSnapshot: CURRENT_SNAPSHOT,
    bundleVerified: true,
  });

  assert.deepEqual(result, {
    ok: true,
    reasons: [],
    runtimeSourceDigest: runtimeSourceDigest(CURRENT_SNAPSHOT),
  });
});

test('실제 Chrome A+B read-back 증거가 없으면 인계를 승인하지 않는다', () => {
  const result = assessHandoff({
    report: passingReport(),
    currentSnapshot: CURRENT_SNAPSHOT,
    bundleVerified: true,
    requireActualChromeEvidence: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('ACTUAL_CHROME_EVIDENCE_MISSING'));
});
