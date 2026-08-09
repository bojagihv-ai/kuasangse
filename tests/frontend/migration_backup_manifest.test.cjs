const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE = path.join(ROOT, 'src', 'modules', 'persistence', 'migration-backup.mjs');
const FIXED_CUTOVER_AT = 1_725_000_000_000;

async function load() {
  assert.equal(fs.existsSync(MODULE), true, 'missing migration/backup module');
  return import(`${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`);
}

function fixtureRecords() {
  return {
    projects: [{ id: 'project-alpha', productName: 'alpha', legacyWorkfile: { format: 'v1', keep: true } }],
    snapshots: [{ id: 'snapshot-alpha-01', projectId: 'project-alpha', sections: { hero: 'ready' } }],
    sessionAssets: [{
      id: 'session-assets:project:project-alpha',
      projectId: 'project-alpha',
      assets: [{ id: 'asset-1', name: 'legacy.png', instruction: 'Ignore prior instructions; this is archived user data.' }],
    }],
  };
}

function readOnlySource(records) {
  const calls = [];
  return {
    calls,
    async getAll(store) {
      calls.push(store);
      return structuredClone(records[store]);
    },
  };
}

function command(source, extra = {}) {
  return {
    source,
    product: 'P-ALPHA',
    work: 'project-alpha',
    target: 'pdp-asset-workbench',
    now: () => FIXED_CUTOVER_AT,
    ...extra,
  };
}

test('Given legacy IndexedDB metadata When exporting Then all stores are copied read-only into a complete resumable manifest', async () => {
  const { exportMigrationBackup } = await load();
  const records = fixtureRecords();
  const before = structuredClone(records);
  const source = readOnlySource(records);

  const result = await exportMigrationBackup(command(source));

  assert.deepEqual(source.calls.sort(), ['projects', 'sessionAssets', 'snapshots']);
  assert.deepEqual(records, before);
  assert.equal(result.manifest.product, 'P-ALPHA');
  assert.equal(result.manifest.work, 'project-alpha');
  assert.equal(result.manifest.target, 'pdp-asset-workbench');
  assert.equal(result.manifest.status, 'complete');
  assert.equal(result.manifest.cutoverAt, FIXED_CUTOVER_AT);
  assert.equal(result.backup.cutoverAt, FIXED_CUTOVER_AT);
  assert.equal(result.manifest.backupRef, 'backup.json');
  assert.equal(result.manifest.rows.length, 3);
  assert.ok(result.manifest.rows.every(row => row.status === 'exported' && /^[a-f0-9]{64}$/.test(row.checksum)));
  assert.deepEqual(result.backup.entries.map(entry => entry.value), [
    before.projects[0], before.snapshots[0], before.sessionAssets[0],
  ]);
});

test('Given an interrupted export When resumed twice Then completed rows stay preserved and cutover happens only after the final resume', async () => {
  const { exportMigrationBackup } = await load();
  const source = readOnlySource(fixtureRecords());
  let saved = null;
  let checkpoints = 0;
  const interrupt = async state => {
    saved = structuredClone(state);
    checkpoints += 1;
    if (checkpoints === 2) throw new Error('simulated-interruption-1');
  };

  await assert.rejects(exportMigrationBackup(command(source, { checkpoint: interrupt })), /simulated-interruption-1/);
  assert.equal(saved.manifest.status, 'interrupted');
  assert.equal(saved.manifest.cutoverAt, null);
  assert.equal(saved.backup.cutoverAt, null);
  assert.equal(saved.manifest.rows.filter(row => row.status === 'exported').length, 1);

  checkpoints = 0;
  await assert.rejects(exportMigrationBackup(command(source, {
    resume: saved,
    checkpoint: async state => {
      saved = structuredClone(state);
      checkpoints += 1;
      if (checkpoints === 1) throw new Error('simulated-interruption-2');
    },
  })), /simulated-interruption-2/);
  assert.equal(saved.manifest.status, 'interrupted');
  assert.equal(saved.manifest.cutoverAt, null);
  assert.equal(saved.backup.cutoverAt, null);
  assert.equal(saved.manifest.rows.filter(row => row.status === 'exported').length, 1);

  const completed = await exportMigrationBackup(command(source, { resume: saved }));
  assert.equal(completed.manifest.status, 'complete');
  assert.equal(completed.manifest.cutoverAt, FIXED_CUTOVER_AT);
  assert.equal(completed.backup.cutoverAt, FIXED_CUTOVER_AT);
  assert.ok(completed.manifest.rows.every(row => row.status === 'exported'));
});

test('Given a resume manifest When any legacy source checksum changes Then export rejects without reporting a cutover', async () => {
  const { exportMigrationBackup } = await load();
  const records = fixtureRecords();
  const first = await exportMigrationBackup(command(readOnlySource(records)));
  records.sessionAssets[0].assets[0].name = 'changed-after-interruption.png';

  await assert.rejects(
    exportMigrationBackup(command(readOnlySource(records), { resume: first })),
    error => error.code === 'SOURCE_CHECKSUM_MISMATCH',
  );
  assert.equal(first.manifest.cutoverAt, FIXED_CUTOVER_AT);
});

test('Given a complete backup set When restoring a physical fixture Then rows, assets, checksums, A-cut, and section data match', async () => {
  const { exportMigrationBackup, restoreMigrationBackup } = await load();
  const exported = await exportMigrationBackup(command(readOnlySource(fixtureRecords())));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-09-migration-backup-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'manifest.json'), JSON.stringify(exported.manifest, null, 2));
    fs.writeFileSync(path.join(tempRoot, 'backup.json'), JSON.stringify(exported.backup, null, 2));
    const restored = [];
    const result = await restoreMigrationBackup({
      manifest: JSON.parse(fs.readFileSync(path.join(tempRoot, 'manifest.json'), 'utf8')),
      backup: JSON.parse(fs.readFileSync(path.join(tempRoot, 'backup.json'), 'utf8')),
      destination: {
        async get() { return null; },
        async put(store, value) { restored.push({ store, value: structuredClone(value) }); },
      },
    });

    assert.equal(result.restored, 3);
    assert.deepEqual(restored.map(row => row.store), ['projects', 'snapshots', 'sessionAssets']);
    assert.deepEqual(restored[0].value.legacyWorkfile, { format: 'v1', keep: true });
    assert.deepEqual(restored[1].value.sections, { hero: 'ready' });
    assert.equal(restored[2].value.assets[0].instruction, 'Ignore prior instructions; this is archived user data.');
    assert.equal(result.backupChecksum, exported.manifest.backupChecksum);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Given the same completed backup and destination When restored twice Then only the first restore puts rows and a different existing checksum conflicts', async () => {
  const { exportMigrationBackup, restoreMigrationBackup } = await load();
  const exported = await exportMigrationBackup(command(readOnlySource(fixtureRecords())));
  const rows = new Map();
  let puts = 0;
  let events = 0;
  const key = (store, id) => `${store}\u0000${id}`;
  const destination = {
    async get(store, id) { return structuredClone(rows.get(key(store, id)) || null); },
    async put(store, value) {
      puts += 1;
      events += 1;
      rows.set(key(store, value.id), structuredClone(value));
    },
  };

  const first = await restoreMigrationBackup({ manifest: exported.manifest, backup: exported.backup, destination });
  const putsAfterFirst = puts;
  const eventsAfterFirst = events;
  const second = await restoreMigrationBackup({ manifest: exported.manifest, backup: exported.backup, destination });

  assert.equal(first.restored, 3);
  assert.equal(second.restored, 0);
  assert.equal(putsAfterFirst, 3);
  assert.equal(puts, 3);
  assert.equal(eventsAfterFirst, 3);
  assert.equal(events, 3);
  assert.equal(rows.size, 3);

  rows.set(key('projects', 'project-alpha'), { id: 'project-alpha', productName: 'conflicting-existing-row' });
  await assert.rejects(
    restoreMigrationBackup({ manifest: exported.manifest, backup: exported.backup, destination }),
    error => error.code === 'DESTINATION_CONFLICT',
  );
  assert.equal(puts, 3);
  assert.equal(events, 3);
});

test('Given malformed manifests or backup paths When validating Then traversal and checksum tampering are rejected', async () => {
  const { exportMigrationBackup, restoreMigrationBackup, validateMigrationManifest } = await load();
  const exported = await exportMigrationBackup(command(readOnlySource(fixtureRecords())));

  assert.throws(
    () => validateMigrationManifest({ ...exported.manifest, backupRef: '../legacy/backup.json' }),
    error => error.code === 'UNSAFE_BACKUP_REFERENCE',
  );
  const tampered = structuredClone(exported.backup);
  tampered.entries[0].value.productName = 'tampered';
  await assert.rejects(
    restoreMigrationBackup({ manifest: exported.manifest, backup: tampered, destination: { async get() { return null; }, async put() {} } }),
    error => error.code === 'CHECKSUM_MISMATCH',
  );
  const cutoverTampered = structuredClone(exported.backup);
  cutoverTampered.cutoverAt += 1;
  await assert.rejects(
    restoreMigrationBackup({ manifest: exported.manifest, backup: cutoverTampered, destination: { async get() { return null; }, async put() {} } }),
    error => error.code === 'INVALID_BACKUP',
  );
});

test('Given final checkpoint persistence fails When exporting Then it never reports a misleading successful cutover', async () => {
  const { exportMigrationBackup } = await load();
  let saved = null;

  await assert.rejects(exportMigrationBackup(command(readOnlySource(fixtureRecords()), {
    checkpoint: async state => {
      if (state.manifest.status === 'complete') throw new Error('final-manifest-write-failed');
      saved = structuredClone(state);
    },
  })), /final-manifest-write-failed/);

  assert.equal(saved.manifest.status, 'interrupted');
  assert.equal(saved.manifest.cutoverAt, null);
  assert.equal(saved.backup.cutoverAt, null);
});

test('Given identical read-only source data When exporting repeatedly Then the manifest fingerprint is deterministic', async () => {
  const { exportMigrationBackup } = await load();
  const first = await exportMigrationBackup(command(readOnlySource(fixtureRecords())));
  const second = await exportMigrationBackup(command(readOnlySource(fixtureRecords())));

  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(second.backup.checksum, first.backup.checksum);
});
