const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MANUAL_EXTERNAL_GATES, RUNTIME_SOURCES, buildRegressionSteps } = require('./regression_manifest.cjs');
const {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
} = require('./runtime_source_guard.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_RANK = { fast: 0, daily: 1, full: 2 };

function argumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function cdpBasePort() {
  const port = Number.parseInt(process.env.KUASANGSE_CDP_BASE_PORT || '9460', 10);
  if (!Number.isInteger(port) || port < 1024 || port > 64000) {
    throw new Error(`invalid KUASANGSE_CDP_BASE_PORT: ${process.env.KUASANGSE_CDP_BASE_PORT}`);
  }
  return port;
}

function servicePort(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < 1024 || value > 64000) {
    throw new Error(`invalid ${name}: ${process.env[name]}`);
  }
  return value;
}

function frontendUrl() {
  return process.env.KUASANGSE_URL
    || `http://127.0.0.1:${servicePort('KUASANGSE_FRONTEND_PORT', 8081)}/app.html`;
}

function backendBase() {
  return process.env.KUASANGSE_BACKEND_BASE
    || `http://127.0.0.1:${servicePort('KUASANGSE_BACKEND_PORT', 5050)}`;
}

function retriesDisabled() {
  return process.argv.includes('--no-retry')
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.KUASANGSE_DISABLE_RETRY || '').toLowerCase());
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function findPython() {
  const candidates = [
    path.join(ROOT, 'backend', 'venv311', 'Scripts', 'python.exe'),
    path.join(ROOT, 'backend', 'venv', 'Scripts', 'python.exe'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || 'python';
}

async function urlIsReady(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await urlIsReady(url)) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

function startService(label, command, args, options, runDir) {
  const stdout = fs.createWriteStream(path.join(runDir, `${label}.out.log`));
  const stderr = fs.createWriteStream(path.join(runDir, `${label}.err.log`));
  const child = spawn(command, args, {
    cwd: ROOT,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  return { label, child, stdout, stderr };
}

async function ensureServices(pythonExe, runDir) {
  const started = [];
  const env = { ...process.env };
  delete env.SSL_CERT_FILE;
  const appUrl = frontendUrl();
  const apiBase = backendBase();
  const frontendPort = new URL(appUrl).port;
  const backendPort = new URL(apiBase).port;
  if (!await urlIsReady(appUrl)) {
    started.push(startService(`frontend-${frontendPort}`, pythonExe, [
      '-m', 'http.server', frontendPort, '--bind', '127.0.0.1',
    ], { env }, runDir));
    if (!await waitForUrl(appUrl)) {
      throw new Error(`frontend ${appUrl} startup failed`);
    }
  }
  if (!await urlIsReady(`${apiBase}/api/sections`)) {
    started.push(startService(`backend-${backendPort}`, pythonExe, ['backend/app.py'], {
      env: {
        ...env,
        PORT: backendPort,
        KUASANGSE_MAINTENANCE: '0',
        KUASANGSE_CORS_ORIGINS: new URL(appUrl).origin,
      },
    }, runDir));
    if (!await waitForUrl(`${apiBase}/api/sections`)) {
      throw new Error(`backend ${apiBase} startup failed`);
    }
  }
  return started;
}

function stopServices(services) {
  for (const service of services) {
    try { service.child.kill('SIGKILL'); } catch (_) {}
    service.stdout.end();
    service.stderr.end();
  }
}

function commandText(step) {
  return [step.command, ...step.args].map(value => {
    const text = String(value);
    return /\s/.test(text) ? `"${text}"` : text;
  }).join(' ');
}

function isBrowserStep(step) {
  return step.browser === true || (step.args || []).some(value => /cdp/i.test(String(value)));
}

function isRetryableInfrastructureFailure(step, result) {
  if (result.passed || !isBrowserStep(step)) return false;
  const output = String(result.tail || '');
  if (/Factory browser verification failed/i.test(output)) return false;
  if (result.timedOut === true) return true;
  return /CDP WebSocket error|CDP WebSocket closed|CDP command timed out|CDP page target not found|Page target not found|ERR_CONNECTION|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|SocketError: other side closed|waitFor timeout: !!\(window\./i.test(output);
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    if (!result.error) return;
  }
  try { child.kill('SIGKILL'); } catch (_) {}
}

function sourceMutationFailure(comparison) {
  const changed = comparison.changed.join(', ');
  return {
    id: 'SOURCE-MUTATION',
    area: '공통/실행 기준',
    title: '회귀 실행 중 소스 변경 차단',
    command: '(runtime source guard)',
    passed: false,
    exitCode: 1,
    timedOut: false,
    durationMs: 0,
    attemptCount: 1,
    logPath: '(회귀 실행기 내부 판정)',
    tail: `회귀 실행 중 다음 소스가 바뀌어 이후 결과를 신뢰할 수 없습니다: ${changed}`,
  };
}

async function runStepAttempt(step, index, runDir, attempt = 1) {
  const startedAt = Date.now();
  const retrySuffix = attempt > 1 ? `-retry-${attempt}` : '';
  const logPath = path.join(runDir, `${String(index + 1).padStart(2, '0')}-${step.id}${retrySuffix}.log`);
  const log = fs.createWriteStream(logPath);
  const env = {
    ...process.env,
    KUASANGSE_URL: frontendUrl(),
    KUASANGSE_BACKEND_BASE: backendBase(),
    KUASANGSE_BACKEND_URL: backendBase(),
    KUASANGSE_CDP_URL: `http://127.0.0.1:${cdpBasePort() + index + ((attempt - 1) * 1000)}`,
    KUASANGSE_CDP_COMMAND_TIMEOUT_MS: '45000',
  };
  for (const name of step.clearEnv || []) delete env[name];
  process.stdout.write(`\n[${step.id}] ${step.area} · ${step.title}${attempt > 1 ? ` · 재시도 ${attempt}` : ''}\n`);
  process.stdout.write(`$ ${commandText(step)}\n`);
  const child = spawn(step.command, step.args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let tail = '';
  const capture = chunk => {
    const text = String(chunk);
    tail = `${tail}${text}`.slice(-16000);
    log.write(text);
    process.stdout.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child);
  }, step.timeoutMs);
  const exitCode = await new Promise(resolve => {
    child.once('error', error => {
      capture(`${error.stack || error}\n`);
      resolve(1);
    });
    child.once('exit', code => resolve(code ?? 1));
  });
  clearTimeout(timer);
  log.end();
  const durationMs = Date.now() - startedAt;
  const passed = exitCode === 0 && !timedOut;
  process.stdout.write(`[${passed ? '통과' : '실패'}] ${step.id} · ${(durationMs / 1000).toFixed(1)}초\n`);
  return {
    ...step,
    command: commandText(step),
    passed,
    exitCode,
    timedOut,
    durationMs,
    attempt,
    logPath: path.relative(ROOT, logPath).replace(/\\/g, '/'),
    tail,
  };
}

async function runStep(step, index, runDir) {
  const startedAt = Date.now();
  const firstAttempt = await runStepAttempt(step, index, runDir, 1);
  const attempts = [firstAttempt];
  if (!retriesDisabled() && isRetryableInfrastructureFailure(step, firstAttempt)) {
    process.stdout.write(`[재시도] ${step.id} · 브라우저/CDP 시작 실패로 1회만 다시 실행합니다. 첫 로그는 보존됩니다.\n`);
    await waitForUrl(frontendUrl(), 15000);
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts.push(await runStepAttempt(step, index, runDir, 2));
  }
  const finalAttempt = attempts.at(-1);
  return {
    ...finalAttempt,
    durationMs: Date.now() - startedAt,
    retried: attempts.length > 1,
    attemptCount: attempts.length,
    attempts: attempts.map(result => ({
      attempt: result.attempt,
      passed: result.passed,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      logPath: result.logPath,
    })),
  };
}

function markdownReport(report) {
  const rows = report.results.map(result =>
    `| ${result.passed ? '통과' : '실패'} | ${result.id} | ${result.area} | ${result.title.replace(/\|/g, '/')} | ${result.attemptCount || 1}회 | ${(result.durationMs / 1000).toFixed(1)}초 | ${result.logPath} |`
  );
  const failures = report.results.filter(result => !result.passed).map(result =>
    `### ${result.id} ${result.title}\n\n\`\`\`text\n${result.tail.trim() || '(출력 없음)'}\n\`\`\``
  );
  return [
    '# 상세페이지 매일 회귀테스트 결과',
    '',
    `- 실행 프로필: ${report.profile}`,
    `- 시작: ${report.startedAt}`,
    `- 종료: ${report.finishedAt}`,
    `- 결과: ${report.summary.passed}/${report.summary.total} 통과, ${report.summary.failed} 실패`,
    `- 총 소요: ${(report.summary.durationMs / 1000).toFixed(1)}초`,
    '',
    '| 결과 | ID | 공정 | 검증 항목 | 시도 | 시간 | 최종 원문 로그 |',
    '|---|---|---|---|---:|---:|---|',
    ...rows,
    '',
    '## 자동 실행에서 제외한 실환경 검사',
    '',
    ...MANUAL_EXTERNAL_GATES.map(item => `- ${item}`),
    ...(failures.length ? ['', '## 정확한 실패 로그', '', ...failures] : []),
    '',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('사용법: node tools/run_daily_regression.cjs --profile fast|daily|full [--no-retry]');
    return;
  }
  const profile = argumentValue('--profile', 'daily');
  if (!(profile in PROFILE_RANK)) throw new Error(`unknown profile: ${profile}`);
  const startedAt = new Date();
  const reportRoot = path.join(ROOT, 'test-results', 'daily-regression');
  const runDir = path.join(reportRoot, safeTimestamp(startedAt));
  fs.mkdirSync(runDir, { recursive: true });
  const pythonExe = findPython();
  const steps = buildRegressionSteps(pythonExe).filter(step => PROFILE_RANK[step.tier] <= PROFILE_RANK[profile]);
  const sourceBaseline = captureRuntimeSourceSnapshot(ROOT, RUNTIME_SOURCES);
  const services = await ensureServices(pythonExe, runDir);
  const results = [];
  try {
    for (let index = 0; index < steps.length; index += 1) {
      const beforeStep = compareRuntimeSourceSnapshots(
        sourceBaseline,
        captureRuntimeSourceSnapshot(ROOT, RUNTIME_SOURCES),
      );
      if (!beforeStep.stable) {
        results.push(sourceMutationFailure(beforeStep));
        break;
      }
      results.push(await runStep(steps[index], index, runDir));
      const afterStep = compareRuntimeSourceSnapshots(
        sourceBaseline,
        captureRuntimeSourceSnapshot(ROOT, RUNTIME_SOURCES),
      );
      if (!afterStep.stable) {
        results.push(sourceMutationFailure(afterStep));
        break;
      }
    }
  } finally {
    stopServices(services);
  }
  const finishedAt = new Date();
  const passed = results.filter(result => result.passed).length;
  const report = {
    schema: 'kuasangse.daily-regression.v1',
    profile,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    results,
    manualExternalGates: MANUAL_EXTERNAL_GATES,
  };
  const jsonPath = path.join(runDir, 'report.json');
  const markdownPath = path.join(runDir, 'report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdownReport(report), 'utf8');
  fs.copyFileSync(jsonPath, path.join(reportRoot, 'latest.json'));
  fs.copyFileSync(markdownPath, path.join(reportRoot, 'latest.md'));
  console.log(`\n회귀테스트 보고서: ${markdownPath}`);
  if (report.summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
  isBrowserStep,
  isRetryableInfrastructureFailure,
};
