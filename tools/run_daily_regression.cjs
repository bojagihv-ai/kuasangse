const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MANUAL_EXTERNAL_GATES, RUNTIME_SOURCES, buildRegressionSteps } = require('./regression_manifest.cjs');
const {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
  runtimeSourceDigest,
} = require('./runtime_source_guard.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_RANK = { fast: 0, daily: 1, full: 2 };
const DETAIL_04_FIXTURE_MANIFEST_PATH = path.join(ROOT, 'tests', 'fixtures', 'detail-04', 'manifest.json');
const DETAIL_04_SOURCE_IMAGE_REL = 'output/local-archive/workfiles/draft_lastwork_mrj2stm7_g44a9b__28f7940b4c65/assets/슬라브나비수저집/factory_work_run_mrlatnkr_mwj9f6/4314552_9j_4UFYRXhpZgAASUkqAAgAAAAMAA8BAgAGAAAAngAAABABAgAPAAAAp/section-images/section_competitive_edge/160540_비교_우위_(Competitive_Edge)_섹션_결과_section_archive_co/image.jpg';

function argumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function cdpBasePort(env = process.env) {
  const port = Number.parseInt(env.KUASANGSE_CDP_BASE_PORT || '9460', 10);
  if (!Number.isInteger(port) || port < 1024 || port > 64000) {
    throw new Error(`invalid KUASANGSE_CDP_BASE_PORT: ${env.KUASANGSE_CDP_BASE_PORT}`);
  }
  return port;
}

function canBindTcpPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailableCdpBasePort(stepCount, requestedPort = cdpBasePort()) {
  const browserPortSpan = Math.max(16, Number(stepCount) || 0);
  const offsets = [
    ...Array.from({ length: browserPortSpan }, (_, index) => index),
    ...Array.from({ length: browserPortSpan }, (_, index) => 1000 + index),
    2001,
  ];
  for (let basePort = requestedPort; basePort + 2001 <= 64000; basePort += browserPortSpan) {
    let available = true;
    for (const offset of offsets) {
      if (!await canBindTcpPort(basePort + offset)) {
        available = false;
        break;
      }
    }
    if (available) return basePort;
  }
  throw new Error(`no free daily CDP port range starting at ${requestedPort}`);
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

function sha256(filePath) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function taskOwnedRuntimeRoot(root, runDir) {
  if (!String(root || '').trim() || !String(runDir || '').trim()) {
    throw new Error('DETAIL-04 fixture requires an explicit task-owned runtime root');
  }
  const resolvedRoot = path.resolve(root);
  const expectedRoot = path.resolve(runDir, 'task-owned-runtime');
  if (samePath(resolvedRoot, ROOT) || !samePath(resolvedRoot, expectedRoot)) {
    throw new Error(`invalid DETAIL-04 task-owned runtime root: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

function taskOwnedPath(root, relativePath, label) {
  const resolved = path.resolve(root, ...String(relativePath || '').split('/'));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`invalid DETAIL-04 ${label}: ${relativePath}`);
  }
  return resolved;
}

function prepareDetail04Fixture({
  root,
  runDir,
  fixtureRoot = path.dirname(DETAIL_04_FIXTURE_MANIFEST_PATH),
  env = process.env,
} = {}) {
  if (String(env.KUASANGSE_TASK_OWNED_RUNTIME || '') !== '1') {
    throw new Error('DETAIL-04 fixture requires KUASANGSE_TASK_OWNED_RUNTIME=1');
  }
  const runtimeRoot = taskOwnedRuntimeRoot(root, runDir);
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schema !== 'kuasangse.detail-04.fixture.v1'
    || manifest.targetRelativePath !== DETAIL_04_SOURCE_IMAGE_REL
    || !/^[A-F0-9]{64}$/.test(String(manifest.fixtureSha256 || ''))
    || manifest.sourceArchiveSha256 !== manifest.fixtureSha256
  ) {
    throw new Error(`invalid DETAIL-04 fixture manifest: ${manifestPath}`);
  }
  const sourcePath = taskOwnedPath(fixtureRoot, manifest.fixtureRelativePath, 'fixture path');
  const targetPath = taskOwnedPath(runtimeRoot, manifest.targetRelativePath, 'target path');
  const sourceFixtureSha256 = sha256(sourcePath);
  if (sourceFixtureSha256 !== manifest.fixtureSha256) {
    throw new Error(`DETAIL-04 fixture SHA-256 mismatch: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o444);
  const copiedFixtureSha256 = sha256(targetPath);
  if (copiedFixtureSha256 !== manifest.fixtureSha256) {
    throw new Error(`DETAIL-04 copied fixture SHA-256 mismatch: ${targetPath}`);
  }
  const receipt = {
    schema: 'kuasangse.detail-04.isolated-fixture.v1',
    targetRelativePath: manifest.targetRelativePath,
    sourceFixtureSha256,
    copiedFixtureSha256,
    readOnly: true,
  };
  fs.writeFileSync(path.join(runDir, 'detail04-fixture-manifest.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

function prepareTaskOwnedDailyFixture({ runDir, runtime, env = process.env } = {}) {
  if (String(env.KUASANGSE_TASK_OWNED_RUNTIME || '') !== '1') return null;
  return prepareDetail04Fixture({ root: runtime?.runtimeRoot, runDir, env });
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

const STATIC_CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

function staticFileForRequest(requestUrl, runtimeRoot = '') {
  const pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://127.0.0.1').pathname)
    .replace(/\\/g, '/');
  const relativePath = pathname.replace(/^\/+/, '') || 'app.html';
  if (runtimeRoot && relativePath.startsWith('output/local-archive/')) {
    const runtimeFile = taskOwnedPath(runtimeRoot, relativePath, 'static archive path');
    if (fs.existsSync(runtimeFile)) return runtimeFile;
  }
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) return null;
  return filePath;
}

async function startTaskOwnedStaticServer(runDir, requestedPort = 0, runtimeRoot = '') {
  const stdout = fs.createWriteStream(path.join(runDir, 'task-owned-daily-frontend.out.log'));
  const stderr = fs.createWriteStream(path.join(runDir, 'task-owned-daily-frontend.err.log'));
  const server = http.createServer((request, response) => {
    const filePath = staticFileForRequest(request.url, runtimeRoot);
    if (!filePath) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    if (!stat.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
      'Content-Type': STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()]
        || 'application/octet-stream',
      'X-Kuasangse-Test-Server': 'task-owned-daily-frontend',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', error => {
      stderr.write(`${error.stack || error}\n`);
      response.destroy(error);
    });
    stream.pipe(response);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({
        host: '127.0.0.1',
        port: requestedPort,
        exclusive: true,
      }, resolve);
    });
  } catch (error) {
    stdout.end();
    stderr.end();
    throw error;
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  stdout.write(`listening=http://127.0.0.1:${port}/app.html\n`);
  return {
    label: 'task-owned-daily-frontend',
    server,
    stdout,
    stderr,
    port,
  };
}

async function startTaskOwnedDailyServices(pythonExe, runDir, selectedCdpBasePort = cdpBasePort()) {
  const backendPort = servicePort('KUASANGSE_DAILY_BACKEND_PORT', selectedCdpBasePort + 2001);
  const apiBase = `http://127.0.0.1:${backendPort}`;
  if (await urlIsReady(`${apiBase}/api/sections`)) {
    throw new Error(`daily task-owned backend port is already occupied: ${backendPort}`);
  }
  const runtimeRoot = path.join(runDir, 'task-owned-runtime');
  const archiveRoot = path.join(runtimeRoot, 'archive');
  const stateRoot = path.join(runtimeRoot, 'state');
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  const detail04Fixture = prepareTaskOwnedDailyFixture({
    runDir,
    runtime: { runtimeRoot },
    env: { KUASANGSE_TASK_OWNED_RUNTIME: '1' },
  });
  const requestedFrontendPort = process.env.KUASANGSE_DAILY_FRONTEND_PORT
    ? servicePort('KUASANGSE_DAILY_FRONTEND_PORT', 0)
    : 0;
  const services = [];
  try {
    const frontend = await startTaskOwnedStaticServer(runDir, requestedFrontendPort, runtimeRoot);
    services.push(frontend);
    const frontendPort = frontend.port;
    const appUrl = `http://127.0.0.1:${frontendPort}/app.html`;
  const env = {
    ...process.env,
    KUASANGSE_URL: appUrl,
    KUASANGSE_FRONTEND_PORT: String(frontendPort),
    KUASANGSE_BACKEND_BASE: apiBase,
    KUASANGSE_BACKEND_URL: apiBase,
    KUASANGSE_BACKEND_PORT: String(backendPort),
    KUASANGSE_CDP_BASE_PORT: String(selectedCdpBasePort),
    KUASANGSE_LOCAL_ARCHIVE_FOLDER: archiveRoot,
    KUASANGSE_LOCAL_STATE_FOLDER: stateRoot,
    KUASANGSE_TASK_OWNED_RUNTIME: '1',
    KUASANGSE_DETAIL_04_RUNTIME_ROOT: runtimeRoot,
  };
  delete env.SSL_CERT_FILE;
    services.push(startService('task-owned-daily-backend', pythonExe, ['backend/app.py'], {
      env: {
        ...env,
        PORT: String(backendPort),
        KUASANGSE_MAINTENANCE: '0',
        KUASANGSE_CORS_ORIGINS: new URL(appUrl).origin,
      },
    }, runDir));
    if (!await waitForUrl(appUrl) || !await waitForUrl(`${apiBase}/api/sections`)) {
      throw new Error('daily task-owned services failed readiness');
    }
    process.stdout.write(
      `[daily-runtime] frontend=${appUrl} backend=${apiBase} archive=${archiveRoot} state=${stateRoot}\n`,
    );
    return { services, env, runtimeRoot, detail04Fixture };
  } catch (error) {
    await stopServices(services);
    throw error;
  }
}

async function stopServices(services) {
  for (const service of services) {
    if (service.server) {
      await new Promise(resolve => service.server.close(resolve));
    } else {
      terminateProcessTree(service.child);
    }
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
  // 파일 이름에 'cdp' 가 들어 있는지로 가르면, 실제로 브라우저를 띄우는 검사 상당수가
  // 인프라 실패 재시도를 못 받는다 - 전수 진단 #24 (실측 2026-09-02: daily 프로파일의
  // CDP 도구 27개가 여기서 빠졌다. DB-07·DRAFT-NET-01/02·NAV-01·CUTS-RATCHET-01 포함).
  // 그러면 백엔드 기동 지연이나 CDP 포트 충돌 같은 환경 흔들림이 '앱 실패' 로 보고돼
  // 조사 시간을 먹고, 반복되면 사람이 빨간 줄을 믿지 않게 된다.
  // 이름이 아니라 **실제로 브라우저 하네스를 쓰는지**로 가른다.
  if (step.browser === true) return true;
  const args = (step.args || []).map(value => String(value));
  if (args.some(value => /cdp/i.test(value))) return true;
  const file = args.find(value => /\.cjs$/i.test(value));
  if (!file) return false;
  try {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    // '도우미를 가져다 쓴다' 가 아니라 '실제로 브라우저에 붙는다' 가 기준이다.
    // UNIT-FE-02 는 factory_cdp_test_utils 를 require 하지만 순수 함수만 검사한다 -
    // 그런 것까지 인프라 재시도 대상으로 넣으면 진짜 실패를 두 번 돌리게 된다.
    return /(?:ensureCdp|connectCdp)\s*\(/.test(source);
  } catch (_) {
    return false;
  }
}

function isRetryableInfrastructureFailure(step, result) {
  if (result.passed || !isBrowserStep(step)) return false;
  const output = String(result.tail || '');
  if (/Factory browser verification failed/i.test(output)) return false;
  if (result.timedOut === true) return true;
  return /CDP WebSocket error|CDP WebSocket closed|CDP command timed out|CDP page target not found|Page target not found|ERR_CONNECTION|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|SocketError: other side closed|Failed to fetch|fetch failed|waitFor timeout:[\s\S]{0,800}(?:classicRuntimeHydrationReady|typeof state === ['"]object['"]|window\.(?:state|__kuasangseState))/i.test(output);
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

async function runStepAttempt(step, index, runDir, attempt = 1, runtimeEnv = {}) {
  const startedAt = Date.now();
  const retrySuffix = attempt > 1 ? `-retry-${attempt}` : '';
  const logPath = path.join(runDir, `${String(index + 1).padStart(2, '0')}-${step.id}${retrySuffix}.log`);
  const log = fs.createWriteStream(logPath);
  const env = {
    ...process.env,
    KUASANGSE_URL: frontendUrl(),
    KUASANGSE_BACKEND_BASE: backendBase(),
    KUASANGSE_BACKEND_URL: backendBase(),
    KUASANGSE_CDP_URL: `http://127.0.0.1:${cdpBasePort(runtimeEnv) + index + ((attempt - 1) * 1000)}`,
    KUASANGSE_CDP_COMMAND_TIMEOUT_MS: process.env.KUASANGSE_DAILY_CDP_COMMAND_TIMEOUT_MS || '45000',
    ...runtimeEnv,
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

async function runStep(step, index, runDir, runtimeEnv) {
  const startedAt = Date.now();
  const attempts = [];
  const firstAttempt = await runStepAttempt(step, index, runDir, 1, runtimeEnv);
  attempts.push(firstAttempt);
  if (!retriesDisabled() && isRetryableInfrastructureFailure(step, firstAttempt)) {
    process.stdout.write(`[재시도] ${step.id} · 브라우저/CDP 시작 실패로 1회만 다시 실행합니다. 첫 로그는 보존됩니다.\n`);
    await waitForUrl(runtimeEnv.KUASANGSE_URL || frontendUrl(), 15000);
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts.push(await runStepAttempt(step, index, runDir, 2, runtimeEnv));
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

// 지난 실행들의 report.json 을 읽어 **어떤 검사가 자주 흔들리는지** 센다.
// 왜 필요한가: 재시도로 통과하면 표에는 '통과' 만 남는다. 그러면 늘 흔들리는 검사와
// 오늘 처음 깨진 검사가 같아 보여, 진짜 회귀를 흔들림으로 넘겨버리게 된다.
// 실측 2026-09-02: GENERATE-01 이 기준선에서도 9번 중 1번 실패했는데, 그 사실이
// 어디에도 남지 않아 "내 수정이 깨뜨렸나" 를 매번 처음부터 조사했다.
function readRecentRunHistory(reportRoot, limit = 10) {
  const history = [];
  let entries = [];
  try {
    entries = fs.readdirSync(reportRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .reverse()
      .slice(0, limit);
  } catch (_) {
    return history;
  }
  for (const name of entries) {
    try {
      const raw = fs.readFileSync(path.join(reportRoot, name, 'report.json'), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.results)) history.push({ name, results: parsed.results });
    } catch (_) {
      // 읽히지 않는 과거 보고서는 조용히 건너뛴다. 이력은 참고용이지 판정 근거가 아니다.
    }
  }
  return history;
}

function summarizeFlakiness(history) {
  const byId = new Map();
  for (const run of history) {
    for (const result of run.results) {
      const id = String(result?.id || '');
      if (!id) continue;
      const entry = byId.get(id) || { runs: 0, failed: 0, wobbled: 0 };
      entry.runs += 1;
      if (result.passed === false) entry.failed += 1;
      else if ((result.attemptCount || 1) > 1) entry.wobbled += 1;
      byId.set(id, entry);
    }
  }
  return byId;
}

function markdownReport(report) {
  const rows = report.results.map(result =>
    `| ${result.passed ? '통과' : '실패'} | ${result.id} | ${result.area} | ${result.title.replace(/\|/g, '/')} | ${result.attemptCount || 1}회 | ${(result.durationMs / 1000).toFixed(1)}초 | ${result.logPath} |`
  );
  const failures = report.results.filter(result => !result.passed).map(result =>
    `### ${result.id} ${result.title}\n\n\`\`\`text\n${result.tail.trim() || '(출력 없음)'}\n\`\`\``
  );
  // 이번 실행에서 한 번 넘어졌다가 통과한 것 - 표에서는 '통과' 로만 보인다.
  const wobbled = report.results.filter(result => result.passed && (result.attemptCount || 1) > 1);
  const wobbleSection = wobbled.length
    ? ['', '## 이번에 한 번 넘어졌다가 통과한 검사', '',
       '아래는 최종적으로 통과했지만 첫 시도에서 실패한 것들입니다.',
       '환경 흔들림일 수도 있고, 가끔만 나오는 진짜 고장일 수도 있습니다.', '',
       ...wobbled.map(result => {
         const first = (result.attempts || [])[0] || {};
         const reason = String(first.tail || '').trim().split('\n').slice(-6).join('\n');
         return `### ${result.id} ${result.title}\n\n첫 시도 실패 이유:\n\n\`\`\`text\n${reason || '(출력 없음)'}\n\`\`\``;
       })]
    : [];

  const flakyRows = [];
  for (const [id, entry] of (report.flakiness || new Map())) {
    if (entry.failed === 0 && entry.wobbled === 0) continue;
    const known = report.results.find(result => result.id === id);
    flakyRows.push(`| ${id} | ${known ? known.title.replace(/\|/g, '/') : '(이번 실행에 없음)'} `
      + `| ${entry.failed}회 실패 | ${entry.wobbled}회 흔들림 | 최근 ${entry.runs}회 중 |`);
  }
  const historySection = flakyRows.length
    ? ['', '## 최근 실행 이력에서 자주 흔들린 검사', '',
       '오늘 처음 깨진 것인지, 원래 가끔 깨지던 것인지 구별하는 데 씁니다.', '',
       '| ID | 검증 항목 | 실패 | 재시도 후 통과 | 표본 |',
       '|---|---|---:|---:|---:|',
       ...flakyRows]
    : [];

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
    ...wobbleSection,
    ...historySection,
    '',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('사용법: node tools/run_daily_regression.cjs --profile fast|daily|full [--ids DB-04,FIELD-03] [--no-retry]');
    return;
  }
  const profile = argumentValue('--profile', 'daily');
  if (!(profile in PROFILE_RANK)) throw new Error(`unknown profile: ${profile}`);
  const selectedIds = new Set(
    argumentValue('--ids', '').split(',').map(value => value.trim()).filter(Boolean),
  );
  const startedAt = new Date();
  const reportRoot = path.join(ROOT, 'test-results', 'daily-regression');
  const runDir = path.join(reportRoot, safeTimestamp(startedAt));
  fs.mkdirSync(runDir, { recursive: true });
  const pythonExe = findPython();
  const steps = buildRegressionSteps(pythonExe)
    .filter(step => PROFILE_RANK[step.tier] <= PROFILE_RANK[profile])
    .filter(step => !selectedIds.size || selectedIds.has(step.id));
  if (selectedIds.size && steps.length !== selectedIds.size) {
    const found = new Set(steps.map(step => step.id));
    const missing = [...selectedIds].filter(id => !found.has(id));
    throw new Error(`unknown or unavailable regression ids: ${missing.join(', ')}`);
  }
  const sourceBaseline = captureRuntimeSourceSnapshot(ROOT, RUNTIME_SOURCES);
  const selectedCdpBasePort = await findAvailableCdpBasePort(steps.length);
  const runtime = await startTaskOwnedDailyServices(pythonExe, runDir, selectedCdpBasePort);
  const results = [];
  const detail04Fixture = runtime.detail04Fixture;
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
      results.push(await runStep(steps[index], index, runDir, runtime.env));
      const browserSettleMs = Math.max(0, Number(process.env.KUASANGSE_DAILY_BROWSER_SETTLE_MS || 0) || 0);
      if (browserSettleMs > 0 && isBrowserStep(steps[index])) {
        await new Promise(resolve => setTimeout(resolve, browserSettleMs));
      }
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
    await stopServices(runtime.services);
  }
  const finishedAt = new Date();
  const passed = results.filter(result => result.passed).length;
  const report = {
    schema: 'kuasangse.daily-regression.v1',
    profile,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    runtimeSourceSnapshot: sourceBaseline,
    runtimeSourceDigest: runtimeSourceDigest(sourceBaseline),
    detail04Fixture,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    results,
    manualExternalGates: MANUAL_EXTERNAL_GATES,
  };
  // 이력은 **이번 실행을 저장하기 전에** 읽는다. 안 그러면 자기 자신을 표본에 넣는다.
  report.flakiness = summarizeFlakiness(readRecentRunHistory(reportRoot, 10));
  const jsonPath = path.join(runDir, 'report.json');
  const markdownPath = path.join(runDir, 'report.md');
  // Map 은 JSON.stringify 로 {} 가 된다. 저장본에는 평범한 객체로 남긴다.
  const storable = { ...report, flakiness: Object.fromEntries(report.flakiness) };
  fs.writeFileSync(jsonPath, `${JSON.stringify(storable, null, 2)}\n`, 'utf8');
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
  findAvailableCdpBasePort,
  isBrowserStep,
  isRetryableInfrastructureFailure,
  prepareDetail04Fixture,
  prepareTaskOwnedDailyFixture,
  startTaskOwnedDailyServices,
  startTaskOwnedStaticServer,
  stopServices,
};
