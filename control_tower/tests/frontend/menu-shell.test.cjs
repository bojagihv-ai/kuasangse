const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const HTML_PATH = path.join(ROOT, 'control_tower', 'frontend', 'control-tower.html');
const MODULE_PATH = path.join(ROOT, 'control_tower', 'frontend', 'src', 'menu-shell.mjs');

test('menu registry owns the seven production control-tower groups', async () => {
  const module = await import(pathToFileURL(MODULE_PATH));
  assert.deepEqual(module.MENU_REGISTRY.map(item => item.key), [
    'overview',
    'input-source',
    'competitors',
    'production-acut',
    'automation',
    'cafe24',
    'audit-sync',
  ]);
  assert.equal(new Set(module.MENU_REGISTRY.map(item => item.key)).size, 7);
  assert.deepEqual(module.FACTORY_STAGE_KEYS, [
    'db',
    'representative',
    'size',
    'option_color',
    'general',
    'sections',
    'final_detail',
  ]);
});

test('menu state and keyboard actions are deterministic', async () => {
  const module = await import(pathToFileURL(MODULE_PATH));
  const state = module.createMenuState('input-source');
  assert.equal(state.activeKey, 'input-source');
  assert.equal(module.menuKeyForKeyboard('ArrowRight', 'input-source'), 'competitors');
  assert.equal(module.menuKeyForKeyboard('ArrowLeft', 'input-source'), 'overview');
  assert.equal(module.menuKeyForKeyboard('Home', 'cafe24'), 'overview');
  assert.equal(module.menuKeyForKeyboard('End', 'overview'), 'audit-sync');
  assert.equal(module.menuKeyForKeyboard('Enter', 'automation'), 'automation');
  assert.equal(module.applyMenuAction(state, 'competitors').activeKey, 'competitors');
});

test('menu badges derive from the live projection and do not invent connected data', async () => {
  const module = await import(pathToFileURL(MODULE_PATH));
  const badges = module.projectMenuBadges({
    connected: true,
    inputs: [
      { key: 'product', missing: [] },
      { key: 'requirements', missing: ['categoryId'] },
      { key: 'competitors', count: 3, missing: [] },
    ],
    stages: [
      { key: 'representative', selectedId: 'rep-a', candidates: [{ id: 'rep-a' }] },
      { key: 'size', selectedId: '', candidates: [] },
    ],
    progress: { status: 'running', percent: 40 },
    registration: { status: 'approval_required', missing: ['approvalToken'] },
    session: { revision: 7 },
  });
  assert.equal(badges['input-source'].count, 1);
  assert.equal(badges.competitors.count, 3);
  assert.equal(badges['production-acut'].count, 1);
  assert.equal(badges.cafe24.status, 'approval_required');
  const disconnected = module.projectMenuBadges({ connected: false, inputs: [], stages: [] });
  assert.equal(disconnected['audit-sync'].status, 'disconnected');
  assert.equal(disconnected.competitors.count, 0);
  assert.equal(module.menuBadgeText({ status: 'approval_required' }), '승인 필요');
  assert.equal(module.menuBadgeText({ status: 'disconnected' }), '끊김');
});

test('production HTML declares one menu shell, persistent sync, active-panel semantics, and seven stage slots', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /id="primary-menu"[\s\S]*role="tablist"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 7);
  assert.match(html, /class="persistent-sync-bar(?:\s|\")/);
  assert.match(html, /data-menu-panel="overview"/);
  assert.match(html, /data-menu-panel="production-acut"/);
  assert.match(html, /id="stage-subnav"/);
  const stageSubnav = html.match(/id="stage-subnav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((stageSubnav.match(/data-stage-key=/g) || []).length, 7);
  assert.match(html, /data-stage-key="db"/);
  assert.match(html, /data-stage-key="final_detail"/);
  assert.match(html, /\.menu-panel\[hidden\]/);
  assert.match(html, /@media[\s\S]*max-width: 720px/);
});

test('menu precedes collapsed sync diagnostics so the active work surface is immediately reachable', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const menuIndex = html.indexOf('<nav id="primary-menu"');
  const syncIndex = html.indexOf('<details class="persistent-sync-bar sync-disclosure"');
  const panelIndex = html.indexOf('<section id="menu-panel-overview"');
  assert.ok(menuIndex > 0, 'primary menu is missing');
  assert.ok(syncIndex > menuIndex, 'sync diagnostics must follow the primary menu');
  assert.ok(panelIndex > syncIndex, 'active panel must follow the compact sync disclosure');
  const disclosure = html.slice(syncIndex, panelIndex);
  assert.match(disclosure, /<summary class="sync-disclosure-summary"/);
  assert.match(disclosure, /id="sync-disclosure-summary-text"/);
  assert.doesNotMatch(disclosure, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(html, /\.sync-disclosure:not\(\[open\]\)\s*>\s*\.sync-disclosure-content\s*{[^}]*display:\s*none/);
});

test('menu panels have unique ids and hidden inactive panels do not duplicate roots', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  assert.equal((html.match(/data-menu-panel="/g) || []).length, 7);
  assert.match(html, /data-menu-panel="overview"[^>]*>/);
  assert.match(html, /data-menu-panel="input-source"[^>]*hidden/);
  const overview = html.match(/id="menu-panel-overview"[\s\S]*?id="menu-panel-input-source"/)?.[0] || '';
  const audit = html.match(/id="menu-panel-audit-sync"[\s\S]*?<footer/)?.[0] || '';
  assert.match(overview, /id="product-list"/);
  assert.doesNotMatch(audit, /id="product-list"/);
});

test('projection updates preserve active menu state and root-only scrolling contract', async () => {
  const module = await import(pathToFileURL(MODULE_PATH));
  const state = module.createMenuState('production-acut');
  const before = state.activeKey;
  module.projectMenuBadges({ connected: true, inputs: [], stages: [{ key: 'general', selectedId: 'a', candidates: [] }] });
  assert.equal(state.activeKey, before);
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  assert.match(html, /main\.page[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /html\s*{[^}]*overflow:\s*hidden/);
  assert.match(html, /body\s*{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(html, /\.menu-panel[^{]*\{[^}]*overflow-y\s*:/);
});
