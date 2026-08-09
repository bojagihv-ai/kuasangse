const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const verifier = require('../../tools/verify_control_tower_plan_coverage.cjs');

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

test('Given complete synthetic plan and superseded needs-fix receipt When verifying coverage Then current confirmed receipts exit zero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-tower-coverage-'));
  const evidenceRoot = path.join(root, '.omo', 'evidence', 'batch');
  const plan = path.join(root, '.omo', 'plans', 'batch.md');
  const ledger = path.join(root, '.omo', 'start-work', 'ledger.jsonl');
  const reportDir = path.join(root, 'reports');
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'coverage@example.test']);
    git(root, ['config', 'user.name', 'Coverage']);
    write(path.join(root, 'README.md'), 'fixture\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-qm', 'fixture']);

    const rows = [...Array(13).keys()].map((index) => index + 3).concat(['F1', 'F2', 'F3', 'F4']);
    const planRows = rows.map((id) => {
      const slug = String(id).toLowerCase();
      write(path.join(root, 'src', `task-${slug}.js`), `module.exports = '${id}';\n`);
      write(path.join(root, 'tests', `task-${slug}.test.cjs`), "require('node:assert').ok(true);\n");
      write(path.join(evidenceRoot, `task-${slug}`, 'receipt.json'), '{"ok":true}\n');
      return `- [x] ${id}. synthetic ${id}\n  참조: \`src/task-${slug}.js\`\n  완료 조건: \`node --test tests/task-${slug}.test.cjs\`\n  증거: \`<attemptDir>/task-${slug}/receipt.json\``;
    });
    write(plan, `## 작업 목록\n${planRows.slice(0, 13).join('\n\n')}\n\n## 최종 검증 웨이브\n${planRows.slice(13).join('\n\n')}\n`);
    write(path.join(root, '.debug-artifacts', 'volatile.txt'), 'not source\n');
    const identity = verifier.sourceIdentity(root);
    const receipts = rows.flatMap((id) => {
      const completed = { event: 'task-completed', plan: '.omo/plans/batch.md', task: String(id), verdict: 'confirmed', source_head: identity.head, source_dirty_fingerprint: identity.dirtyFingerprint, artifact: `.omo/evidence/batch/task-${String(id).toLowerCase()}/receipt.json` };
      return id === 3 ? [{ ...completed, verdict: 'needs-fix' }, completed] : [completed];
    });
    write(ledger, `${receipts.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const result = verifier.verifyCoverage({ root, plan, evidenceRoot, ledger, reportDir });

    assert.deepEqual(result.summary, { mapped: 17, unmapped: 0, unverified: 0, staleEvidence: 0, blocked: 0 });
    assert.equal(result.rows.find((row) => row.id === '3').latestVerdict, 'confirmed');
    assert.deepEqual(result.rows.find((row) => row.id === '3').receiptHistory, ['needs-fix', 'confirmed']);
    assert.equal(result.identity.includedPaths.includes('.debug-artifacts/volatile.txt'), false);
    assert.equal(fs.existsSync(path.join(reportDir, 'coverage.json')), true);
    assert.equal(fs.existsSync(path.join(reportDir, 'coverage.md')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Given a relevant sparse file larger than Node readFileSync supports When fingerprinting Then the hash is calculated without buffering the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-tower-coverage-large-'));
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'coverage@example.test']);
    git(root, ['config', 'user.name', 'Coverage']);
    write(path.join(root, 'README.md'), 'fixture\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-qm', 'fixture']);
    const largeFile = path.join(root, 'large-fixture.bin');
    write(largeFile, '');
    fs.truncateSync(largeFile, 2 ** 31);

    const identity = verifier.sourceIdentity(root);

    assert.equal(identity.includedPaths.includes('large-fixture.bin'), true);
    assert.match(identity.dirtyFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Given same-line command and evidence fields When verifying F1 Then only the evidence field value is parsed as evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-tower-coverage-fields-'));
  const evidenceRoot = path.join(root, '.omo', 'evidence', 'batch');
  const plan = path.join(root, '.omo', 'plans', 'batch.md');
  const actualEvidence = '<attemptDir>/final-f1/coverage.json';
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'coverage@example.test']);
    git(root, ['config', 'user.name', 'Coverage']);
    write(path.join(root, 'README.md'), 'fixture\n');
    write(path.join(root, 'package.json'), '{"scripts":{"verify:control-tower:coverage":"node verifier.cjs"}}\n');
    write(path.join(evidenceRoot, 'final-f1', 'coverage.json'), '{"ok":true}\n');
    write(plan, `## 최종 검증 웨이브
- [ ] F1. 도구·명령: \`npm run verify:control-tower:coverage -- --plan .omo/plans/batch.md --evidence <attemptDir>\`. 설명의 evidence 단어는 경로가 아닙니다. 증거: \`${actualEvidence}\`.
`);
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-qm', 'fixture']);

    const result = verifier.verifyCoverage({
      root,
      plan,
      evidenceRoot,
      ledger: path.join(root, '.omo', 'start-work', 'ledger.jsonl'),
    });
    const row = result.rows.find((candidate) => candidate.id === 'F1');

    assert.deepEqual(row.checks.evidence.map((item) => item.token), [actualEvidence]);
    assert.equal(row.checks.commands.some((item) => item.value === 'verify:control-tower:coverage'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Given every row is mapped and no coverage gaps remain When evaluating the gate Then mapped rows do not fail the gate', () => {
  assert.equal(verifier.coverageHasFailures({
    mapped: 17,
    unmapped: 0,
    unverified: 0,
    staleEvidence: 0,
    blocked: 0,
  }), false);
  assert.equal(verifier.coverageHasFailures({
    mapped: 16,
    unmapped: 1,
    unverified: 1,
    staleEvidence: 0,
    blocked: 0,
  }), true);
});
