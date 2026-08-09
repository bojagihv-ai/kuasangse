import { migrateLegacySession } from './migrations.mjs';
import { normalizeWorkspaceScope } from './contracts.mjs';
import { assertReplicaCanPublish, persistenceFence } from './fencing.mjs';
import { sanitizeWorkspaceSnapshot, workspaceContentDigest } from './serialization.mjs';

export const WORKSPACE_SESSION_KEYS = Object.freeze(new Set([
  'pdp_session', 'pdp_session_img', 'pdp_session_imgs', 'pdp_detail_image_blocks',
  'pdp_last_work_bootstrap_v1', 'pdp_last_work_draft_scope_v1',
  'pdp_option_sorter_live_v1',
  'pdp_last_input_checkpoint_v1',
  'factory_last_snapshot_v1',
  'fixed_detail_images_v1', 'comp_analysis',
  'kuasangse.projectFileLocationLabel.v1',
  'cuts_size_results_cache_v1',
  'factory_wizard_field_drafts_v1',
  'kuasangse_comp_market_candidate_snapshot_v1',
  'kuasangse_comp_market_image_selection_v1',
]));

function parse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

const RECOVERY_RECORD_SCHEMA = 'kuasangse.recovery.v1';
const LAST_WORK_BOOTSTRAP_KEY = 'pdp_last_work_bootstrap_v1';
const OPTION_SORTER_LIVE_RECOVERY_KEY = 'pdp_option_sorter_live_v1';
// Only ephemeral, tab-local UI recovery records may ignore a rotated lease on
// reload. The canonical workspace envelope (`pdp_session`) must keep fencing
// so a stale tab cannot overwrite a newer edit or mask a lease conflict.
const PER_TAB_RECOVERY_KEYS = Object.freeze(new Set([
  OPTION_SORTER_LIVE_RECOVERY_KEY,
  'pdp_last_input_checkpoint_v1',
  'factory_wizard_field_drafts_v1',
  'fixed_detail_images_v1',
  'cuts_size_results_cache_v1',
  'kuasangse_comp_market_candidate_snapshot_v1',
  'kuasangse_comp_market_image_selection_v1',
]));

function recoveryRecord(raw) {
  const value = parse(raw);
  return value?.schema === RECOVERY_RECORD_SCHEMA ? value : null;
}

function recordScope(record) {
  const value = record?.scopeId
    || record?.workspaceScope?.id
    || record?.workspaceRevision?.scopeId
    || record?.currentProjectId;
  if (!value) return '';
  try { return normalizeWorkspaceScope(value); } catch (_) { return ''; }
}

export function createSessionStorageAdapter({ storage, draftStorage = storage, authority = null } = {}) {
  const sessionStorage = storage || (typeof self === 'undefined' ? null : self.localStorage);
  const perTabDraftStorage = draftStorage || sessionStorage;
  // Active documents are deliberately tab-local. Shared localStorage is never a
  // replica for work state: a sibling tab must be physically unable to read or
  // overwrite this tab's product, image, factory snapshot, or bootstrap pointer.
  const storagesForKey = () => [perTabDraftStorage].filter(Boolean);
  const isPerTabStartupRecovery = (key, targetStorage) => (
    (key === LAST_WORK_BOOTSTRAP_KEY || key === OPTION_SORTER_LIVE_RECOVERY_KEY)
    && targetStorage === perTabDraftStorage
    && perTabDraftStorage !== sessionStorage
  );
  const isPerTabWorkspaceRecovery = (key, targetStorage) => (
    PER_TAB_RECOVERY_KEYS.has(key)
    && targetStorage === perTabDraftStorage
    && perTabDraftStorage !== sessionStorage
  );
  function assertWorkspaceKey(key) {
    if (!WORKSPACE_SESSION_KEYS.has(key)) throw new Error(`unclassified workspace session key: ${key}`);
  }

  return Object.freeze({
    name: 'session',
    getItem(key) {
      assertWorkspaceKey(key);
      for (const targetStorage of storagesForKey(key)) {
        const raw = targetStorage.getItem(key) ?? null;
        if (raw === null) continue;
        const record = recoveryRecord(raw);
        if (!record) return raw;
        if (key !== 'pdp_last_work_draft_scope_v1'
          && !isPerTabStartupRecovery(key, targetStorage)
          && !isPerTabWorkspaceRecovery(key, targetStorage)) {
          const current = authority?.snapshot?.() || null;
          const stored = persistenceFence(record);
          if (stored.scopeId && current?.scopeId && stored.scopeId !== current.scopeId) continue;
          if (stored.scopeId === current?.scopeId && stored.fencingToken < Number(current.fencingToken)) continue;
          if (stored.scopeId === current?.scopeId
            && stored.fencingToken === Number(current.fencingToken)
            && stored.leaseId && current.leaseId && stored.leaseId !== current.leaseId) continue;
        }
        return record.value;
      }
      return null;
    },
    removeItem(key, context = {}) {
      assertWorkspaceKey(key);
      context.assertAuthority?.();
      const targets = storagesForKey(key).map(targetStorage => ({
        targetStorage,
        previous: targetStorage.getItem(key) ?? null,
      }));
      for (const { targetStorage, previous } of targets) {
        const existing = recoveryRecord(previous);
        if (existing
          && key !== 'pdp_last_work_draft_scope_v1'
          && !isPerTabStartupRecovery(key, targetStorage)
          && !isPerTabWorkspaceRecovery(key, targetStorage)) {
          assertReplicaCanPublish(existing, { persistenceAuthority: context.persistenceAuthority });
        }
      }
      for (const { targetStorage } of targets) targetStorage.removeItem(key);
      try {
        context.assertCompletion?.();
      } catch (error) {
        for (const { targetStorage, previous } of targets) {
          if (previous !== null && targetStorage.getItem(key) === null) targetStorage.setItem(key, previous);
        }
        throw error;
      }
    },
    setItem(key, value, context = {}) {
      assertWorkspaceKey(key);
      context.assertAuthority?.();
      const candidate = {
        schema: RECOVERY_RECORD_SCHEMA,
        value: String(value),
        persistenceAuthority: context.persistenceAuthority || {},
      };
      const targets = storagesForKey(key).map(targetStorage => ({
        targetStorage,
        previous: targetStorage.getItem(key) ?? null,
      }));
      for (const { targetStorage, previous } of targets) {
        const existing = recoveryRecord(previous);
        if (existing
          && key !== 'pdp_last_work_draft_scope_v1'
          && !isPerTabStartupRecovery(key, targetStorage)
          && !isPerTabWorkspaceRecovery(key, targetStorage)) {
          assertReplicaCanPublish(existing, candidate);
        }
      }
      const serialized = JSON.stringify(candidate);
      try {
        for (const { targetStorage } of targets) targetStorage.setItem(key, serialized);
        context.assertCompletion?.();
      } catch (error) {
        for (const { targetStorage, previous } of targets) {
          if (targetStorage.getItem(key) !== serialized) continue;
          if (previous === null) targetStorage.removeItem(key);
          else targetStorage.setItem(key, previous);
        }
        throw error;
      }
    },
    async read(scopeId) {
      const scope = normalizeWorkspaceScope(scopeId);
      for (const targetStorage of storagesForKey('pdp_session')) {
        const session = parse(targetStorage.getItem('pdp_session'));
        if (session?.persistenceEnvelope?.scopeId === scope) return structuredClone(session.persistenceEnvelope);
        if (session && recordScope(session) === scope) return migrateLegacySession(session);
      }
      return null;
    },
    async write(envelope, context = {}) {
      context.assertAuthority?.();
      const targets = storagesForKey('pdp_session').map(targetStorage => ({
        targetStorage,
        previous: targetStorage.getItem('pdp_session') ?? null,
        previousBootstrap: targetStorage.getItem(LAST_WORK_BOOTSTRAP_KEY) ?? null,
      }));
      for (const { targetStorage, previous } of targets) {
        const existing = parse(previous)?.persistenceEnvelope || null;
        if (!isPerTabWorkspaceRecovery('pdp_session', targetStorage)) {
          assertReplicaCanPublish(existing, envelope, {
            allowSameRevisionMutation: context.allowSameRevisionMutation === true,
          });
        }
      }
      const sessionSnapshot = context.recoverySnapshot
        ? sanitizeWorkspaceSnapshot(context.recoverySnapshot)
        : envelope.snapshot;
      const sessionEnvelope = sessionSnapshot === envelope.snapshot ? envelope : Object.freeze({
        ...envelope,
        digest: workspaceContentDigest(sessionSnapshot),
        snapshot: sessionSnapshot,
      });
      const serialized = JSON.stringify({
        ...sessionSnapshot,
        workspaceScope: { id: envelope.scopeId },
        workspaceRevision: envelope.metadata.revision,
        savedAt: envelope.savedAt,
        persistenceEnvelope: sessionEnvelope,
      });
      const writeBootstrap = context.writeBootstrap === true;
      const bootstrapAuthority = writeBootstrap ? {
        scopeId: envelope.scopeId,
        leaseId: String(context.leaseId || envelope.metadata.leaseId || ''),
        fencingToken: Number(context.fencingToken || envelope.metadata.fencingToken) || 0,
        revision: Number(envelope.metadata.revision?.counter) || 0,
        operationId: String(envelope.metadata.operationId || ''),
        digest: String(envelope.digest || ''),
      } : null;
      const bootstrap = writeBootstrap ? {
        workspaceScope: { id: envelope.scopeId },
        workspaceRevision: envelope.metadata.revision,
        currentProjectId: String(envelope.snapshot?.currentProjectId || envelope.scopeId.replace(/^project:/i, '')),
        currentProjectName: String(envelope.snapshot?.currentProjectName || ''),
        currentProjectCreatedAt: envelope.snapshot?.currentProjectCreatedAt || null,
        step: String(envelope.snapshot?.step || 'upload'),
        savedAt: envelope.savedAt,
      } : null;
      const bootstrapCandidate = writeBootstrap ? {
        schema: RECOVERY_RECORD_SCHEMA,
        value: JSON.stringify(bootstrap),
        persistenceAuthority: bootstrapAuthority,
      } : null;
      if (bootstrapCandidate) {
        for (const { targetStorage } of targets) {
          const existingBootstrap = recoveryRecord(targetStorage.getItem(LAST_WORK_BOOTSTRAP_KEY));
          if (existingBootstrap
            && !isPerTabStartupRecovery(LAST_WORK_BOOTSTRAP_KEY, targetStorage)
            && !isPerTabWorkspaceRecovery(LAST_WORK_BOOTSTRAP_KEY, targetStorage)) {
            assertReplicaCanPublish(existingBootstrap, bootstrapCandidate, {
              allowSameRevisionMutation: context.allowSameRevisionMutation === true,
            });
          }
        }
      }
      const serializedBootstrap = bootstrapCandidate ? JSON.stringify(bootstrapCandidate) : '';
      try {
        for (const { targetStorage } of targets) {
          targetStorage.setItem('pdp_session', serialized);
          if (serializedBootstrap) targetStorage.setItem(LAST_WORK_BOOTSTRAP_KEY, serializedBootstrap);
        }
        context.assertCompletion?.();
      } catch (error) {
        for (const { targetStorage, previous, previousBootstrap } of targets) {
          if (serializedBootstrap && targetStorage.getItem(LAST_WORK_BOOTSTRAP_KEY) === serializedBootstrap) {
            if (previousBootstrap === null) targetStorage.removeItem(LAST_WORK_BOOTSTRAP_KEY);
            else targetStorage.setItem(LAST_WORK_BOOTSTRAP_KEY, previousBootstrap);
          }
          if (targetStorage.getItem('pdp_session') !== serialized) continue;
          if (previous === null) targetStorage.removeItem('pdp_session');
          else targetStorage.setItem('pdp_session', previous);
        }
        throw error;
      }
      return envelope;
    },
  });
}
