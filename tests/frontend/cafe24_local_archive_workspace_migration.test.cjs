const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function compileLinkedArchiveMatcher() {
  const startMarker = 'function factoryLocalArchiveLinkedAssetMatchesCurrentWork(';
  const endMarker = 'function factorySectionIdFromLocalArchiveStage(';
  const start = CORE.indexOf(startMarker);
  const end = CORE.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'Cafe24 archive hydration must recognize a linked asset after draft-to-project save');
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);

  const context = {
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim().replace(/\s+/g, '').toLowerCase(),
    factoryNormalizeStageScope: value => String(value || '').trim(),
    factoryLocalArchiveMatchesCurrentWork: asset => asset.workspaceId === 'project:project-1',
    factoryLocalArchiveMatchesCurrentProductInput: (asset, factory) => (
      asset.productKey === factory.productKey
      && asset.inputImageFingerprint === factory.inputImageFingerprint
    ),
  };
  vm.createContext(context);
  vm.runInContext(`${CORE.slice(start, end)}\nthis.matches = factoryLocalArchiveLinkedAssetMatchesCurrentWork;`, context);
  return context.matches;
}

test('Cafe24 registration hydrates a selected hero archived before the draft was saved as a project', () => {
  const matches = compileLinkedArchiveMatcher();
  const linkedAsset = {
    id: 'hero-1',
    stageId: 'hero',
    workspaceId: 'project:project-1',
    productKey: '모시바둑파우치',
    currentRunId: 'hero-run-1',
    inputImageFingerprint: 'fingerprint-1',
    metadata: { localArchiveId: 'archive-1' },
  };
  const factory = {
    assets: [linkedAsset],
    productKey: '모시바둑파우치',
    inputImageFingerprint: 'fingerprint-1',
    stages: { hero: { selectedAssetIds: ['hero-1'] } },
  };
  const archivedBeforeSave = {
    stageId: 'hero',
    workspaceId: 'draft:lastwork-1',
    productKey: '모시바둑파우치',
    currentRunId: 'hero-run-1',
    inputImageFingerprint: 'fingerprint-1',
  };

  assert.equal(matches('archive-1', archivedBeforeSave, factory), true);
  assert.equal(matches('archive-1', { ...archivedBeforeSave, inputImageFingerprint: 'foreign-image' }, factory), false);
  assert.equal(matches('unlinked-archive', archivedBeforeSave, factory), false);
});

test('Cafe24 registration checks every current hero when duplicate candidates share one archive image', () => {
  const matches = compileLinkedArchiveMatcher();
  const archivedBeforeSave = {
    stageId: 'hero',
    workspaceId: 'draft:lastwork-1',
    productKey: '모시꽃수파우치',
    currentRunId: 'hero-run-current',
    inputImageFingerprint: 'fingerprint-1',
  };
  const factory = {
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fingerprint-1',
    stages: { hero: { selectedAssetIds: ['hero-current'] } },
    assets: [
      {
        id: 'hero-stale',
        stageId: 'hero',
        workspaceId: 'project:project-1',
        productKey: '모시꽃수파우치',
        currentRunId: 'hero-run-stale',
        inputImageFingerprint: 'fingerprint-1',
        metadata: { localArchiveId: 'archive-1' },
      },
      {
        id: 'hero-current',
        stageId: 'hero',
        workspaceId: 'project:project-1',
        productKey: '모시꽃수파우치',
        currentRunId: 'hero-run-current',
        inputImageFingerprint: 'fingerprint-1',
        metadata: { localArchiveId: 'archive-1' },
      },
    ],
  };

  assert.equal(matches('archive-1', archivedBeforeSave, factory), true);
});

test('Cafe24 registration accepts the selected migrated hero even when its saved workspace id is unprefixed', () => {
  const matches = compileLinkedArchiveMatcher();
  const archivedBeforeSave = {
    stageId: 'hero',
    workspaceId: 'draft:lastwork-1',
    productKey: '모시꽃수파우치',
    currentRunId: 'hero-run-current',
    inputImageFingerprint: 'fingerprint-1',
  };
  const factory = {
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fingerprint-1',
    stages: { hero: { selectedAssetIds: ['hero-current'] } },
    assets: [{
      id: 'hero-current',
      stageId: 'hero',
      workspaceId: 'project-1',
      productKey: '모시꽃수파우치',
      currentRunId: 'hero-run-current',
      inputImageFingerprint: 'fingerprint-1',
      metadata: { localArchiveId: 'archive-1' },
    }],
  };

  assert.equal(matches('archive-1', archivedBeforeSave, factory), true);
});

test('Cafe24 registration accepts the used matching hero when duplicate restore kept only the other id selected', () => {
  const matches = compileLinkedArchiveMatcher();
  const archivedBeforeSave = {
    stageId: 'hero',
    workspaceId: 'draft:lastwork-1',
    productKey: '모시꽃수파우치',
    currentRunId: 'hero-run-archive',
    inputImageFingerprint: 'fingerprint-1',
  };
  const factory = {
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fingerprint-1',
    stages: { hero: { selectedAssetIds: ['hero-selected'] } },
    assets: [
      {
        id: 'hero-selected',
        stageId: 'hero',
        workspaceId: 'project-1',
        productKey: '모시꽃수파우치',
        currentRunId: 'hero-run-selected',
        inputImageFingerprint: 'fingerprint-1',
        metadata: { localArchiveId: 'archive-1' },
      },
      {
        id: 'hero-archive',
        stageId: 'hero',
        used: true,
        workspaceId: 'project-1',
        productKey: '모시꽃수파우치',
        currentRunId: 'hero-run-archive',
        inputImageFingerprint: 'fingerprint-1',
        metadata: { localArchiveId: 'archive-1' },
      },
    ],
  };

  assert.equal(matches('archive-1', archivedBeforeSave, factory), true);
});

test('Cafe24 registration accepts the active archive-linked hero after restore normalized its run id', () => {
  const matches = compileLinkedArchiveMatcher();
  const archivedBeforeSave = {
    stageId: 'hero',
    workspaceId: 'draft:lastwork-1',
    productKey: '모시꽃수파우치',
    currentRunId: 'hero-run-archive',
    inputImageFingerprint: 'fingerprint-1',
  };
  const factory = {
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'fingerprint-1',
    stages: { hero: { selectedAssetIds: ['hero-current-marker'] } },
    assets: [{
      id: 'hero-current-marker',
      stageId: 'hero',
      used: true,
      workspaceId: 'project-1',
      productKey: '모시꽃수파우치',
      currentRunId: 'work-run-current',
      inputImageFingerprint: 'fingerprint-1',
      metadata: { localArchiveId: 'archive-1' },
    }],
  };

  assert.equal(matches('archive-1', archivedBeforeSave, factory), true);
});

test('Cafe24 archive hydration uses the linked-asset migration matcher without weakening strict scope checks', () => {
  assert.match(
    CORE,
    /scopeDeclarationsAgree && stagesAgree[\s\S]*factoryLocalArchiveMatchesCurrentWork\(archiveScope, factory\)[\s\S]*factoryLocalArchiveLinkedAssetMatchesCurrentWork\(id, archiveScope, factory\)/,
  );
});

test('Cafe24 archive hydration stamps a verified migrated image into the current project before registration gates run', () => {
  assert.match(
    CORE,
    /const resolvedWorkspaceId = linkedAssetScopeMatches[\s\S]*factoryCurrentWorkspaceId\(factory\)[\s\S]*metadata = \{[\s\S]*workspaceId: resolvedWorkspaceId[\s\S]*sourceMap = \{[\s\S]*workspaceId: resolvedWorkspaceId/,
  );
});

test('Cafe24 migrated archive load bypasses only the already verified run gate', () => {
  assert.match(
    CORE,
    /const linkedAssetScopeMatches[\s\S]*const scopeMatches = strictScopeMatches \|\| linkedAssetScopeMatches[\s\S]*factoryRegisterAsset\(stageId, payload, \{[\s\S]*skipCurrentJobGate: linkedAssetScopeMatches/,
  );
});

test('Cafe24 migrated archive load stamps the current stage run before payload filtering', () => {
  assert.match(
    CORE,
    /const resolvedRunId = String\(\s*\(linkedAssetScopeMatches[\s\S]*factoryCurrentStageRunId\(normalizedRecordStage, factory\)[\s\S]*record\.currentRunId/,
  );
});
