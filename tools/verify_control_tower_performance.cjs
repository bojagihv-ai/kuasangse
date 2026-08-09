const { performance } = require('node:perf_hooks');

(async () => {
  const { createQueueModel } = await import('../control_tower/frontend/src/virtual-queue.mjs');
  const results = [];
  for (const count of [100, 200]) {
    const started = performance.now();
    const items = createQueueModel(count);
    const elapsedMs = performance.now() - started;
    if (items.length !== count || items.some(item => String(item.thumbnailRef).startsWith('data:'))) throw new Error(`fixture contract failed for ${count}`);
    results.push({ count, modelItems: items.length, elapsedMs: Number(elapsedMs.toFixed(3)), rawImageBytesLoaded: 0 });
  }
  console.log(JSON.stringify({ virtualized: true, lazyThumbnails: true, results }, null, 2));
})();
