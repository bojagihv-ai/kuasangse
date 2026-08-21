const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const functionStart = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(functionStart, -1, `${functionName} 정의를 찾지 못했습니다.`);
  const start = fileSource.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const parameterStart = fileSource.indexOf('(', functionStart);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '(') parameterDepth += 1;
    if (fileSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const braceStart = fileSource.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 경계를 찾지 못했습니다.`);
}

function compileFunction(functionSource, functionName, contextValues) {
  const context = vm.createContext(contextValues);
  vm.runInContext(`${functionSource}; this.target = ${functionName};`, context);
  return { context, target: context.target };
}

function fakeFile(name, text = '{"project":"direct"}') {
  return { name, size: text.length, text: async () => text };
}

async function flushFileChange() {
  await new Promise(resolve => setImmediate(resolve));
}

test('기존 일반 작업파일 불러오기는 showOpenFilePicker 가능 시 FSA seam을 먼저 사용한다', async () => {
  const pickerSource = extractFunction(source(CORE_03), 'openFactoryProjectFilePicker');
  const calls = [];
  const { target: openPicker } = compileFunction(pickerSource, 'openFactoryProjectFilePicker', {
    window: { showOpenFilePicker() {} },
    workspacePersistenceApi: () => ({
      chooseProjectFileForOpen: async () => {
        calls.push('fsa');
        return { kind: 'fsa-handle' };
      },
      readProjectFile: async () => {
        calls.push('read');
        return { file: fakeFile('normal.kuasangse'), text: '{"project":"normal"}' };
      },
    }),
    KUASANGSE_PROJECT_FILE_PICKER_ID: 'kuasangse-project-file',
    kuasangseProjectFileLastHandle: null,
    factoryProjectFilePickerTypes: () => [],
    KUASANGSE_PROJECT_FILE_MAX_BYTES: 1024,
    state: {},
    render() {},
    setTimeout: resolve => resolve(),
    importFactoryProjectFileFromText: async text => {
      calls.push(`import:${text}`);
      return true;
    },
    rememberFactoryProjectFileHandle: async () => calls.push('remember'),
    factoryProjectFileHandleScope: () => 'scope',
    factoryLog() {},
    document: { createElement: () => { throw new Error('fallback input must not be created'); } },
  });

  await openPicker({ skipLeaveConfirm: true });

  assert.deepEqual(calls, ['fsa', 'read', 'import:{"project":"normal"}', 'remember']);
});

test('작업파일 직접 선택은 실제 표준 chooser를 매번 만들고 FSA 없이 기존 import seam으로 전달한다', async () => {
  const core02 = extractFunction(source(CORE_02), 'renderGlobalDbSyncStatusStrip');
  const core03 = source(CORE_03);
  assert.match(core02, /class="btn-sm" id="importProjectFileDirectBtn"[^>]*title="Windows 파일창 대신 표준 파일 선택으로 \.kuasangse를 직접 불러옵니다\."[^>]*action:'import-direct'[^>]*>작업파일 직접 선택<\/button>/);

  const directInputSource = extractFunction(core03, 'openFactoryProjectFileInput');
  const directFiles = [fakeFile('direct-one.kuasangse'), fakeFile('direct-two.kuasangse')];
  const inputs = [];
  const imports = [];
  let fsaCalls = 0;
  const document = {
    body: { appendChild(input) { inputs.push(input); } },
    createElement(tagName) {
      assert.equal(tagName, 'input');
      const input = {
        style: {},
        files: [directFiles.shift()],
        removed: false,
        remove() { this.removed = true; },
        click() { void this.onchange(); },
      };
      return input;
    },
  };
  const { target: openDirectInput } = compileFunction(directInputSource, 'openFactoryProjectFileInput', {
    document,
    window: { showOpenFilePicker: () => { fsaCalls += 1; } },
    workspacePersistenceApi: () => ({ chooseProjectFileForOpen: () => { fsaCalls += 1; } }),
    KUASANGSE_PROJECT_FILE_MAX_BYTES: 1024,
    state: {},
    render() {},
    setTimeout: resolve => resolve(),
    importFactoryProjectFileFromText: async (text, options) => imports.push({ text, options }),
    factoryLog() {},
  });

  openDirectInput({ direct: true });
  openDirectInput({ direct: true });
  await flushFileChange();

  assert.equal(inputs.length, 2, '두 번의 직접 선택은 독립 input/chooser를 만든다');
  assert.deepEqual(inputs.map(input => input.type), ['file', 'file']);
  assert.deepEqual(inputs.map(input => input.accept), ['.kuasangse', '.kuasangse']);
  assert.ok(inputs.every(input => input.removed), '각 chooser input은 change 뒤 정리된다');
  assert.deepEqual(imports.map(({ text, options }) => ({
    text,
    options: {
      fileName: options.fileName,
      skipLeaveConfirm: options.skipLeaveConfirm,
      deferFinalRender: options.deferFinalRender,
    },
  })), [
    { text: '{"project":"direct"}', options: { fileName: 'direct-one.kuasangse', skipLeaveConfirm: false, deferFinalRender: true } },
    { text: '{"project":"direct"}', options: { fileName: 'direct-two.kuasangse', skipLeaveConfirm: false, deferFinalRender: true } },
  ]);
  assert.equal(fsaCalls, 0, 'direct action은 FSA API 또는 persistence open seam을 호출하지 않는다');

  for (const functionName of ['handleWorkfileActionEvent', 'handleWorkfileActionClick']) {
    const actionSource = extractFunction(core03, functionName);
    let directCalls = 0;
    const { target: handler } = compileFunction(actionSource, functionName, {
      openFactoryProjectFileInput: options => {
        assert.equal(options?.direct, true);
        directCalls += 1;
      },
    });
    const event = functionName === 'handleWorkfileActionEvent'
      ? { detail: { action: 'import-direct' } }
      : {
        target: { closest: () => ({ id: 'importProjectFileDirectBtn' }) },
        preventDefault() {},
        stopImmediatePropagation() {},
      };
    handler(event);
    assert.equal(directCalls, 1, `${functionName}가 direct action을 helper로 연결해야 합니다.`);
  }

  const bindSource = extractFunction(core03, 'bindRenderedWorkfileActionButtons');
  const button = {};
  let boundCalls = 0;
  const { target: bindButtons } = compileFunction(bindSource, 'bindRenderedWorkfileActionButtons', {
    openFactoryProjectFileInput: options => {
      assert.equal(options?.direct, true);
      boundCalls += 1;
    },
  });
  bindButtons({ querySelector: id => id === '#importProjectFileDirectBtn' ? button : null });
  button.onclick({ preventDefault() {} });
  assert.equal(boundCalls, 1, 'button action delegation map이 direct button을 연결해야 합니다.');
});

test('직접 선택은 취소와 비-.kuasangse 파일을 importer로 전달하지 않는다', async () => {
  const directInputSource = extractFunction(source(CORE_03), 'openFactoryProjectFileInput');
  const queuedFiles = [undefined, fakeFile('not-allowed.json')];
  const imports = [];
  const { target: openDirectInput } = compileFunction(directInputSource, 'openFactoryProjectFileInput', {
    document: {
      body: { appendChild() {} },
      createElement: () => ({
        style: {},
        files: [queuedFiles.shift()],
        remove() {},
        click() { void this.onchange(); },
      }),
    },
    KUASANGSE_PROJECT_FILE_MAX_BYTES: 1024,
    state: {},
    render() {},
    setTimeout: resolve => resolve(),
    importFactoryProjectFileFromText: async text => imports.push(text),
    factoryLog() {},
  });

  openDirectInput({ direct: true });
  openDirectInput({ direct: true });
  await flushFileChange();

  assert.deepEqual(imports, []);
});
