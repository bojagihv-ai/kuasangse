const FORMAT = 'pdp.migration.manifest';
const BACKUP_FORMAT = 'pdp.migration.backup';
const VERSION = 1;
const STORES = Object.freeze(['projects', 'snapshots', 'sessionAssets']);
const SAFE_BACKUP_REF = 'backup.json';

export class MigrationBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationBackupError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MigrationBackupError(code, message);
}

function clone(value) {
  return structuredClone(value);
}

function text(value, field) {
  const result = String(value ?? '').trim();
  if (!result) fail('INVALID_MANIFEST', `${field} is required`);
  return result;
}

function canonical(value, stack = new Set()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('UNSUPPORTED_VALUE', 'backup values must contain finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') fail('UNSUPPORTED_VALUE', `backup value type is unsupported: ${typeof value}`);
  if (stack.has(value)) fail('UNSUPPORTED_VALUE', 'backup values must not be cyclic');
  stack.add(value);
  const result = Array.isArray(value)
    ? `[${value.map(item => canonical(item, stack)).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], stack)}`).join(',')}}`;
  stack.delete(value);
  return result;
}

async function checksum(value) {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE', 'SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function entryKey(entry) {
  return `${entry.store}\u0000${entry.id}`;
}

async function readEntries(source) {
  if (!source || typeof source.getAll !== 'function') fail('INVALID_SOURCE', 'source.getAll is required');
  const entries = [];
  for (const store of STORES) {
    const records = await source.getAll(store);
    if (!Array.isArray(records)) fail('INVALID_SOURCE', `${store} must return an array`);
    for (const record of records) {
      if (!record || typeof record !== 'object') fail('INVALID_SOURCE', `${store} contains a non-record`);
      const value = clone(record);
      const id = text(value.id, `${store}.id`);
      entries.push(Object.freeze({ store, id, checksum: await checksum({ store, id, value }), value }));
    }
  }
  return entries;
}

async function backupChecksum(backup) {
  return checksum({
    format: backup.format, version: backup.version, product: backup.product,
    work: backup.work, target: backup.target,
    cutoverAt: backup.cutoverAt,
    entries: backup.entries.map(({ store, id, checksum: digest }) => ({ store, id, checksum: digest })),
  });
}

function assertBackupRef(value) {
  if (value !== SAFE_BACKUP_REF || value.includes('/') || value.includes('\\')) {
    fail('UNSAFE_BACKUP_REFERENCE', 'backupRef must be the fixed backup.json filename');
  }
}

function rowFrom(entry, target) {
  return { store: entry.store, id: entry.id, checksum: entry.checksum, target, status: 'pending' };
}

function assertRows(rows, target) {
  if (!Array.isArray(rows)) fail('INVALID_MANIFEST', 'manifest.rows must be an array');
  const seen = new Set();
  for (const row of rows) {
    if (!row || !STORES.includes(row.store) || !text(row.id, 'row.id') || !/^[a-f0-9]{64}$/.test(row.checksum)) {
      fail('INVALID_MANIFEST', 'manifest row is malformed');
    }
    if (row.target !== target || !['pending', 'exported'].includes(row.status) || seen.has(entryKey(row))) {
      fail('INVALID_MANIFEST', 'manifest row has an invalid target, status, or duplicate');
    }
    seen.add(entryKey(row));
  }
}

export function validateMigrationManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || manifest.format !== FORMAT || manifest.version !== VERSION) {
    fail('INVALID_MANIFEST', 'unsupported migration manifest');
  }
  text(manifest.product, 'product');
  text(manifest.work, 'work');
  const target = text(manifest.target, 'target');
  assertBackupRef(manifest.backupRef);
  if (!['pending', 'interrupted', 'complete'].includes(manifest.status)) fail('INVALID_MANIFEST', 'manifest status is invalid');
  if (manifest.status === 'complete' ? !Number.isFinite(manifest.cutoverAt) : manifest.cutoverAt !== null) {
    fail('INVALID_MANIFEST', 'cutoverAt does not match manifest status');
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.backupChecksum || '')) fail('INVALID_MANIFEST', 'backup checksum is invalid');
  assertRows(manifest.rows, target);
  return clone(manifest);
}

async function validateBackup(manifest, backup) {
  if (!backup || typeof backup !== 'object' || backup.format !== BACKUP_FORMAT || backup.version !== VERSION) {
    fail('INVALID_BACKUP', 'unsupported migration backup');
  }
  if (backup.product !== manifest.product || backup.work !== manifest.work || backup.target !== manifest.target) {
    fail('INVALID_BACKUP', 'backup identity does not match manifest');
  }
  if (backup.cutoverAt !== manifest.cutoverAt || (backup.cutoverAt !== null && !Number.isFinite(backup.cutoverAt))) {
    fail('INVALID_BACKUP', 'backup cutoverAt does not match the manifest');
  }
  if (!Array.isArray(backup.entries) || backup.entries.length !== manifest.rows.length) fail('INVALID_BACKUP', 'backup entries are incomplete');
  const rows = new Map(manifest.rows.map(row => [entryKey(row), row]));
  for (const entry of backup.entries) {
    const row = rows.get(entryKey(entry || {}));
    if (!row || entry.checksum !== row.checksum || entry.checksum !== await checksum({ store: entry.store, id: entry.id, value: entry.value })) {
      fail('CHECKSUM_MISMATCH', 'backup entry checksum does not match the manifest');
    }
  }
  if (backup.checksum !== manifest.backupChecksum || backup.checksum !== await backupChecksum(backup)) {
    fail('CHECKSUM_MISMATCH', 'backup set checksum does not match the manifest');
  }
  return clone(backup);
}

function assertResumeMatches(manifest, entries) {
  if (manifest.rows.length !== entries.length) fail('SOURCE_CHECKSUM_MISMATCH', 'source row count changed during migration');
  const expected = new Map(manifest.rows.map(row => [entryKey(row), row.checksum]));
  for (const entry of entries) {
    if (expected.get(entryKey(entry)) !== entry.checksum) fail('SOURCE_CHECKSUM_MISMATCH', 'source checksum changed during migration');
  }
}

async function publish(checkpoint, state) {
  if (typeof checkpoint === 'function') await checkpoint(clone(state));
}

export async function exportMigrationBackup({ source, product, work, target, now = () => Date.now(), resume = null, checkpoint } = {}) {
  const identity = { product: text(product, 'product'), work: text(work, 'work'), target: text(target, 'target') };
  const entries = await readEntries(source);
  let state;
  if (resume) {
    const manifest = validateMigrationManifest(resume.manifest);
    if (manifest.product !== identity.product || manifest.work !== identity.work || manifest.target !== identity.target) {
      fail('RESUME_IDENTITY_MISMATCH', 'resume identity does not match export request');
    }
    await validateBackup(manifest, resume.backup);
    assertResumeMatches(manifest, entries);
    state = { manifest, backup: clone(resume.backup) };
    if (manifest.status === 'complete') return clone(state);
  } else {
    const backup = { format: BACKUP_FORMAT, version: VERSION, ...identity, cutoverAt: null, entries: entries.map(entry => clone(entry)) };
    backup.checksum = await backupChecksum(backup);
    state = {
      manifest: {
        format: FORMAT, version: VERSION, ...identity, status: 'pending', cutoverAt: null,
        backupRef: SAFE_BACKUP_REF, backupChecksum: backup.checksum, rows: entries.map(entry => rowFrom(entry, identity.target)),
      },
      backup,
    };
  }
  try {
    await publish(checkpoint, state);
    for (const row of state.manifest.rows) {
      if (row.status === 'exported') continue;
      row.status = 'exported';
      await publish(checkpoint, state);
    }
    const cutoverAt = Number(now());
    if (!Number.isFinite(cutoverAt)) fail('INVALID_CUTOVER', 'cutover clock must return a finite timestamp');
    state.manifest.status = 'complete';
    state.manifest.cutoverAt = cutoverAt;
    state.backup.cutoverAt = cutoverAt;
    state.backup.checksum = await backupChecksum(state.backup);
    state.manifest.backupChecksum = state.backup.checksum;
    await publish(checkpoint, state);
    return clone(state);
  } catch (error) {
    state.manifest.status = 'interrupted';
    state.manifest.cutoverAt = null;
    state.backup.cutoverAt = null;
    state.backup.checksum = await backupChecksum(state.backup);
    state.manifest.backupChecksum = state.backup.checksum;
    try { await publish(checkpoint, state); } catch (_) { /* retain the original interruption */ }
    throw error;
  }
}

export async function restoreMigrationBackup({ manifest, backup, destination } = {}) {
  const verifiedManifest = validateMigrationManifest(manifest);
  if (verifiedManifest.status !== 'complete' || !verifiedManifest.rows.every(row => row.status === 'exported')) {
    fail('INCOMPLETE_BACKUP', 'only a complete backup may be restored');
  }
  if (!destination || typeof destination.get !== 'function' || typeof destination.put !== 'function') {
    fail('INVALID_DESTINATION', 'destination.get and destination.put are required');
  }
  const verifiedBackup = await validateBackup(verifiedManifest, backup);
  let restored = 0;
  for (const entry of verifiedBackup.entries) {
    const existing = await destination.get(entry.store, entry.id);
    if (existing !== null && existing !== undefined) {
      if (await checksum({ store: entry.store, id: entry.id, value: existing }) !== entry.checksum) {
        fail('DESTINATION_CONFLICT', `destination already contains a different ${entry.store}/${entry.id} record`);
      }
      continue;
    }
    await destination.put(entry.store, clone(entry.value));
    restored += 1;
  }
  return Object.freeze({ restored, backupChecksum: verifiedBackup.checksum });
}

export const MIGRATION_BACKUP_STORES = STORES;
