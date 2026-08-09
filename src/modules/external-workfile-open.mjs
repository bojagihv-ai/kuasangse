const OPEN_SOURCE = 'sinhwa-assets';
const READY_MESSAGE = 'kuasangse:external-workfile-open-ready';
const PROBE_MESSAGE = 'kuasangse:external-workfile-open-probe';
const REQUEST_MESSAGE = 'kuasangse:external-workfile-open-request';
const RESULT_MESSAGE = 'kuasangse:external-workfile-open-result';
const MAX_WORKFILE_BYTES = 256 * 1024 * 1024;
export const FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION = 'factory-workfile-hydration-command:v1';

function messageRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function workfileName(value) {
  const fileName = String(value || '').trim();
  if (fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('작업파일 이름에는 경로를 포함할 수 없습니다.');
  }
  if (!fileName.toLocaleLowerCase('en-US').endsWith('.kuasangse')) {
    throw new Error('.kuasangse 작업파일만 열 수 있습니다.');
  }
  return fileName;
}

function workfileBytes(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new TextEncoder().encode(String(value || ''));
  if (bytes.byteLength === 0) {
    throw new Error('빈 작업파일은 열 수 없습니다.');
  }
  if (bytes.byteLength > MAX_WORKFILE_BYTES) {
    throw new Error('작업파일이 256MB 제한을 초과했습니다.');
  }
  return bytes;
}

function workfileBuffer(value) {
  if (!(value instanceof ArrayBuffer)) {
    throw new Error('작업파일 데이터 형식이 올바르지 않습니다.');
  }
  workfileBytes(value);
  return value;
}

async function sha256Hex(root, bytes) {
  const subtle = root.crypto?.subtle;
  if (!subtle) throw new Error('작업파일 digest 검증을 지원하지 않는 환경입니다.');
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createExternalWorkfileOpenBridge({
  root,
  allowedOrigins,
  importWorkfile,
}) {
  if (!messageRecord(root)) {
    throw new TypeError('브라우저 루트 객체가 필요합니다.');
  }
  if (typeof importWorkfile !== 'function') {
    throw new TypeError('작업파일 가져오기 함수가 필요합니다.');
  }
  const commandBridge = Object.freeze({
    version: FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION,
    async hydrate(command) {
      if (
        !messageRecord(command)
        || command.contractVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
        || command.capabilityVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
      ) {
        throw new Error('작업파일 hydration 명령 버전을 지원하지 않습니다.');
      }
      const fileName = workfileName(command.fileName);
      const text = String(command.workfileText || '');
      const bytes = workfileBytes(text);
      const expectedSha256 = String(command.expectedSha256 || '').trim().toLocaleLowerCase('en-US');
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new Error('작업파일 digest 형식이 올바르지 않습니다.');
      }
      const actualSha256 = await sha256Hex(root, bytes);
      if (actualSha256 !== expectedSha256) {
        throw new Error('작업파일 digest가 일치하지 않습니다.');
      }
      const imported = await importWorkfile(text, fileName, { skipLeaveConfirm: true });
      if (!messageRecord(imported)) throw new Error('작업파일 열기가 취소되었습니다.');
      return Object.freeze({
        schema: 'factory-workfile-hydration-receipt:v1',
        capabilityVersion: FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION,
        fileName,
        workfileSha256: actualSha256,
        projectId: String(imported.projectId || '').trim(),
        name: String(imported.productKey || imported.name || '').trim(),
      });
    },
  });
  Object.defineProperty(root, '__KUASANGSE_WORKFILE_COMMAND_BRIDGE__', {
    value: commandBridge,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  const origins = new Set(
    Array.from(allowedOrigins || [], (origin) => String(origin || '').trim()).filter(Boolean),
  );
  const query = new URLSearchParams(root.location?.search || '');
  const opener = root.opener;
  if (query.get('open-source') !== OPEN_SOURCE || !opener || origins.size === 0) {
    return { active: false, dispose() {} };
  }

  const postResult = (target, targetOrigin, result) => {
    target.postMessage({ type: RESULT_MESSAGE, ...result }, targetOrigin);
  };

  const onMessage = async (event) => {
    if (event.source !== opener || !origins.has(event.origin)) return;
    if (!messageRecord(event.data)) return;
    if (event.data.type === PROBE_MESSAGE) {
      event.source.postMessage({ type: READY_MESSAGE }, event.origin);
      return;
    }
    if (event.data.type !== REQUEST_MESSAGE) return;

    let fileName = '';
    try {
      fileName = workfileName(event.data.fileName);
      const buffer = workfileBuffer(event.data.buffer);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      const imported = await importWorkfile(text, fileName);
      if (!imported) throw new Error('작업파일 열기가 취소되었습니다.');
      postResult(event.source, event.origin, {
        ok: true,
        fileName,
        message: '상세페이지 앱에서 작업파일을 열었습니다.',
      });
    } catch (error) {
      postResult(event.source, event.origin, {
        ok: false,
        fileName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  root.addEventListener('message', onMessage);
  for (const origin of origins) {
    opener.postMessage({ type: READY_MESSAGE }, origin);
  }

  return {
    active: true,
    dispose() {
      root.removeEventListener('message', onMessage);
    },
  };
}
