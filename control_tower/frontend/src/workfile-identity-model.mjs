function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? '').trim();
}

function revision(value) {
  const candidate = typeof value === 'object' ? record(value).counter : value;
  const normalized = Number(candidate);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function values(sources, aliases, normalize = text) {
  const unique = new Set();
  for (const source of sources) {
    for (const alias of aliases) {
      const value = normalize(record(source)[alias]);
      if (value !== '' && value !== null) unique.add(value);
    }
  }
  return [...unique];
}

function canonical(candidates, conflictKey, conflicts) {
  if (candidates.length > 1) {
    conflicts.push(conflictKey);
    return '';
  }
  return candidates[0] ?? '';
}

export function resolveWorkfileIdentity(value) {
  const root = record(value);
  const project = record(root.project);
  const payload = record(project.payload);
  const assetPayload = record(payload.assetPayload);
  const factory = record(Object.keys(record(payload.factory)).length ? payload.factory : assetPayload.factory);
  const product = record(factory.product);
  const manifestIdentity = record(record(root.manifest).identity);
  const projectManifestIdentity = record(record(payload.projectFileManifest).identity);
  const identitySources = [manifestIdentity, projectManifestIdentity, product];
  const conflicts = [];
  const canonicalWorkspaces = values(identitySources, ['workspaceId', 'projectId']);
  const workspaceId = canonical(
    canonicalWorkspaces.length
      ? canonicalWorkspaces
      : values([{ workspaceId: root.workspaceId }, { projectId: project.id }], ['workspaceId', 'projectId']),
    'workspaceId',
    conflicts,
  );
  const productId = canonical(values([
    ...identitySources,
    record(product.finalDb),
  ], ['productId', 'currentProductId']), 'productId', conflicts);
  const productKey = canonical(values(identitySources, [
    'productKey',
    'currentProductKey',
  ]), 'productKey', conflicts);
  const runId = canonical(values(identitySources, [
    'runId',
    'currentRunId',
    'generationRunId',
  ]), 'runId', conflicts);
  const inputFingerprint = canonical(values([
    ...identitySources,
    factory,
    payload,
  ], ['inputFingerprint', 'inputImageFingerprint']), 'inputFingerprint', conflicts);
  const normalizedRevision = canonical(values([
    record(root.persistence).revision,
    ...identitySources,
    factory,
  ], ['counter', 'revision', 'workspaceRevision'], revision), 'revision', conflicts);
  return Object.freeze({
    workspaceId,
    productId,
    productKey,
    runId,
    inputFingerprint,
    revision: normalizedRevision === '' ? -1 : normalizedRevision,
    conflicts: Object.freeze(conflicts),
  });
}
