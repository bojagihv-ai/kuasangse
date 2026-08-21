'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const functionStart = source.indexOf(marker);
  const start = functionStart >= 6 && source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', functionStart);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function compile(name) {
  const context = vm.createContext({
    Object,
    Array,
    Date,
    JSON,
    String,
    KUASANGSE_SAFETY_BACKUP_FORMAT: 'kuasangse.factory.safety-backup',
    KUASANGSE_SAFETY_BACKUP_VERSION: 1,
    factoryRuntimeSha256Text: async value => crypto.createHash('sha256').update(String(value)).digest('hex'),
  });
  vm.runInContext(`${extractFunction(CORE_03, name)}\nthis.target = ${name};`, context);
  return context.target;
}

test('안전 백업은 workfile·로컬 보관본·IndexedDB manifest를 체크섬으로 묶고 변조 복원을 차단한다', async () => {
  const build = compile('factoryBuildProjectSafetyBackupEnvelope');
  const validate = compile('factoryValidateProjectSafetyBackupEnvelope');
  const workfile = { format: 'kuasangse.factory.project', project: { id: 'project-1', name: '모시꽃수파우치' } };
  const localArchiveEntries = [{ archiveId: 'archive-1', asset: { id: 'hero-1', image: 'data:image/jpeg;base64,AAAA' } }];
  const indexedDbEntries = [{ store: 'projects', id: 'project-1', digest: 'fnv1a32:12345678' }];

  const backup = await build(workfile, localArchiveEntries, indexedDbEntries);
  assert.equal(backup.format, 'kuasangse.factory.safety-backup');
  assert.equal(backup.localArchive.count, 1);
  assert.equal(backup.indexedDb.count, 1);
  assert.match(backup.checksum, /^[a-f0-9]{64}$/);
  assert.equal((await validate(backup)).workfile.project.id, 'project-1');

  const tampered = structuredClone(backup);
  tampered.localArchive.entries[0].asset.image = 'data:image/jpeg;base64,BROKEN';
  await assert.rejects(() => validate(tampered), /로컬 보관본 체크섬/);

  assert.match(CORE_02, /id="exportProjectSafetyBackupBtn"/);
  assert.match(CORE_02, /id="restoreProjectSafetyBackupBtn"/);
  assert.match(CORE_03, /action === 'export-safety-backup'/);
  assert.match(CORE_03, /action === 'restore-safety-backup'/);
});
