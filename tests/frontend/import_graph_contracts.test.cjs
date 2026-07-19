const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'src', 'runtime-manifest.json');
const REGISTRY_PATH = path.join(ROOT, 'src', 'modules', 'module-registry.mjs');
const AST_GREP = process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep';
const EXPECTED_AST_GREP_VERSION = 'ast-grep 0.44.0';
const WORKSPACE_REVISION = 'src/modules/workspace-revision.mjs';
const EXECUTABLE_IDENTIFIER_RULE = [
  'id: executable-identifiers',
  'language: JavaScript',
  'rule:',
  '  all:',
  '    - kind: identifier',
  '    - any:',
  '        - not:',
  '            inside:',
  '              kind: template_string',
  '              stopBy: end',
  '        - inside:',
  '            kind: template_substitution',
  '            stopBy: end',
].join('\n');

function moduleUrl(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  return `${pathToFileURL(file).href}?test=${Date.now()}-${Math.random()}`;
}

function parseAsModule(source, label = 'fixture') {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module', '-'], {
    encoding: 'utf8',
    input: source,
  });
  if (result.status !== 0) {
    throw new SyntaxError(`module syntax error (${label}): ${result.stderr.trim()}`);
  }
}

function astGrep(source, pattern, selector = '') {
  const args = ['run', '-p', pattern];
  if (selector) args.push('--selector', selector);
  args.push('--lang', 'JavaScript', '--json=compact', '--stdin');
  const result = spawnSync(AST_GREP, args, { encoding: 'utf8', input: source, maxBuffer: 16 * 1024 * 1024 });
  assert.ok([0, 1].includes(result.status), `ast-grep failed:\n${result.stderr || result.error?.message || ''}`);
  return JSON.parse(result.stdout || '[]');
}

function executableIdentifiers(source) {
  const result = spawnSync(AST_GREP, [
    'scan',
    '--inline-rules',
    EXECUTABLE_IDENTIFIER_RULE,
    '--json=compact',
    '--stdin',
  ], { encoding: 'utf8', input: source, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `ast-grep scan failed:\n${result.stderr || result.error?.message || ''}`);
  return JSON.parse(result.stdout || '[]').map(match => match.text);
}

function normalizeIdentifier(identifier) {
  return identifier.replace(
    /\\u(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))/g,
    (_match, braced, fixed) => String.fromCodePoint(Number.parseInt(braced || fixed, 16)),
  );
}

function assertNoForbiddenGlobalIdentifiers(source, label = 'fixture') {
  parseAsModule(source, label);
  const forbidden = executableIdentifiers(source)
    .find(identifier => ['window', 'globalThis'].includes(normalizeIdentifier(identifier)));
  if (forbidden) throw new Error(`window/global delegation: ${label} (${forbidden})`);
}

function assertNoMutableExports(source, label) {
  parseAsModule(source, label);
  const mutable = [
    ...astGrep(source, 'export let $A'),
    ...astGrep(source, 'export var $A'),
  ];
  assert.equal(mutable.length, 0, `raw mutable state export: ${label}`);
}

function assertImmutableWorkspacePersistenceCapability(source, label) {
  parseAsModule(source, label);
  const executableGlobals = executableIdentifiers(source)
    .map(normalizeIdentifier)
    .filter(identifier => ['window', 'globalThis'].includes(identifier));
  assert.deepEqual(executableGlobals, ['globalThis'], `${label} may expose only its immutable install root`);
  assert.match(source, /const PERSISTENCE_CAPABILITY_KEY = '__KUASANGSE_WORKSPACE_PERSISTENCE__'/);
  assert.match(source, /export function installWorkspacePersistence\(root = globalThis\)/);
  assert.match(source, /return Object\.freeze\(capability\)/);
  assert.equal((source.match(/Object\.defineProperty\(root, PERSISTENCE_CAPABILITY_KEY/g) || []).length, 2);
  assert.equal((source.match(/enumerable:\s*false,[\s\S]{0,80}writable:\s*false,[\s\S]{0,80}configurable:\s*false/g) || []).length, 2);
  assert.doesNotMatch(source, /(?:window|globalThis)\s*(?:\.|\[)[^=\n]+=/);
}

function contract(createModuleGraphContract, id, overrides = {}) {
  return createModuleGraphContract({
    id,
    owner: 'shell',
    role: 'foundation',
    imports: [],
    exports: [],
    ...overrides,
  });
}

test('static analysis toolchain은 고정된 실제 parser와 AST engine을 사용한다', () => {
  const version = spawnSync(AST_GREP, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.error?.message || version.stderr);
  assert.equal(version.stdout.trim(), EXPECTED_AST_GREP_VERSION);
  assert.doesNotThrow(() => parseAsModule('export const ok = true;'));
  assert.throws(() => parseAsModule('0xZZ'), /module syntax error/);
});

test('runtime registry는 source parser를 소유하지 않고 250줄 이하 metadata boundary다', () => {
  const source = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const lineCount = source.trimEnd().split(/\r?\n/).length;
  assert.ok(lineCount <= 250, `module-registry.mjs must be <=250 LOC, received ${lineCount}`);
  assert.doesNotMatch(source, /hasExecutableGlobalReference|skipNumber|skipTemplate|scanCode|source:\s*String/);
});

test('runtime graph registry는 manifest-known branded contract만 허용한다', async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const {
    KNOWN_FOUNDATION_MODULE_IDS,
    createModuleGraphContract,
    validateModuleImportGraph,
  } = await import(moduleUrl('src/modules/module-registry.mjs'));

  assert.equal(typeof createModuleGraphContract, 'function');
  assert.deepEqual(KNOWN_FOUNDATION_MODULE_IDS, manifest.modules);
  assert.throws(() => createModuleGraphContract({
    id: 'src/modules/unknown.mjs',
    owner: 'shell',
    role: 'foundation',
    imports: [],
    exports: [],
  }), /unknown foundation module/);
  assert.throws(() => createModuleGraphContract({
    id: manifest.modules[0],
    owner: 'shell',
    role: 'foundation',
    imports: [],
    exports: [],
    source: 'window.renderAlpha()',
  }), /source is not part of runtime module contracts/);

  const branded = contract(createModuleGraphContract, manifest.modules[0]);
  assert.ok(Object.isFrozen(branded));
  assert.ok(Object.isFrozen(branded.imports));
  assert.ok(Object.isFrozen(branded.exports));
  assert.doesNotThrow(() => validateModuleImportGraph([branded]));
  assert.throws(() => validateModuleImportGraph([{ ...branded }]), /branded module graph contract/);
  assert.throws(() => validateModuleImportGraph([{
    id: manifest.modules[0],
    owner: 'shell',
    role: 'foundation',
    imports: [],
    exports: [],
  }]), /branded module graph contract/);
});

test('branded import graph validator는 duplicate, cycle, peer-store, raw state를 거부한다', async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const { createModuleGraphContract, validateModuleImportGraph } = await import(moduleUrl('src/modules/module-registry.mjs'));
  const [workspace, ownership, menus, store, composition] = manifest.modules;

  const first = contract(createModuleGraphContract, workspace, { imports: [ownership] });
  const second = contract(createModuleGraphContract, ownership, { imports: [workspace] });
  assert.throws(() => validateModuleImportGraph([first, second]), /import cycle/);
  assert.throws(() => validateModuleImportGraph([first, first]), /duplicate import graph id/);

  const menuContract = contract(createModuleGraphContract, menus, {
    owner: 'alpha',
    role: 'menu',
    imports: [store],
  });
  const storeContract = contract(createModuleGraphContract, store, {
    owner: 'beta',
    role: 'store',
  });
  assert.throws(() => validateModuleImportGraph([menuContract, storeContract]), /peer-store import/);

  const compositionContract = contract(createModuleGraphContract, composition, {
    owner: 'composition',
    role: 'composition',
    imports: [store],
  });
  assert.doesNotThrow(() => validateModuleImportGraph([compositionContract, storeContract]));

  const rawState = contract(createModuleGraphContract, ownership, { exports: ['state'] });
  assert.throws(() => validateModuleImportGraph([rawState]), /raw mutable state export/);
});

test('AST policy는 bracket·optional·computed·escape·grouping·alias origin을 구조적으로 거부한다', async t => {
  const executableReferences = [
    "window['renderAlpha']();",
    "globalThis?.['bindAlpha']();",
    'window?.["renderAlpha"]();',
    'globalThis[`renderAlpha`]();',
    'window["\\x72enderAlpha"]();',
    "window['render' + 'Alpha']();",
    "\\u0077indow['renderAlpha']()",
    "global\\u0054his['renderAlpha']()",
    "(window)['renderAlpha']()",
    "(globalThis)?.['renderAlpha']()",
    '(window).renderAlpha()',
    "(globalThis)['renderAlpha']()",
    'const host=window; host.renderAlpha()',
    'const { renderAlpha } = window; renderAlpha()',
    'const { renderAlpha: bindAlpha } = globalThis; bindAlpha()',
    '(0, window).renderAlpha()',
    'const ratio = ({}) / window / divisor;',
    'const ratio = (function () {}) / globalThis / divisor;',
    'const ratio = (() => {}) / window / divisor;',
    'const ratio = obj.if(ok) / globalThis / divisor;',
    'const message = `${window}`;',
    'tag`safe ${globalThis}`;',
  ];

  for (const [index, source] of executableReferences.entries()) {
    await t.test(`executable-${index}`, () => {
      assert.throws(
        () => assertNoForbiddenGlobalIdentifiers(source, `executable-${index}`),
        /window\/global delegation/,
      );
    });
  }
});

test('AST policy는 string, comment, regex의 global text를 검사하지 않는다', async t => {
  const benignSources = [
    'const message = "window.foo()";',
    'const message = \'globalThis["renderAlpha"]()\';',
    '// window.foo()\nconst ok = true;',
    '/* globalThis.foo() */ const ok = true;',
    'const message = `window.foo() and globalThis["renderAlpha"]()`;',
    'const message = `safe ${"window.foo()"}`;',
    'const pattern = /window\\.foo|globalThis/;',
    'if (ok) /window|globalThis/.test(text);',
    'if (ok) {} /window|globalThis/.test(text);',
    'function f() {} /window|globalThis/.test(text);',
    'class C {} /window|globalThis/.test(text);',
    'label: {} /window|globalThis/.test(text);',
    'while (ok) /window|globalThis/.test(text);',
    'for (; ok;) /window|globalThis/.test(text);',
    'try {} finally {} /window|globalThis/.test(text);',
    'tag`\\u00ZZ window globalThis`;',
    'const values = [0xCAFE, 0b1010, 0o755, 1e+2, 1_000, .5]; 1..toString();',
  ];

  for (const [index, source] of benignSources.entries()) {
    await t.test(`benign-${index}`, () => {
      assert.doesNotThrow(() => assertNoForbiddenGlobalIdentifiers(source, `benign-${index}`));
    });
  }
});

test('실제 ESM parser는 malformed corpus를 fail-closed한다', async t => {
  const malformedSources = [
    "const broken = 'unterminated;",
    '/* unterminated comment',
    'const broken = `unterminated;',
    'const broken = (1 + 2;',
    'const broken = \\u00ZZindow;',
    '1window.renderAlpha()',
    '1safeIdentifier',
    '0xZZ',
    '1e+',
    'const broken = `\\u00ZZ`;',
    '0b2',
    '0o8',
    '0x',
    '1__0',
    '1_',
    '.1foo',
    '1nfoo',
    '0_1',
    '0123n',
    'const = 1',
  ];

  for (const [index, source] of malformedSources.entries()) {
    await t.test(`malformed-${index}`, () => {
      assert.throws(
        () => assertNoForbiddenGlobalIdentifiers(source, `malformed-${index}`),
        /module syntax error/,
      );
    });
  }
});

test('manifest modules는 실제 ESM으로 parse되고 Task 2 graph는 static policy와 runtime metadata contract를 통과한다', async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const { createModuleGraphContract, validateModuleImportGraph } = await import(moduleUrl('src/modules/module-registry.mjs'));

  for (const relativePath of manifest.modules) {
    const absolutePath = path.join(ROOT, ...relativePath.split('/'));
    const result = spawnSync(process.execPath, ['--check', absolutePath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relativePath} failed Node module parsing:\n${result.stderr}`);
  }

  const taskTwoModules = manifest.modules.filter(relativePath => relativePath !== WORKSPACE_REVISION);
  const entries = taskTwoModules.map(relativePath => {
    const source = fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
    if (relativePath === WORKSPACE_REVISION) {
      assertNoForbiddenGlobalIdentifiers(source, relativePath);
    } else if (relativePath === 'src/modules/workspace-persistence.mjs') {
      assertImmutableWorkspacePersistenceCapability(source, relativePath);
    } else {
      assertNoForbiddenGlobalIdentifiers(source, relativePath);
    }
    assertNoMutableExports(source, relativePath);
    const directory = path.posix.dirname(relativePath);
    const imports = [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
      .map(match => match[1])
      .filter(specifier => specifier.startsWith('.'))
      .map(specifier => path.posix.normalize(path.posix.join(directory, specifier)));
    const exports = [...source.matchAll(/\bexport\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)]
      .map(match => match[1]);
    const basename = path.posix.basename(relativePath);
    return createModuleGraphContract({
      id: relativePath,
      owner: basename === 'composition-commands.mjs' ? 'composition' : 'shell',
      role: basename === 'app-store.mjs'
        ? 'store'
        : (basename === 'composition-commands.mjs' ? 'composition' : 'foundation'),
      imports,
      exports,
    });
  });

  assert.doesNotThrow(() => validateModuleImportGraph(entries));
});
