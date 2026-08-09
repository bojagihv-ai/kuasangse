import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const AUTHORITY = 'pdp-sync-queue:v1';
const FORBIDDEN_KEY = /(?:authorization|service.?key|secret|password|access.?token|refresh.?token|api.?key)/i;

export class PdpSyncQueueError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = 'PdpSyncQueueError';
    this.code = code;
    this.details = details;
  }
}

function plainObject(value, code = 'invalid_queue_value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PdpSyncQueueError(code);
  }
  return value;
}

function safeJson(value, pathName = '$') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => safeJson(item, `${pathName}[${index}]`));
  const input = plainObject(value);
  const output = {};
  for (const [key, child] of Object.entries(input)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new PdpSyncQueueError('secret_forbidden', { path: `${pathName}.${key}` });
    }
    output[key] = safeJson(child, `${pathName}.${key}`);
  }
  return output;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function parseCommand(command) {
  const value = plainObject(command, 'invalid_command');
  for (const key of ['operation', 'assetKey', 'idempotencyKey']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      throw new PdpSyncQueueError('invalid_command', { path: `$.${key}` });
    }
  }
  const payload = safeJson(value.payload);
  return {
    operation: value.operation,
    assetKey: value.assetKey,
    idempotencyKey: value.idempotencyKey,
    payload,
    payloadDigest: digest(payload),
  };
}

function copy(value) {
  return structuredClone(value);
}

export async function createPdpSyncQueue({ filePath } = {}) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new PdpSyncQueueError('file_path_missing');
  }
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  let document;
  try {
    document = JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new PdpSyncQueueError('queue_read_failed');
    document = { authority: AUTHORITY, entries: [] };
  }
  if (document.authority !== AUTHORITY || !Array.isArray(document.entries)) {
    throw new PdpSyncQueueError('queue_document_invalid');
  }

  async function persist() {
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, absolutePath);
  }

  async function enqueue(command) {
    const parsed = parseCommand(command);
    const idempotent = document.entries.find(entry => entry.idempotencyKey === parsed.idempotencyKey);
    if (idempotent && idempotent.payloadDigest !== parsed.payloadDigest) {
      throw new PdpSyncQueueError('idempotency_conflict', {
        idempotencyKey: parsed.idempotencyKey,
      });
    }
    const duplicate = document.entries.find(entry => (
      entry.operation === parsed.operation
      && entry.assetKey === parsed.assetKey
      && entry.payloadDigest === parsed.payloadDigest
    ));
    if (duplicate) return copy(duplicate);
    const entry = {
      id: randomUUID(),
      ...parsed,
      status: 'pending',
      attempts: 0,
      checkpoint: null,
      receipt: null,
      lastError: null,
    };
    document.entries.push(entry);
    await persist();
    return copy(entry);
  }

  async function replay(executor, { signal } = {}) {
    if (typeof executor !== 'function') throw new PdpSyncQueueError('executor_missing');
    const completed = [];
    for (const entry of document.entries.filter(item => item.status === 'pending')) {
      if (signal?.aborted) throw new PdpSyncQueueError('replay_cancelled');
      entry.attempts += 1;
      entry.lastError = null;
      await persist();
      const checkpoint = async value => {
        entry.checkpoint = safeJson(value);
        await persist();
      };
      try {
        entry.receipt = safeJson(await executor(copy(entry), Object.freeze({ checkpoint })));
        entry.status = 'succeeded';
        await persist();
        completed.push(copy(entry));
      } catch (error) {
        entry.status = 'pending';
        entry.lastError = {
          code: typeof error?.code === 'string' ? error.code : 'replay_failed',
          status: Number.isInteger(error?.status) ? error.status : null,
        };
        await persist();
        throw error;
      }
    }
    return completed;
  }

  async function cleanup() {
    const before = document.entries.length;
    document.entries = document.entries.filter(entry => entry.status !== 'succeeded');
    await persist();
    return { removed: before - document.entries.length, remaining: document.entries.length };
  }

  return Object.freeze({
    enqueue,
    replay,
    cleanup,
    list: async () => copy(document.entries),
  });
}
