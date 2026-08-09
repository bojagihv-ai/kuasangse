import {
  list,
  text,
  tinyHash,
} from './work-bundle-foundation.mjs';

export async function resolveWorkBundleUpload(
  descriptor,
  {
    fetcher,
    backendBaseUrl = 'http://127.0.0.1:5050',
  } = {},
) {
  if (typeof fetcher !== 'function') throw new Error('fetch_unavailable');
  const source = text(descriptor?.source);
  if (!source) throw new Error('asset_source_missing');
  const target = source.startsWith('/api/')
    ? `${String(backendBaseUrl).replace(/\/+$/, '')}${source}`
    : source;
  const response = await fetcher(target);
  if (!response?.ok) {
    throw new Error(`asset_source_failed:${response?.status || 0}`);
  }
  const blob = await response.blob();
  const mimeType = text(blob.type || descriptor.mimeType).toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw new Error(`asset_mime_unsupported:${mimeType || 'unknown'}`);
  }
  return Object.freeze({
    blob,
    mimeType,
    filename: text(descriptor.filename) || `asset-${tinyHash(descriptor.assetKey)}.png`,
  });
}

async function runBounded(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
      run,
    ),
  );
  return results;
}

export async function synchronizeWorkBundlePlan(
  plan,
  {
    sendManifest,
    sendAsset,
    fetcher,
    backendBaseUrl = 'http://127.0.0.1:5050',
    concurrency = 2,
  } = {},
) {
  if (typeof sendManifest !== 'function' || typeof sendAsset !== 'function') {
    throw new Error('sync_transport_missing');
  }
  const missingRequiredAssetKeys = list(plan.missingRequiredAssetKeys).map(text).filter(Boolean);
  if (missingRequiredAssetKeys.length) {
    throw new Error(
      `work_bundle_required_assets_missing:${missingRequiredAssetKeys.length}:`
      + missingRequiredAssetKeys.join(','),
    );
  }
  const saved = await sendManifest(plan.manifest, plan.idempotencyKey);
  if (saved?.authoritativeSaved !== true || !saved.bundle?.id) {
    throw new Error('work_bundle_manifest_not_saved');
  }
  const remoteAssets = new Map(
    list(saved.bundle.assets).map((asset) => [text(asset.assetKey), asset]),
  );
  const failures = [];
  const reusedAssetKeys = [];
  const pendingUploads = [];
  for (const descriptor of plan.uploads) {
    const remote = remoteAssets.get(descriptor.assetKey);
    if (!remote?.id) {
      failures.push({
        assetKey: descriptor.assetKey,
        message: `work_bundle_asset_missing:${descriptor.assetKey}`,
      });
    } else if (remote.storedAssetId && remote.contentReference) {
      reusedAssetKeys.push(descriptor.assetKey);
    } else {
      pendingUploads.push({ descriptor, remote });
    }
  }
  const preparedUploads = await runBounded(pendingUploads, concurrency, async ({ descriptor, remote }) => {
    try {
      const content = await resolveWorkBundleUpload(descriptor, {
        fetcher,
        backendBaseUrl,
      });
      return { descriptor, remote, content };
    } catch (error) {
      failures.push({
        assetKey: descriptor.assetKey,
        message: String(error?.message || error || 'asset_upload_failed'),
      });
      return null;
    }
  });
  if (failures.length) {
    throw new Error(
      `work_bundle_assets_failed:${failures.length}:`
      + failures.map((failure) => failure.assetKey).join(','),
    );
  }
  const uploads = await runBounded(preparedUploads.filter(Boolean), concurrency, async ({
    descriptor,
    remote,
    content,
  }) => {
    try {
      const uploaded = await sendAsset({
        bundleId: saved.bundle.id,
        assetId: remote.id,
        assetKey: descriptor.assetKey,
        version: Number(remote.version || 1),
        idempotencyKey: `${plan.idempotencyKey}:asset:${tinyHash(descriptor.assetKey)}`,
        ...content,
      });
      if (!uploaded?.storedAssetId) {
        throw new Error(`work_bundle_asset_not_confirmed:${descriptor.assetKey}`);
      }
      return uploaded;
    } catch (error) {
      failures.push({
        assetKey: descriptor.assetKey,
        message: String(error?.message || error || 'asset_upload_failed'),
      });
      return null;
    }
  });
  if (failures.length) {
    throw new Error(
      `work_bundle_assets_failed:${failures.length}:`
      + failures.map((failure) => failure.assetKey).join(','),
    );
  }
  return Object.freeze({
    bundle: saved.bundle,
    uploads: Object.freeze(uploads.filter(Boolean)),
    reusedAssetKeys: Object.freeze(reusedAssetKeys),
  });
}
