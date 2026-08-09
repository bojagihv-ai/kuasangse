const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const WORKBENCH = path.resolve(
  __dirname,
  '..',
  '..',
  'frontend',
  'src',
  'production-workbench.mjs',
);

function projection({
  sequence,
  cursor,
  productKey = 'product:current',
  runId = 'run:current',
  selectedId = 'representative-a',
} = {}) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    connected: true,
    sequence,
    cursor,
    session: {
      workspaceId: `project:${productKey}`,
      productId: `factory:${productKey}`,
      productKey,
      runId,
      inputFingerprint: `sha256:${runId}`,
      revision: sequence,
    },
    inputs: [],
    stages: [{
      key: 'representative',
      status: 'done',
      selectedId,
      selectedIds: [selectedId],
      candidates: [{ id: selectedId }],
    }],
    progress: { stageKey: 'representative', percent: 50, status: 'manual' },
    registration: { status: 'blocked', blockers: ['final_detail_a_cut'] },
  };
}

function message(lastEventId, payload) {
  return { lastEventId, data: JSON.stringify(payload) };
}

test('SSE reconnect uses only accepted BFF event IDs across a 512+ projection gap', async () => {
  const {
    applyFactorySseMessage,
    factoryEventsUrl,
  } = await import(`${pathToFileURL(WORKBENCH).href}?t=${Date.now()}`);
  let current = projection({ sequence: 484, cursor: '484' });
  let factoryEventCursor = '';

  assert.equal(factoryEventsUrl(factoryEventCursor), '/api/factory/events');
  assert.throws(
    () => applyFactorySseMessage(
      current,
      factoryEventCursor,
      message('932', { projection: projection({ sequence: 120, cursor: '120', productKey: 'product:old', runId: 'run:old' }) }),
    ),
    error => error.code === 'stale_event_sequence',
  );
  assert.equal(factoryEventCursor, '');

  const accepted = applyFactorySseMessage(
    current,
    factoryEventCursor,
    message('1425', { projection: projection({ sequence: 485, cursor: '485', selectedId: 'representative-b' }) }),
  );
  current = accepted.projection;
  factoryEventCursor = accepted.factoryEventCursor;

  assert.equal(factoryEventCursor, '1425');
  assert.equal(current.cursor, '485');
  assert.equal(current.stages[0].selectedId, 'representative-b');
  assert.equal(factoryEventsUrl(factoryEventCursor), '/api/factory/events?cursor=1425');
  for (const staleId of ['932', '1424', '1425']) {
    assert.throws(
      () => applyFactorySseMessage(
        current,
        factoryEventCursor,
        message(staleId, { projection: projection({ sequence: 486, cursor: '486', productKey: 'product:old', runId: 'run:old' }) }),
      ),
      error => error.code === 'stale_factory_event_id',
    );
  }

  const next = applyFactorySseMessage(
    current,
    factoryEventCursor,
    message('1426', { projection: projection({ sequence: 486, cursor: '486', productKey: 'product:next', runId: 'run:next' }) }),
  );
  assert.equal(next.factoryEventCursor, '1426');
  assert.equal(next.projection.session.productKey, 'product:next');
  assert.equal(next.projection.session.runId, 'run:next');
  assert.equal(next.projection.stages[0].selectedId, 'representative-a');
});

test('same-sequence initial snapshot establishes only the BFF event cursor', async () => {
  const {
    applyFactorySseMessage,
    factoryEventsUrl,
  } = await import(`${pathToFileURL(WORKBENCH).href}?same=${Date.now()}`);
  const current = projection({ sequence: 484, cursor: '484' });
  const accepted = applyFactorySseMessage(
    current,
    '',
    message('932', { projection: projection({ sequence: 484, cursor: '484' }) }),
  );

  assert.equal(accepted.factoryEventCursor, '932');
  assert.equal(accepted.projection.cursor, '484');
  assert.equal(factoryEventsUrl(accepted.factoryEventCursor), '/api/factory/events?cursor=932');
  assert.throws(
    () => applyFactorySseMessage(
      accepted.projection,
      accepted.factoryEventCursor,
      message('933', {
        projection: projection({
          sequence: 484,
          cursor: '484',
          productKey: 'product:old',
          runId: 'run:old',
        }),
      }),
    ),
    error => error.code === 'stale_event_sequence',
  );
});
