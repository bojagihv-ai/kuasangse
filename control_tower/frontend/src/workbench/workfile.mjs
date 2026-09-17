/**
 * 작업파일(.kuasangse)로 시작 — 조립공장에서 저장한 작업파일을 그대로 줄에 세운다.
 *
 * 옛 앞면의 「작업파일 탭」과 같은 경로다: 파일을 읽어 분류(classifyKuasangseWorkfile)하고, 신원(작업공간·제품·실행·
 * 지문·리비전)을 뽑아 POST /api/factory/jobs/from-workfile 로 보낸다. 관제탑이 수화(hydrate) 주문을 내고 조립공장이
 * 파일을 열면 작업이 줄에 나타난다(status hydrating → running). 조립공장이 지금 다른 제품을 열고 있으면 안 된다
 * (factory_workfile_fork_foreign_live_job) — 옛 앞면과 같은 규칙.
 */
import { classifyKuasangseWorkfile, WorkfileIntakeError } from '../workfile-intake-model.mjs?workfileIntake=1';
import { workfileTabIdentity } from '../workfile-job-tabs-model.mjs?workfileTabs=7';
import { apiRequest } from './api.mjs?wb=1';

const text = value => String(value ?? '').trim();
const record = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const list = value => (Array.isArray(value) ? value : []);

const REQUIRED_ALIASES = Object.freeze({
  category: 'category',
  material: 'material',
  origin: 'originCountry',
  originCountry: 'originCountry',
  dimensions: 'size',
  size: 'size',
  sale_price: 'salePrice',
  salePrice: 'salePrice',
  stock: 'stock',
  recommended_use: 'usage',
  usage: 'usage',
  optionMode: 'optionMode',
});

export const WORKFILE_COPY = Object.freeze({
  workfile_format_invalid: '조립공장에서 저장한 .kuasangse 작업파일이 아닙니다.',
  workfile_identity_invalid: '작업파일의 신원(작업공간·제품·실행·지문)이 비었거나 서로 달라 이을 수 없습니다.',
  factory_workfile_fork_foreign_live_job: '조립공장이 지금 다른 제품을 열고 있습니다. 그 제품을 닫거나 끝낸 뒤 다시 시도하세요.',
  factory_workfile_fork_payload_invalid: '작업파일 본문이 관제탑 규격과 다릅니다.',
  factory_workfile_too_large: '작업파일이 너무 큽니다(256MB 한도).',
  idempotency_conflict: '같은 작업파일이 이미 줄에 있습니다.',
});

export async function sha256Hex(textValue) {
  const bytes = new TextEncoder().encode(textValue);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 파일을 읽고 분류한다. 돌아오는 값: { fileName, workfileText, sha256, classification } */
export async function readWorkfile(file) {
  const fileName = text(file?.name);
  if (!fileName.toLowerCase().endsWith('.kuasangse')) throw Object.assign(new Error(WORKFILE_COPY.workfile_format_invalid), { code: 'workfile_format_invalid' });
  const workfileText = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(workfileText);
  } catch {
    throw Object.assign(new Error(WORKFILE_COPY.workfile_format_invalid), { code: 'workfile_format_invalid' });
  }
  const classification = classifyKuasangseWorkfile(parsed);
  return { fileName, workfileText, sha256: await sha256Hex(workfileText), classification };
}

/** 사람이 볼 요약 한 줄. */
export function describeWorkfile(workfile) {
  const c = record(workfile?.classification);
  const inputs = record(c.inputs);
  const outputs = record(c.outputs);
  return [
    text(record(c.product).name),
    `필수값 ${Number(inputs.confirmedFieldCount) || 0}개 확인 · 비어 있음 ${Number(inputs.missingFieldCount) || 0}개`,
    `사진 ${list(inputs.images).length}장`,
    `만든 자산 ${Number(outputs.totalAssetCount) || 0}개 · 고른 것 ${Number(outputs.selectedAssetCount) || 0}개`,
    ...list(c.warnings).map(text).filter(Boolean),
  ].filter(Boolean).join(' · ');
}

/**
 * 옛 앞면의 buildWorkfileForkPayload 와 같은 본문. 조립공장이 비어 있어야(열린 제품 없음) 만든다.
 * projection 은 /api/factory/state 응답 그대로.
 */
export function buildWorkfileForkPayload({ projection, workfile }) {
  const source = record(projection);
  const session = record(source.session);
  const registration = record(source.registration);
  const classification = record(workfile?.classification);
  const identity = workfileTabIdentity(classification.identity);
  const workfileText = typeof workfile?.workfileText === 'string' ? workfile.workfileText : '';
  const sha256 = text(workfile?.sha256).toLowerCase();
  if (!workfileText.trim() || !/^[a-f0-9]{64}$/u.test(sha256) || list(record(classification.identity).conflicts).length
    || !identity.workspaceId || !identity.productKey || !identity.runId || !identity.inputFingerprint || identity.revision < 0) {
    throw Object.assign(new Error(WORKFILE_COPY.workfile_identity_invalid), { code: 'workfile_identity_invalid' });
  }
  if (text(registration.jobId) || ['workspaceId', 'productId', 'productKey', 'runId', 'inputFingerprint'].some(field => text(session[field]))) {
    throw Object.assign(new Error(WORKFILE_COPY.factory_workfile_fork_foreign_live_job), { code: 'factory_workfile_fork_foreign_live_job' });
  }
  const requiredValues = Object.fromEntries(
    list(record(classification.inputs).requiredFields)
      .filter(field => text(record(field).status) === 'confirmed' && REQUIRED_ALIASES[text(record(field).key)])
      .map(field => [REQUIRED_ALIASES[text(record(field).key)], text(record(field).value)])
      .filter(([, value]) => value),
  );
  const productName = text(record(classification.product).name || workfile.fileName);
  let hydratedProductId = identity.productId;
  if (!hydratedProductId) {
    try {
      const document = record(JSON.parse(workfileText));
      const payload = record(record(document.project).payload);
      const assetPayload = record(payload.assetPayload);
      const factory = record(Object.keys(record(payload.factory)).length ? payload.factory : assetPayload.factory);
      const finalDb = record(record(factory.product).finalDb);
      const productNos = [...new Set([finalDb.cafe24_product_no, finalDb.product_no].map(value => text(value)).filter(value => /^[1-9]\d*$/u.test(value)))];
      if (productNos.length > 1) throw Object.assign(new Error(WORKFILE_COPY.workfile_identity_invalid), { code: 'workfile_identity_invalid' });
      if (productNos.length === 1) hydratedProductId = `cafe24:${productNos[0]}`;
    } catch (error) {
      if (error?.code === 'workfile_identity_invalid') throw error;
    }
  }
  return Object.freeze({
    fileName: text(workfile.fileName),
    workfileText,
    expectedSha256: sha256,
    expectedWorkspaceId: identity.workspaceId,
    expectedProductId: hydratedProductId || `factory:${identity.productKey}`,
    expectedProductKey: identity.productKey,
    expectedRunId: identity.runId,
    expectedInputFingerprint: identity.inputFingerprint,
    expectedWorkfileRevision: Number.isInteger(session.revision) ? session.revision : 0,
    expectedHydratedWorkfileRevision: identity.revision,
    batchId: `workfile:${sha256.slice(0, 16)}`,
    mode: 'manual',
    productName,
    requiredValues,
    idempotencyKey: `factory-workfile-fork:${sha256}:${identity.revision}:manual`,
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 줄에 세우고, 조립공장이 파일을 열어 작업이 나타날 때까지 기다린다(최대 60초). 돌아오는 값은 그 작업. */
export async function submitWorkfile(workfile, { request = apiRequest } = {}) {
  const projection = await request('/api/factory/state');
  const payload = buildWorkfileForkPayload({ projection, workfile });
  const accepted = await request('/api/factory/jobs/from-workfile', { method: 'POST', body: payload });
  if (text(accepted?.status) !== 'hydrating' && !record(accepted?.job).jobId) {
    throw Object.assign(new Error('관제탑이 작업파일 접수 상태를 돌려주지 않았습니다.'), { code: 'factory_workfile_fork_receipt_invalid' });
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await request('/api/factory/jobs');
    const job = list(result?.jobs).find(item => text(item.sourceSha256).toLowerCase() === payload.expectedSha256
      && Number(item.sourceRevision) === Number(payload.expectedHydratedWorkfileRevision));
    if (job) return { job, payload };
    await wait(2000);
  }
  return { job: record(accepted?.job), payload };
}

export { WorkfileIntakeError };
