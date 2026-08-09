const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXCLUDED_SOURCE_PATHS = ['.omo/', '.debug-artifacts/', 'output/local-archive/', 'test-results/', 'output/playwright/'];

function git(root, args) {
  return childProcess.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function isExcludedSource(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return EXCLUDED_SOURCE_PATHS.some((prefix) => normalized.startsWith(prefix))
    || normalized.endsWith('.log') || normalized.includes('/logs/');
}

function fileHash(root, relativePath) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) && fs.statSync(file).isFile()
    ? git(root, ['hash-object', '--no-filters', '--', relativePath]).trim()
    : '<deleted>';
}

function sourceIdentity(root) {
  const changed = git(root, ['-c', 'core.safecrlf=false', 'diff', '--name-only', '-z', 'HEAD']).split('\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  const entries = [...new Set([...changed, ...untracked].filter(Boolean))]
    .filter((relativePath) => !isExcludedSource(relativePath))
    .sort()
    .map((relativePath) => `${relativePath}\0${fileHash(root, relativePath)}`);
  return {
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    dirtyFingerprint: crypto.createHash('sha256').update(entries.join('\n')).digest('hex'),
    includedPaths: entries.map((entry) => entry.slice(0, entry.indexOf('\0'))),
    excludedPathRules: EXCLUDED_SOURCE_PATHS.concat(['*.log', '*/logs/*']),
  };
}

function codeTokens(line) {
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
}

function parsePlan(planText) {
  const lines = planText.replace(/\r/g, '').split('\n');
  const rows = [];
  let section = '';
  let current;
  for (const line of lines) {
    if (/^##\s+/.test(line)) section = line;
    const task = line.match(/^- \[([ xX])\]\s+((?:\d+|F[1-4]))\.\s*(.+)$/);
    if (task) {
      if (current) rows.push(current);
      current = { id: task[2], checked: task[1].toLowerCase() === 'x', title: task[3], section, lines: [line] };
    } else if (current) current.lines.push(line);
  }
  if (current) rows.push(current);
  const wanted = new Set([...Array(13).keys()].map((index) => String(index + 3)).concat(['F1', 'F2', 'F3', 'F4']));
  const selected = rows.filter((row) => wanted.has(row.id));
  const missing = [...wanted].filter((id) => !selected.some((row) => row.id === id));
  return { rows: selected, missing };
}

function resolveEvidence(token, options, evidenceRoot) {
  if (token.includes('<attemptDir>')) {
    if (!evidenceRoot) return { token, resolved: '', problem: 'placeholder_evidence_root_required' };
    return { token, resolved: path.resolve(evidenceRoot, token.replace('<attemptDir>', '').replace(/^[/\\]+/, '')) };
  }
  return { token, resolved: path.resolve(options.root, token.replaceAll('\\', path.sep)) };
}

function commandChecks(lines, root) {
  const text = lines.filter((line) => /도구·명령|완료 조건:|QA 시나리오:|^- \[/.test(line)).join('\n');
  const checks = [];
  for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    checks.push({ kind: 'package-script', value: match[1], exists: Boolean(packageJson.scripts?.[match[1]]) });
  }
  for (const match of text.matchAll(/node(?:\.exe)?\s+--test\s+([^`\n;]+)/g)) {
    for (const candidate of match[1].trim().split(/\s+/).filter((value) => value.includes('/'))) {
      checks.push({ kind: 'test-path', value: candidate, exists: fs.existsSync(path.resolve(root, candidate)) });
    }
  }
  for (const match of text.matchAll(/pytest(?:\s+-\w+)*\s+([^`\n;]+)/g)) {
    for (const candidate of match[1].trim().split(/\s+/).filter((value) => /(?:test_|_test\.|tests?\/)/.test(value))) {
      checks.push({ kind: 'test-path', value: candidate, exists: fs.existsSync(path.resolve(root, candidate.replaceAll('\\', path.sep))) });
    }
  }
  return checks;
}

function planChecks(row, options) {
  const referenceLines = row.lines.filter((line) => /^\s*참조:/.test(line));
  const evidenceValues = row.lines.flatMap((line) => {
    const field = /(?:^|\s)(?:완료 증거(?:\([^)]*\))?|증거):\s*/.exec(line);
    return field ? [line.slice(field.index + field[0].length)] : [];
  });
  const anchors = referenceLines.flatMap(codeTokens).map((token) => {
    const source = token.replace(/:\d+(?:-\d+)?$/, '');
    const resolved = path.isAbsolute(source) ? source : path.resolve(options.root, source.replaceAll('\\', path.sep));
    return { value: token, exists: fs.existsSync(resolved) };
  });
  const mapping = options.mapping?.tasks?.[row.id] || options.mapping?.[row.id] || options.mapping || {};
  const evidenceRoot = mapping.evidenceRoot ? path.resolve(options.root, mapping.evidenceRoot) : options.evidenceRoot;
  const evidence = evidenceValues.flatMap(codeTokens).filter((token) => token.includes('<attemptDir>') || /[/\\]/.test(token))
    .map((token) => ({ ...resolveEvidence(token, options, evidenceRoot), exists: false }));
  for (const item of evidence) item.exists = Boolean(item.resolved && fs.existsSync(item.resolved) && fs.statSync(item.resolved).size > 0);
  return { anchors, commands: commandChecks(row.lines, options.root), evidence };
}

function terminalHistory(ledger, plan, id) {
  if (!fs.existsSync(ledger)) return [];
  const planName = path.relative(path.dirname(path.dirname(ledger)), plan).replaceAll('\\', '/');
  return fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).filter((entry) => String(entry.plan || '').replaceAll('\\', '/').endsWith(planName)
    && new RegExp(`^${id}(?:$|[-\\s])`).test(String(entry.task || '')))
    .map((entry) => ({ entry, verdict: entry.verdict || (entry.event === 'task-blocked' ? 'blocked' : entry.event === 'task-completed' ? 'confirmed' : '') }))
    .filter((item) => ['confirmed', 'needs-fix', 'blocked', 'in-progress', 'partial-confirmed'].includes(item.verdict));
}

function writeReports(result, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'coverage.json'), `${JSON.stringify(result, null, 2)}\n`);
  const lines = ['# Control Tower Plan Coverage', '', '| Row | Checked | Verdict | Problems |', '| --- | --- | --- | --- |'];
  for (const row of result.rows) lines.push(`| ${row.id} | ${row.checked ? 'yes' : 'no'} | ${row.latestVerdict || 'none'} | ${row.problems.join(', ') || 'none'} |`);
  lines.push('', `mapped=${result.summary.mapped} unmapped=${result.summary.unmapped} unverified=${result.summary.unverified} staleEvidence=${result.summary.staleEvidence} blocked=${result.summary.blocked}`, '');
  fs.writeFileSync(path.join(reportDir, 'coverage.md'), lines.join('\n'));
}

function coverageHasFailures(summary) {
  return ['unmapped', 'unverified', 'staleEvidence', 'blocked']
    .some((key) => Number(summary?.[key] || 0) !== 0);
}

function verifyCoverage(options) {
  const parsed = parsePlan(fs.readFileSync(options.plan, 'utf8'));
  const identity = sourceIdentity(options.root);
  const rows = parsed.rows.map((row) => {
    const checks = planChecks(row, options);
    const history = terminalHistory(options.ledger, options.plan, row.id);
    const latest = history.at(-1);
    const receiptArtifact = latest?.entry.artifact ? path.resolve(options.root, latest.entry.artifact.replaceAll('\\', path.sep)) : '';
    const receiptArtifactExists = Boolean(receiptArtifact && fs.existsSync(receiptArtifact) && fs.statSync(receiptArtifact).size > 0);
    const problems = [];
    if (!row.checked) problems.push('unchecked');
    if (!checks.anchors.length) problems.push('missing_plan_anchor');
    if (!checks.commands.length) problems.push('missing_test_command');
    if (!checks.evidence.length) problems.push('missing_evidence_reference');
    if (checks.anchors.some((item) => !item.exists)) problems.push('missing_code_anchor');
    if (checks.commands.some((item) => !item.exists)) problems.push('missing_command_target');
    if (checks.evidence.some((item) => item.problem || !item.exists)) problems.push('missing_evidence');
    if (!latest) problems.push('missing_confirmed_receipt');
    if (latest && !receiptArtifactExists) problems.push('missing_receipt_artifact');
    if (latest && latest.verdict !== 'confirmed') problems.push(`receipt_${latest.verdict}`);
    const identityMissing = latest?.verdict === 'confirmed' && (!latest.entry.source_head || !latest.entry.source_dirty_fingerprint);
    const identityMismatch = latest?.verdict === 'confirmed' && !identityMissing
      && (latest.entry.source_head !== identity.head || latest.entry.source_dirty_fingerprint !== identity.dirtyFingerprint);
    if (identityMissing) problems.push('receipt_identity_missing');
    if (identityMismatch) problems.push('receipt_identity_mismatch');
    const mapped = row.checked && checks.anchors.length > 0 && checks.commands.length > 0 && checks.evidence.length > 0;
    return {
      id: row.id, title: row.title, checked: row.checked, mapped, unmapped: !mapped,
      unverified: !latest || latest.verdict !== 'confirmed' || !receiptArtifactExists || checks.anchors.some((item) => !item.exists) || checks.commands.some((item) => !item.exists) || checks.evidence.some((item) => item.problem || !item.exists) || identityMissing || identityMismatch,
      staleEvidence: Boolean(identityMissing || identityMismatch),
      blocked: ['needs-fix', 'blocked', 'in-progress'].includes(latest?.verdict),
      latestVerdict: latest?.verdict || '', receiptArtifact, receiptHistory: history.map((item) => item.verdict), checks, problems,
    };
  });
  for (const id of parsed.missing) rows.push({ id, checked: false, mapped: false, unmapped: true, unverified: true, staleEvidence: false, blocked: false, latestVerdict: '', receiptHistory: [], checks: {}, problems: ['missing_plan_heading'] });
  const summary = Object.fromEntries(['mapped', 'unmapped', 'unverified', 'staleEvidence', 'blocked'].map((key) => [key, rows.filter((row) => row[key]).length]));
  const result = { summary, identity, rows };
  if (options.reportDir) writeReports(result, options.reportDir);
  return result;
}

module.exports = { coverageHasFailures, parsePlan, sourceIdentity, verifyCoverage };
