'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');

function listenerTarget(id, root) {
  const listeners = new Map();
  return {
    id,
    tagName: 'INPUT',
    files: [],
    value: '',
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    matches(selector) {
      return selector === `#${id}`;
    },
    closest(selector) {
      return this.matches(selector) ? this : null;
    },
    dispatch(type) {
      const event = {
        type,
        target: this,
        preventDefault() {},
      };
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
      for (const listener of [...(root.listeners.get(type) || [])]) listener(event);
    },
  };
}

function startTabRoot() {
  const root = {
    listeners: new Map(),
    currentFileInput: null,
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    },
    querySelector(selector) {
      return selector === '#factoryGuideProductFile' ? this.currentFileInput : null;
    },
    replaceFileInput() {
      this.currentFileInput = listenerTarget('factoryGuideProductFile', this);
      return this.currentFileInput;
    },
  };
  root.replaceFileInput();
  return root;
}

test('start product-image change stays bound after the rendered file input node is replaced', async () => {
  const moduleUrl = pathToFileURL(path.join(
    ROOT,
    'src',
    'menus',
    'factory',
    'tabs',
    'start-tab.mjs',
  ));
  moduleUrl.searchParams.set('case', `${Date.now()}-${Math.random()}`);
  const { createStartFactoryTab } = await import(moduleUrl.href);
  const uploads = [];
  const errors = [];
  const tab = createStartFactoryTab({
    getSnapshot: () => Object.freeze({ factory: Object.freeze({}) }),
    assertMutable: () => true,
    getOperationToken: () => Object.freeze({
      version: 'factory-store:v1',
      workspaceId: 'project:image-rebind',
      revision: 0,
      fence: 1,
    }),
    isOperationCurrent: () => true,
    reportError: error => errors.push(error),
    actions: {
      setProductImage(file) {
        uploads.push(file);
        return true;
      },
    },
    renderHelpers: {},
  });
  const root = startTabRoot();
  const dispose = tab.bind(root);

  const replacementInput = root.replaceFileInput();
  const replacementFile = { name: 'replacement.png', type: 'image/png' };
  replacementInput.files = [replacementFile];
  replacementInput.dispatch('change');

  assert.deepEqual(uploads, [replacementFile]);
  assert.deepEqual(errors, []);
  assert.equal(replacementInput.value, '');

  dispose();
  assert.equal(
    [...root.listeners.values()].reduce((total, listeners) => total + listeners.size, 0),
    0,
  );
});
