/**
 * 조립공장 제어 명령이 주고받는 값의 생김새를 확인하는 자리.
 *
 * 명령을 실제로 넘기는 일(bridge)과 값이 옳은지 보는 일은 서로 다른 일이다.
 * 한 파일에 같이 두면 명령이 하나 늘 때마다 검사도 같이 불어나 파일이 계속 커진다.
 * 그래서 값 검사만 여기에 모은다.
 */

import { hasSensitiveProductField, hasSensitiveProductValue } from './batch-control-product-contract.mjs';

export const FACTORY_CONTROL_COMMAND_VERSION = 'factory-control-command:v1';
export const FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION = 'factory-workfile-hydration-command:v1';
export const FACTORY_TAB_COMMAND_ACTIONS = Object.freeze({
  workfile: Object.freeze(['export-current', 'save-checkpoint']),
  db: Object.freeze(['search', 'apply-db-candidate', 'apply-cafe24-candidate', 'confirm-no-db-candidate',
    'confirm-no-cafe24-candidate', 'clear-db-candidate', 'clear-cafe24-candidate', 'restore-detached-db']),
  fields: Object.freeze(['commitField', 'commitAllFields']),
  assets: Object.freeze(['toggleAssetUse']),
  competitor: Object.freeze(['guideAction', 'marketAction']),
  sections: Object.freeze(['updateSectionInstruction', 'updateSectionAssemblySource', 'updateSectionAssemblyCutUsage',
    'updateSectionAssemblyCut', 'updateSectionAssemblyNote', 'saveManualSection', 'applySectionVariant', 'generateSection',
    'setSectionBasisMode', 'setSectionGenerationMode', 'updateSectionOrder', 'setSectionEnabled']),
});

export class FactoryControlCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FactoryControlCommandError';
    this.code = code;
  }
}

export function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function text(value) {
  return String(value ?? '').trim();
}

/** 빠진 칸이 있으면 어느 칸인지 이름을 붙여 알린다. 그래야 어디를 채울지 안다. */
export function requireFields(value, fields, missingCode) {
  for (const field of fields) {
    if (!text(value[field])) throw new FactoryControlCommandError(`${missingCode}:${field}`);
  }
}

export function selectionPayload(value) {
  if (!record(value)) throw new FactoryControlCommandError('factory_control_payload_invalid');
  requireFields(value, [
    'productId',
    'productKey',
    'stageKey',
    'candidateId',
    'expectedRunId',
    'expectedInputFingerprint',
    'idempotencyKey',
  ], 'factory_control_field_missing');
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    throw new FactoryControlCommandError('factory_control_revision_invalid');
  }
  return Object.freeze({ ...value });
}

export function tabCommandPayload(value) {
  const fields = ['schema', 'jobId', 'tabId', 'action', 'value', 'expectedWorkspaceId', 'productId', 'productKey',
    'expectedRunId', 'expectedInputFingerprint', 'expectedRevision', 'expectedStoreRevision', 'idempotencyKey'];
  const invalid = () => { throw new FactoryControlCommandError('factory_tab_command_payload_invalid'); };
  if (!record(value) || fields.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !fields.includes(key)) || value.schema !== 'factory-tab-command:v1') invalid();
  for (const key of fields.filter(key => !['value', 'expectedRevision', 'expectedStoreRevision'].includes(key))) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key] !== value[key].trim()) invalid();
  }
  if (!Object.hasOwn(FACTORY_TAB_COMMAND_ACTIONS, value.tabId)
    || !FACTORY_TAB_COMMAND_ACTIONS[value.tabId].includes(value.action)) invalid();
  if (value.expectedWorkspaceId !== `batch:${value.jobId}`
    || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0
    || !Number.isSafeInteger(value.expectedStoreRevision) || value.expectedStoreRevision < 0
    || hasSensitiveProductField(value.value) || hasSensitiveProductValue(value.value)) invalid();
  const input = value.value;
  const shape = (keys, required = keys) => {
    if (!record(input) || Object.keys(input).some(key => !keys.includes(key))
      || required.some(key => !Object.hasOwn(input, key))) invalid();
  };
  const string = key => { if (typeof input[key] !== 'string') invalid(); };
  if (value.tabId === 'workfile') {
    shape([]);
  } else if (value.tabId === 'db') {
    if (value.action === 'search') {
      shape(['query', 'source']);
      string('query');
      if (!input.query.trim() || !['all', 'db', 'cafe24'].includes(input.source)) invalid();
    } else if (value.action.startsWith('apply-')) {
      shape(['candidateIdentity']);
      const identity = input.candidateIdentity;
      const keys = ['type', 'candidateKey', 'productNo', 'jcode', 'productCode', 'scopeKey', 'identityKey'];
      if (!record(identity) || keys.some(key => typeof identity[key] !== 'string')
        || Object.keys(identity).some(key => !keys.includes(key))
        || identity.type !== (value.action === 'apply-cafe24-candidate' ? 'cafe24' : 'sinhwa')
        || !identity.candidateKey || !identity.scopeKey || !identity.identityKey) invalid();
    } else if (input !== null && (!record(input) || Object.keys(input).length)) invalid();
  } else if (value.tabId === 'fields') {
    const fields = value.action === 'commitAllFields' ? input?.fields : [input];
    if (value.action === 'commitAllFields') {
      shape(['fields', 'renderAfter'], ['fields']);
      if (input.renderAfter !== undefined && typeof input.renderAfter !== 'boolean') invalid();
    }
    if (!Array.isArray(fields)) invalid();
    for (const field of fields) {
      if (!record(field) || Object.keys(field).some(key => !['fieldId', 'value', 'label'].includes(key))
        || typeof field.fieldId !== 'string' || typeof field.value !== 'string'
        || (field.label !== undefined && typeof field.label !== 'string') || !field.fieldId.trim()
        || /^(?:product_?name|user_?product_?name|product_?key|product_?id|workspace_?id|current_?run_?id|input_?image_?fingerprint)$/i.test(field.fieldId)) invalid();
    }
  } else if (value.tabId === 'assets') {
    if (typeof input !== 'string' || !input.trim()) invalid();
  } else if (value.tabId === 'competitor') {
    if (value.action === 'guideAction' && typeof input === 'string') {
      if (!input.trim()) invalid();
    } else if (!record(input) || !text(input[value.action === 'guideAction' ? 'action' : 'type'])) invalid();
  } else if (value.action === 'updateSectionOrder') {
    if (!Array.isArray(input) || !input.length || new Set(input).size !== input.length
      || input.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_-]*$/i.test(id))) invalid();
  } else {
    const keys = {
      updateSectionInstruction: ['value'], updateSectionAssemblySource: ['sourceId', 'selected'],
      updateSectionAssemblyCutUsage: ['cutUsage'], updateSectionAssemblyCut: ['cutAssetKey'],
      updateSectionAssemblyNote: ['note'], saveManualSection: ['content'], applySectionVariant: ['variantId'],
      generateSection: [], setSectionBasisMode: ['basisId'], setSectionGenerationMode: ['modeId'], setSectionEnabled: ['enabled'],
    }[value.action];
    shape(['sectionId', ...keys]);
    string('sectionId');
    if (!/^[a-z][a-z0-9_-]*$/i.test(input.sectionId)) invalid();
    for (const key of keys) {
      if (['enabled', 'selected'].includes(key)) { if (typeof input[key] !== 'boolean') invalid(); }
      else if (key === 'content') {
        const contentKeys = ['headline', 'subheadline', 'body_text', 'cta_text', 'extra_elements', 'layout_suggestion'];
        if (!record(input.content) || !Object.keys(input.content).length
          || Object.entries(input.content).some(([name, item]) => !contentKeys.includes(name)
            || (typeof item !== 'string' && !(name === 'extra_elements' && Array.isArray(item) && item.every(part => typeof part === 'string'))))) invalid();
      } else string(key);
    }
  }
  const freezeJson = item => {
    if (item === null || ['string', 'boolean'].includes(typeof item)) return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return Object.freeze(item.map(freezeJson));
    if (!record(item)) invalid();
    return Object.freeze(Object.fromEntries(Object.entries(item).map(([key, child]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
      return [key, freezeJson(child)];
    })));
  };
  return freezeJson(value);
}

export function hydrationPayload(value, order) {
  if (!record(value) || !record(order)) {
    throw new FactoryControlCommandError('factory_workfile_payload_invalid');
  }
  if (
    value.contractVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
    || value.capabilityVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
  ) {
    throw new FactoryControlCommandError('factory_workfile_command_version_unsupported');
  }
  requireFields(value, [
    'fileName',
    'workfileText',
    'expectedSha256',
    'expectedWorkspaceId',
    'expectedProductId',
    'expectedProductKey',
    'expectedRunId',
    'idempotencyKey',
  ], 'factory_workfile_field_missing');
  if (
    (value.expectedInputFingerprint !== undefined && !text(value.expectedInputFingerprint))
    || !/^[a-f0-9]{64}$/u.test(text(value.expectedSha256).toLocaleLowerCase('en-US'))
    || !Number.isInteger(value.expectedWorkfileRevision)
    || value.expectedWorkfileRevision < 0
  ) {
    throw new FactoryControlCommandError('factory_workfile_identity_invalid');
  }
  if (
    value.expectedProductId !== order.productId
    || value.expectedProductKey !== order.productKey
    || value.expectedRunId !== order.currentRunId
    || value.expectedWorkfileRevision !== order.expectedWorkfileRevision
    || value.idempotencyKey !== order.idempotencyKey
  ) {
    throw new FactoryControlCommandError('factory_workfile_identity_mismatch');
  }
  return Object.freeze({ ...value });
}
