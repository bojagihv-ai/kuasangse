'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const builder = require(path.join(ROOT, 'tools', 'build_runtime_bundle.cjs'));

test('runtime source changed after a build gets a new cache-busting build ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-runtime-build-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'runtime-manifest.json'), JSON.stringify({
      schema: 'kuasangse.runtime.v1',
      buildId: 'image-preservation-v602',
      bundle: 'dist/runtime.js',
      scripts: ['src/runtime.js'],
    }, null, 2));
    fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.runtimeRevision = 1;\n');

    builder.writeRuntimeBundle(root);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8')).buildId,
      'image-preservation-v602',
      'the first local build retains its declared release ID',
    );

    fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.runtimeRevision = 2;\n');
    builder.writeRuntimeBundle(root);
    const changedManifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8'));
    assert.equal(changedManifest.buildId, 'image-preservation-v603');
    assert.match(
      fs.readFileSync(path.join(root, 'dist', 'runtime.js'), 'utf8'),
      /"buildId":"image-preservation-v603"/,
      'the emitted runtime must carry the same new ID that Chrome receives in its URL',
    );

    builder.writeRuntimeBundle(root);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8')).buildId,
      'image-preservation-v603',
      'an unchanged rebuild must not make a running Chrome tab stale again',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an ESM runtime module changed after a build gets a new cache-busting build ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-runtime-esm-build-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'runtime-manifest.json'), JSON.stringify({
      schema: 'kuasangse.runtime.v1',
      buildId: 'image-preservation-v700',
      bundle: 'dist/runtime.js',
      loader: 'src/app-loader.js',
      authorityModule: 'src/modules/authority.mjs',
      modules: ['src/modules/authority.mjs', 'src/modules/session.mjs'],
      scripts: ['src/runtime.js'],
    }, null, 2));
    fs.writeFileSync(path.join(root, 'src', 'app-loader.js'), 'window.loaderRevision = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'runtime.js'), 'window.runtimeRevision = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'modules', 'authority.mjs'), 'export const authorityRevision = 1;\n');
    fs.writeFileSync(path.join(root, 'src', 'modules', 'session.mjs'), 'export const sessionRevision = 1;\n');

    builder.writeRuntimeBundle(root);
    fs.writeFileSync(path.join(root, 'src', 'modules', 'session.mjs'), 'export const sessionRevision = 2;\n');

    builder.writeRuntimeBundle(root);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8')).buildId,
      'image-preservation-v701',
      'a changed ESM module must move Chrome to a new cache-busting runtime URL',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
