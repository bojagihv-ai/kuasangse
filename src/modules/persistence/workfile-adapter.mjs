import { deserializeWorkspace, serializeWorkspaceEnvelope } from './serialization.mjs';
import { publishWorkspaceFile } from './file-publish.mjs';

export class WorkfileStaleError extends Error {
  constructor(code, message, current = null) {
    super(message);
    this.name = 'WorkfileStaleError';
    this.code = code;
    this.current = current;
  }
}

function fileFence(text) {
  try {
    const value = JSON.parse(text);
    return Object.freeze({
      revision: Number(value?.persistence?.revision?.counter ?? value?.revision?.counter ?? value?.revision) || 0,
      digest: String(value?.persistence?.digest ?? value?.manifest?.digest ?? value?.digest ?? ''),
    });
  } catch (_) {
    return Object.freeze({ revision: 0, digest: '' });
  }
}

async function writableText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.text === 'function') return value.text();
  return String(value ?? '');
}

export function createWorkfileAdapter({ root = typeof self === 'undefined' ? null : self } = {}) {
  const openedFiles = new WeakMap();
  async function writeHandle(handle, value, context = {}, verifyBeforeClose = null) {
    return publishWorkspaceFile({ root, handle, value, context, verifyBeforeClose });
  }

  return Object.freeze({
    name: 'workfile',
    async selectOpenHandle(options) {
      if (typeof root?.showOpenFilePicker !== 'function') return null;
      const handles = await root.showOpenFilePicker(options);
      return handles?.[0] || null;
    },
    async selectSaveHandle(options) {
      if (typeof root?.showSaveFilePicker !== 'function') return null;
      return root.showSaveFilePicker(options);
    },
    async readHandle(handle) {
      const file = await handle.getFile();
      const text = await file.text();
      openedFiles.set(handle, fileFence(text));
      return { file, text, fence: openedFiles.get(handle) };
    },
    writeHandle,
    async read() { return null; },
    async write(envelope, context = {}) {
      if (!context.handle) return envelope;
      context.assertAuthority?.();
      const verifyCurrent = async () => {
        if (context.saveAs || typeof context.handle.getFile !== 'function') return;
        const expected = context.expectedFile || openedFiles.get(context.handle) || null;
        const currentFile = await context.handle.getFile();
        const currentText = await currentFile.text();
        const current = fileFence(currentText);
        if (!expected && currentText.trim()) {
          throw new WorkfileStaleError(
            'WORKFILE_FENCE_REQUIRED',
            '현재 파일의 마지막 열린 기준이 없어 덮어쓸 수 없습니다. 새로고침하거나 다른 이름으로 저장하세요.',
            current,
          );
        }
        if (expected && (Number(expected.revision) !== current.revision || String(expected.digest || '') !== current.digest)) {
          throw new WorkfileStaleError(
            'WORKFILE_STALE',
            '파일이 다른 창에서 변경되었습니다. 새로고침하거나 다른 이름으로 저장하세요.',
            current,
          );
        }
      };
      await verifyCurrent();
      const value = context.value ?? serializeWorkspaceEnvelope(envelope);
      await writeHandle(context.handle, value, {
        ...context,
        scopeId: context.scopeId || envelope.scopeId,
      }, verifyCurrent);
      openedFiles.set(context.handle, fileFence(await writableText(value)));
      context.assertCompletion?.();
      return envelope;
    },
    deserialize: deserializeWorkspace,
  });
}
