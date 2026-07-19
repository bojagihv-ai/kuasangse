import { normalizeProjectScope } from './contracts.mjs';
import { assertDestinationVersion, assertReplicaCanPublish } from './fencing.mjs';

const DEFAULT_DB = Object.freeze({
  name: 'pdp_workspace_v1',
  version: 4,
  stores: Object.freeze(['projects', 'snapshots', 'sessionAssets', 'appSettings']),
});

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

function legacyScope(record) {
  const raw = record?.scopeId
    || record?.workspaceScope?.id
    || record?.workspaceRevision?.scopeId
    || record?.currentProjectId;
  if (!raw) return '';
  try { return normalizeProjectScope(raw); } catch (_) { return ''; }
}

export function createBrowserIndexedDbDriver(root, config = DEFAULT_DB) {
  let openDatabase = null;

  async function database() {
    if (openDatabase) return openDatabase;
    if (!root.indexedDB) throw new Error('IndexedDB unavailable');
    const request = root.indexedDB.open(config.name, config.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of config.stores) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
      const snapshots = request.transaction?.objectStore('snapshots');
      if (snapshots && !snapshots.indexNames.contains('projectId')) {
        snapshots.createIndex('projectId', 'projectId', { unique: false });
      }
      if (snapshots && !snapshots.indexNames.contains('createdAt')) {
        snapshots.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    openDatabase = await requestResult(request);
    openDatabase.onversionchange = () => {
      openDatabase.close();
      openDatabase = null;
    };
    return openDatabase;
  }

  async function transact(storeNames, mode, action) {
    const db = await database();
    const transaction = db.transaction(storeNames, mode);
    const result = await action(transaction);
    await transactionDone(transaction);
    return result;
  }

  async function compareAndMutate(storeNames, guard, action) {
    return transact(storeNames, 'readwrite', async transaction => {
      const store = transaction.objectStore(guard.storeName);
      const current = await requestResult(store.get(guard.key));
      guard.assertAuthority?.();
      if (guard.expectedDestinationVersion !== undefined) {
        assertDestinationVersion(current, guard.expectedDestinationVersion);
      }
      assertReplicaCanPublish(current, guard.envelope);
      return action(transaction);
    });
  }

  return Object.freeze({
    database,
    async delete(storeName, key) {
      return transact(
        [storeName], 'readwrite',
        transaction => transaction.objectStore(storeName).delete(key),
      );
    },
    async get(storeName, key) {
      return transact(
        [storeName], 'readonly',
        transaction => requestResult(transaction.objectStore(storeName).get(key)),
      );
    },
    async getAll(storeName) {
      return transact(
        [storeName], 'readonly',
        transaction => requestResult(transaction.objectStore(storeName).getAll()),
      );
    },
    async put(storeName, value) {
      return transact(
        [storeName], 'readwrite',
        transaction => transaction.objectStore(storeName).put(value),
      );
    },
    async putMany(entries) {
      const storeNames = [...new Set(entries.map(entry => entry.storeName))];
      return transact(storeNames, 'readwrite', transaction => {
        for (const entry of entries) transaction.objectStore(entry.storeName).put(entry.value);
      });
    },
    async compareAndPut(storeName, value, guard) {
      return compareAndMutate(
        [storeName], { ...guard, storeName, key: value.id },
        transaction => transaction.objectStore(storeName).put(value),
      );
    },
    async compareAndDelete(storeName, key, guard) {
      return compareAndMutate(
        [storeName], { ...guard, storeName, key },
        transaction => transaction.objectStore(storeName).delete(key),
      );
    },
    async compareAndPutMany(entries, guard) {
      const storeNames = [...new Set([guard.storeName, ...entries.map(entry => entry.storeName)])];
      return compareAndMutate(storeNames, guard, transaction => {
        for (const entry of entries) transaction.objectStore(entry.storeName).put(entry.value);
      });
    },
    async migrateLegacySessionAssets(scopeId, targetValue, envelope, assertAuthority) {
      return transact(['sessionAssets'], 'readwrite', async transaction => {
        const store = transaction.objectStore('sessionAssets');
        const existing = await requestResult(store.get(targetValue.id));
        if (existing) return { migrated: false, reason: 'scoped-record-exists', record: existing };
        const legacy = await requestResult(store.get('current'));
        if (!legacy || legacyScope(legacy) !== scopeId) {
          return { migrated: false, reason: 'identity-mismatch' };
        }
        assertAuthority?.();
        assertReplicaCanPublish(existing, envelope);
        store.put(targetValue);
        store.delete('current');
        return { migrated: true, record: targetValue };
      });
    },
  });
}
