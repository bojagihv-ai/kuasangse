export const WORKSPACE_PERSISTENCE_SCHEMA = 'kuasangse.workspace';
export const WORKSPACE_PERSISTENCE_VERSION = 2;
export const AUTHORITATIVE_ADAPTER = 'indexeddb';
export const PERSISTENCE_ADAPTER_NAMES = Object.freeze([
  'session', 'indexeddb', 'server', 'workfile', 'archive',
]);
export const RESTORE_SOURCE_PRECEDENCE = Object.freeze([
  'indexeddb', 'server', 'session', 'archive',
]);

export const PREFERENCE_STORAGE_KEYS = Object.freeze(new Set([
  'model_config', 'api_status_collapsed', 'section_instructions', 'image_directives',
  'brand_presets_v1', 'active_brand_preset_id', 'layout_template_v1',
  'section_generation_modes_v1', 'section_basis_modes_v1', 'section_assembly_v1',
  'competitor_tip_bank_v1', 'option_style_samples_v1', 'factory_cafe24_field_view_v1',
  'fixed_detail_images_v1', 'cuts_prompts', 'cuts_prompts_live_backup',
  'cuts_prompts_slot_backup', 'cuts_prompts_history', 'cuts_prompt_slot_count',
  'cuts_prompts_updated_at', 'cuts_size_prompts', 'cuts_size_prompt_slot_count',
  'cuts_size_prompts_updated_at', 'cuts_placement', 'factory_db_field_presets',
  'section_drive_folder_id', 'detail_insert_drive_folder_id', 'cuts_work_drive_folder_id',
  'cuts_work_drive_folder_name', 'auto_input_folder_id', 'auto_input_folder_name',
  'auto_output_folder_id', 'auto_output_folder_name', 'auto_interval',
  'kuasangse.projectFileLocationLabel.v1', 'gemini_backend_url', 'server_auto_api_base',
]));

export const CREDENTIAL_STORAGE_KEYS = Object.freeze(new Set([
  'pdp_openai_api_key', 'openai_api_key', 'openaiKey', 'OPENAI_API_KEY',
  'gemini_api_key', 'gd_client_id',
]));

function cleanText(value) {
  return String(value ?? '').trim();
}

export function normalizeProjectScope(projectId) {
  let value = cleanText(projectId);
  if (!value) throw new TypeError('project identity is required');
  if (/^draft:/i.test(value)) throw new TypeError('draft scope is not a project identity');
  while (/^project:/i.test(value)) value = value.slice('project:'.length).trim();
  if (!value) throw new TypeError('project identity is required');
  if (/^draft:/i.test(value)) throw new TypeError('draft scope is not a project identity');
  return `project:${value}`;
}

export function normalizeWorkspaceScope(value) {
  let cleaned = cleanText(value?.id ?? value);
  if (!cleaned) throw new TypeError('workspace scope is required');
  if (/^draft:/i.test(cleaned)) {
    while (/^draft:/i.test(cleaned)) cleaned = cleaned.slice('draft:'.length).trim();
    if (!cleaned) throw new TypeError('draft identity is required');
    if (/^project:/i.test(cleaned)) throw new TypeError('project scope is not a draft identity');
    return `draft:${cleaned}`;
  }
  return normalizeProjectScope(cleaned);
}

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

export function normalizePersistenceMetadata(metadata, scopeId) {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('persistence metadata is required');
  const operationId = cleanText(metadata.operationId);
  if (!operationId) throw new TypeError('operationId is required');
  const scope = normalizeWorkspaceScope(scopeId);
  const revisionSource = metadata.revision && typeof metadata.revision === 'object'
    ? metadata.revision
    : {};
  const revision = Object.freeze({
    scopeId: normalizeWorkspaceScope(revisionSource.scopeId || scope),
    counter: finiteInteger(revisionSource.counter),
    updatedAt: finiteInteger(revisionSource.updatedAt),
    writerId: cleanText(revisionSource.writerId) || 'unknown',
  });
  if (revision.scopeId !== scope || revision.counter < 1) throw new TypeError('revision must match scope and have a positive counter');
  return Object.freeze({
    operationId,
    revision,
    fencingToken: cleanText(metadata.fencingToken),
    leaseId: cleanText(metadata.leaseId),
  });
}

export function createPersistenceMetadata({ scopeId, revision, fencingToken = '', leaseId = '', operationId = '' } = {}) {
  const scope = normalizeWorkspaceScope(scopeId);
  const id = cleanText(operationId)
    || (typeof crypto === 'undefined' ? '' : crypto.randomUUID?.())
    || `operation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return normalizePersistenceMetadata({ operationId: id, revision, fencingToken, leaseId }, scope);
}

export function isCredentialOrPreferenceKey(key) {
  const value = cleanText(key);
  return CREDENTIAL_STORAGE_KEYS.has(value) || PREFERENCE_STORAGE_KEYS.has(value);
}
