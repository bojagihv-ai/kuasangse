const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HTML_PATH = path.join(ROOT, 'control_tower', 'frontend', 'control-tower.html');

test('factory sync detail values keep Korean words together while breaking long tokens', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const selector = html.match(/\.factory-sync-field dd\s*\{(?<body>[^}]*)\}/s);

  assert.ok(selector, 'the factory sync detail value selector must exist');
  assert.match(selector.groups.body, /\bword-break\s*:\s*keep-all\s*;/);
  assert.match(selector.groups.body, /\boverflow-wrap\s*:\s*break-word\s*;/);
  assert.doesNotMatch(selector.groups.body, /\boverflow-wrap\s*:\s*anywhere\s*;/);
});
