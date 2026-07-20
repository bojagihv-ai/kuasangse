const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  assertSafeSectionGuardTempDir,
  buildSectionGuardChecks,
  buildSectionGuardSeed,
  minimalSectionGuardSnapshot,
} = require('./factory_section_guard_harness_utils.cjs');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'last-work-section-guard-v227.json');
function isolatedSectionGuardBackendSource(rootDir) {
  const backendDir = path.join(rootDir, 'backend');
  return `
import os
import sys
import types
from pathlib import Path

backend_dir = Path(${JSON.stringify(backendDir)}).resolve()
data_dir = Path(os.environ["KUASANGSE_SAVE07_DATA_DIR"]).resolve()
sys.path.insert(0, str(backend_dir))

pipeline_module = types.ModuleType("services.pipeline")
pipeline_module.pipeline = None
sys.modules["services.pipeline"] = pipeline_module

from flask import Flask
from config import Config
from routes.api_shared import api
from routes import api_archive, api_workspace_lock
from services.workspace_lock_service import WorkspaceLockService

last_work_dir = data_dir / "last-work"
archive_root = data_dir / "local-archive"
last_work_dir.mkdir(parents=True, exist_ok=True)
archive_root.mkdir(parents=True, exist_ok=True)
api_archive._LAST_WORK_SCOPED_DIR = str(last_work_dir)
api_workspace_lock._SERVICE = WorkspaceLockService((data_dir / "authority.json").resolve())
Config.LOCAL_ARCHIVE_FOLDER = str(archive_root)
api_archive.Config.LOCAL_ARCHIVE_FOLDER = str(archive_root)
api_archive._LOCAL_ARCHIVE_INDEX_PATH = str(archive_root / "index.json")

app = Flask(__name__)
app.register_blueprint(api, url_prefix="/api")
app.run(host="127.0.0.1", port=int(os.environ["PORT"]), debug=False, use_reloader=False)
`;
}
function pythonExecutable() {
  const configured = String(process.env.KUASANGSE_SAVE07_PYTHON || '').trim();
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`SAVE-07 configured Python runtime not found: ${configured}`);
    return configured;
  }
  const bundled = path.join(ROOT, 'backend', 'venv311', 'Scripts', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;
  throw new Error(`SAVE-07 Python runtime not found: ${bundled}`);
}

async function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForLoopbackPortRelease(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const free = await new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

function launchIsolatedSectionGuardBackend(tempDir, port) {
  const proc = spawn(pythonExecutable(), ['-c', isolatedSectionGuardBackendSource(ROOT)], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...process.env,
      PORT: String(port),
      KUASANGSE_SAVE07_DATA_DIR: tempDir,
      KUASANGSE_MAINTENANCE: '0',
      FLASK_DEBUG: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  let spawnError = null;
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-12000); });
  const exited = new Promise(resolve => {
    proc.once('error', error => {
      spawnError = error;
      resolve({ code: null, signal: null, error });
    });
    proc.once('exit', (code, signal) => resolve({ code, signal, error: null }));
  });
  return { proc, exited, baseUrl: `http://127.0.0.1:${port}`, diagnostics: () => ({ pid: proc.pid, exitCode: proc.exitCode, signalCode: proc.signalCode, spawnError: spawnError?.message || '', stderr: stderr.trim() }) };
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text || '{}'); } catch (_) { body = { raw: text }; }
  return { status: response.status, body };
}

async function waitForBackend(runtime, workspaceId, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const diagnostics = runtime.diagnostics();
    if (diagnostics.spawnError || runtime.proc.exitCode !== null) throw new Error(`SAVE-07 backend exited early: ${JSON.stringify(diagnostics)}`);
    try {
      const response = await requestJson(runtime.baseUrl, `/api/last-work?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (response.status === 200 && response.body?.ok === true) return response;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`SAVE-07 backend readiness timeout: ${JSON.stringify(runtime.diagnostics())}`);
}

async function stopIsolatedSectionGuardBackend(runtime) {
  if (!runtime?.proc || runtime.proc.exitCode !== null) return true;
  if (runtime.diagnostics().spawnError) return true;
  runtime.proc.kill('SIGTERM');
  await Promise.race([runtime.exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (runtime.proc.exitCode === null) {
    runtime.proc.kill('SIGKILL');
    await runtime.exited;
  }
  return runtime.proc.exitCode !== null || runtime.proc.signalCode !== null;
}

function safeRemoveSectionGuardTempDir(tempDir) {
  const resolved = assertSafeSectionGuardTempDir(tempDir);
  fs.rmSync(resolved, { recursive: true, force: true });
  return !fs.existsSync(resolved);
}

async function postSnapshot(baseUrl, seed, lease, snapshot) {
  return requestJson(baseUrl, `/api/last-work?workspaceId=${encodeURIComponent(seed.workspaceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: seed.workspaceId,
      snapshot,
      force: true,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      expectedRevision: 1,
      revision: 2,
    }),
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seed = buildSectionGuardSeed(Date.now());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-save07-'));
  let runtime = null;
  let port = 0;
  let proof = null;
  let failure = null;
  const cleanup = { backendStopped: false, portReleased: false, tempRemoved: false, errors: [] };

  try {
    port = await reserveLoopbackPort();
    runtime = launchIsolatedSectionGuardBackend(tempDir, port);
    await waitForBackend(runtime, seed.workspaceId);
    const leaseResponse = await requestJson(runtime.baseUrl, '/api/workspace-lock/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: seed.workspaceId, ownerId: seed.ownerId, sessionId: seed.sessionId, ttlMs: 120000 }),
    });
    const lease = leaseResponse.body;
    if (leaseResponse.status !== 200 || lease?.granted !== true) throw new Error(`SAVE-07 lease failed: ${JSON.stringify(leaseResponse)}`);
    const seedResponse = await requestJson(runtime.baseUrl, `/api/last-work?workspaceId=${encodeURIComponent(seed.workspaceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: seed.workspaceId, snapshot: seed.snapshot, leaseId: lease.leaseId, fencingToken: lease.fencingToken, expectedRevision: 0, revision: 1 }),
    });
    if (seedResponse.status !== 200 || seedResponse.body?.accepted !== true) throw new Error(`SAVE-07 seed failed: ${JSON.stringify(seedResponse)}`);
    const sectionDrop = await postSnapshot(runtime.baseUrl, seed, lease, minimalSectionGuardSnapshot(seed.snapshot, { dropSections: true }));
    const identityDrift = await postSnapshot(runtime.baseUrl, seed, lease, minimalSectionGuardSnapshot(seed.snapshot, { productKey: `${seed.productKey}-잘못된-등록명` }));
    const incompleteBootstrap = await postSnapshot(runtime.baseUrl, seed, lease, minimalSectionGuardSnapshot(seed.snapshot, { dropSections: true, incompleteIdentity: true }));
    const after = await requestJson(runtime.baseUrl, `/api/last-work?workspaceId=${encodeURIComponent(seed.workspaceId)}`);
    proof = { lease, seedResponse, sectionDrop, identityDrift, incompleteBootstrap, after };
  } catch (error) {
    failure = error;
  } finally {
    try {
      cleanup.backendStopped = await stopIsolatedSectionGuardBackend(runtime);
      cleanup.portReleased = await waitForLoopbackPortRelease(port);
    } catch (error) {
      cleanup.errors.push({ stage: 'backend-stop', error: error?.stack || String(error) });
      failure = failure || error;
    }
    try {
      cleanup.tempRemoved = safeRemoveSectionGuardTempDir(tempDir);
    } catch (error) {
      cleanup.errors.push({ stage: 'temp-remove', error: error?.stack || String(error) });
      failure = failure || error;
    }
  }

  const completeProof = { ...(proof || {}), expected: seed, runtime: { port }, cleanup };
  const checks = Object.values(buildSectionGuardChecks(completeProof));
  const result = { ok: !failure && checks.every(check => check.ok), proof: completeProof, checks };
  if (failure) result.error = failure?.stack || String(failure);
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  if (failure) throw failure;
  const failed = checks.filter(check => !check.ok);
  if (failed.length) throw new Error(`SAVE-07 section guard failed:\n- ${failed.map(check => check.message).join('\n- ')}`);
  const after = completeProof.after?.body || {};
  console.log(JSON.stringify({
    ok: result.ok,
    checks: { passed: checks.filter(check => check.ok).length, total: checks.length },
    rejected: {
      sectionDrop: completeProof.sectionDrop?.body?.accepted === false,
      identityDrift: completeProof.identityDrift?.body?.accepted === false,
      incompleteBootstrap: completeProof.incompleteBootstrap?.body?.accepted === false,
    },
    preserved: {
      revision: after.revision,
      sectionImages: Object.keys(after.snapshot?.assets?.sectionImages || {}).length,
      sectionContents: Object.keys(after.snapshot?.assets?.sectionContents || {}).length,
    },
    runtime: completeProof.runtime,
    cleanup,
  }, null, 2));
}

module.exports = {
  launchIsolatedSectionGuardBackend,
  main,
  safeRemoveSectionGuardTempDir,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
