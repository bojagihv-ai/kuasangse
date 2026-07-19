import { normalizeProjectScope, normalizeWorkspaceScope } from './persistence/contracts.mjs';
import {
  WorkspaceAuthorityError,
  assertCurrentAuthority,
  authorityStamp,
} from './persistence/fencing.mjs';
import { scopedSessionAssetId } from './persistence/indexeddb-adapter.mjs';

const APP_GLOBAL_AUTHORITY = Object.freeze({
  scopeId: 'app-global', leaseId: '', fencingToken: 0, revision: 0,
});

function projectRecordScope(value) {
  return normalizeProjectScope(
    value?.workspaceScope?.id || value?.scopeId || value?.currentProjectId || value?.id,
  );
}

function snapshotRecordScope(value) {
  return normalizeProjectScope(
    value?.workspaceScope?.id || value?.scopeId || value?.projectId || value?.currentProjectId,
  );
}

export function createGuardedWorkspaceMutations({ adapters, authority } = {}) {
  async function run(scopeValue, operation) {
    if (!authority?.snapshot || typeof authority?.runMutation !== 'function') {
      throw new WorkspaceAuthorityError(
        'AUTHORITY_UNAVAILABLE', 'workspace mutation coordinator is unavailable', null,
      );
    }
    const scopeId = normalizeWorkspaceScope(scopeValue);
    const claimed = authority.snapshot();
    return authority.runMutation(async () => {
      const current = assertCurrentAuthority(authority, scopeId, claimed);
      const assertAuthority = () => assertCurrentAuthority(authority, scopeId, claimed);
      const context = Object.freeze({
        assertAuthority,
        assertCompletion: assertAuthority,
        currentAuthority: current,
        persistenceAuthority: authorityStamp(current, scopeId),
        scopeId,
        leaseId: current.leaseId,
        fencingToken: current.fencingToken,
        expectedRevision: Number(current.revision) || 0,
      });
      const result = await operation(context);
      assertAuthority();
      return result;
    });
  }

  function runAppGlobal(operation) {
    if (typeof authority?.runMutation !== 'function') {
      throw new WorkspaceAuthorityError(
        'AUTHORITY_UNAVAILABLE', 'workspace mutation coordinator is unavailable', null,
      );
    }
    const assertDestinationOnly = () => true;
    const context = Object.freeze({
      assertAuthority: assertDestinationOnly,
      assertCompletion: assertDestinationOnly,
      currentAuthority: APP_GLOBAL_AUTHORITY,
      persistenceAuthority: APP_GLOBAL_AUTHORITY,
      scopeId: APP_GLOBAL_AUTHORITY.scopeId,
      leaseId: '',
      fencingToken: 0,
      expectedRevision: 0,
    });
    return authority.runMutation(() => operation(context));
  }

  function activeScope() {
    const current = authority?.snapshot?.();
    if (!current?.scopeId) {
      throw new WorkspaceAuthorityError(
        'AUTHORITY_UNAVAILABLE', 'workspace mutation scope is unavailable', current,
      );
    }
    return current.scopeId;
  }

  return Object.freeze({
    writeRecoveryValue: (key, value) => run(
      activeScope(), context => adapters.session.setItem(key, value, context),
    ),
    clearRecoveryValue: key => run(
      activeScope(), context => adapters.session.removeItem(key, context),
    ),
    saveArchiveFile: (handle, value, scopeId = activeScope()) => run(
      scopeId, context => adapters.archive.writeHandle(handle, value, context),
    ),
    savePreference: value => runAppGlobal(
      context => adapters.indexeddb.put('appSettings', value, context),
    ),
    clearPreference: id => runAppGlobal(
      context => adapters.indexeddb.delete('appSettings', id, context),
    ),
    updateProject: value => run(
      projectRecordScope(value), context => adapters.indexeddb.put('projects', value, context),
    ),
    removeProject: id => run(
      normalizeProjectScope(id), context => adapters.indexeddb.delete('projects', id, context),
    ),
    saveSnapshot: value => run(
      snapshotRecordScope(value), context => adapters.indexeddb.put('snapshots', value, context),
    ),
    removeSnapshot: (id, scopeId = activeScope()) => run(
      scopeId, context => adapters.indexeddb.delete('snapshots', id, context),
    ),
    saveSessionAssets: (scopeId, value) => run(
      scopeId, context => adapters.indexeddb.putSessionAssets(scopeId, value, context),
    ),
    clearSessionAssets: scopeId => run(
      scopeId,
      context => adapters.indexeddb.delete(
        'sessionAssets', scopedSessionAssetId(scopeId), context,
      ),
    ),
    migrateLegacySessionAssets: scopeId => run(
      scopeId, context => adapters.indexeddb.migrateLegacySessionAssets(scopeId, context),
    ),
  });
}
