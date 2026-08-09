const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODEL = path.resolve(__dirname, '../../frontend/src/production-workbench-model.mjs');

async function loadModel() {
  return import(`${pathToFileURL(MODEL).href}?io=${Date.now()}-${Math.random()}`);
}

test('Given production payloads When projected Then every Input conveyor and Output stage has the shared contract', async () => {
  // Given
  const model = await loadModel();
  const payload = {
    jobs: [{
      jobId: 'job-1',
      status: 'WAITING_MANUAL',
      eventSequence: 8,
      updatedAt: '2026-07-26T08:00:00Z',
      product: { jcode: 900001, productName: 'fixture' },
      policy: { preset: 'representative_manual' },
    }],
    reviews: [{
      reviewId: 'review-1',
      jobId: 'job-1',
      decisionType: 'representative_image',
      candidates: [{ candidateId: 'a' }, { candidateId: 'b' }],
      selectedCandidateId: 'b',
    }],
    artifacts: [{
      stageKey: 'representative_image_a_cut',
      candidateCount: 2,
      selectedCount: 1,
      syncStatus: 'synced',
      updatedAt: '2026-07-26T08:00:00Z',
      storageRef: 'artifact://representative/job-1',
      digest: 'sha256:fixture',
    }],
  };

  // When
  const projection = model.buildIoConveyorProjection(payload);

  // Then
  assert.deepEqual(model.INPUT_STAGE_KEYS, [
    'sinhwa_db_product',
    'cafe24_match_candidates',
    'manual_new_product',
    'base_images',
    'option_color_images',
    'runtime_manifest',
    'requirements_snapshot',
    'competitor_collection_request',
    'policy_overrides',
    'factory_handoff_checkpoint',
  ]);
  assert.deepEqual(model.CONVEYOR_STAGE_KEYS, [
    'intake',
    'product_matching',
    'required_values',
    'representative_image',
    'generated_images',
    'final_detail',
    'cafe24_preflight',
  ]);
  assert.deepEqual(model.OUTPUT_STAGE_KEYS, [
    'db_cafe_market_candidates',
    'required_values_snapshot',
    'representative_image_a_cut',
    'size_image_a_cut',
    'option_color_a_cut',
    'general_image_cut_a_cut',
    'section_variant_a_cut',
    'final_detail_html',
    'cafe24_preflight_payload',
    'cafe24_registration_receipt',
    'cafe24_remote_readback',
    'workfile_revision',
    'audit_timeline',
    'gpt_judgment_receipts',
  ]);
  const rows = [...projection.input, ...projection.conveyor, ...projection.output];
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), [
      'key', 'zone', 'label', 'source', 'candidateCount', 'selectedCount',
      'selectionStatus', 'policy', 'state', 'syncStatus', 'updatedAt',
      'storageRef', 'digest', 'nextAction',
    ]);
    assert.equal(typeof row.nextAction.enabled, 'boolean');
  }
  assert.deepEqual(Object.keys(projection.summary), [
    'ready', 'missing', 'waitingManual', 'syncWaiting', 'synced',
  ]);
  assert.deepEqual(
    projection.output.find(row => row.key === 'representative_image_a_cut'),
    {
      key: 'representative_image_a_cut',
      zone: 'output',
      label: '대표 이미지 후보 / 선택 A컷',
      source: 'production artifacts',
      candidateCount: 2,
      selectedCount: 1,
      selectionStatus: 'selected',
      policy: 'representative_manual',
      state: 'synced',
      syncStatus: 'synced',
      updatedAt: '2026-07-26T08:00:00Z',
      storageRef: 'artifact://representative/job-1',
      digest: 'sha256:fixture',
      nextAction: { id: 'view', enabled: true, reason: '' },
    },
  );
});

test('Given identical payloads When projected twice Then rows and status counts are deterministic', async () => {
  // Given
  const { buildIoConveyorProjection } = await loadModel();
  const payload = { jobs: [], reviews: [], artifacts: [], state: 'empty' };

  // When
  const first = buildIoConveyorProjection(payload);
  const second = buildIoConveyorProjection(structuredClone(payload));

  // Then
  assert.deepEqual(first, second);
  assert.ok([...first.input, ...first.conveyor, ...first.output].every(row => row.state === 'empty'));
});

test('Given surface lifecycle state When projected Then loading error blocked planned connected and synced remain distinguishable', async () => {
  // Given
  const { buildIoConveyorProjection } = await loadModel();
  const states = ['loading', 'error', 'blocked', 'planned', 'connected', 'synced'];

  // When
  const projected = states.map(state => buildIoConveyorProjection({ state }));

  // Then
  assert.deepEqual(projected.map(item => item.input[0].state), states);
});

test('Given a candidate review without a registered bridge When actions are built Then selection stays available and factory open stays planned', async () => {
  // Given
  const { buildCandidateReviewActions } = await loadModel();

  // When
  const actions = buildCandidateReviewActions({
    candidates: [{ candidateId: 'a', thumbnailUrl: '/api/assets/thumbnail/a.webp' }],
  });

  // Then
  assert.deepEqual(actions.map(action => action.id), [
    'view', 'all_candidates', 'select', 'next_approval', 'open_factory',
  ]);
  assert.equal(actions.find(action => action.id === 'select').enabled, true);
  assert.deepEqual(actions.find(action => action.id === 'open_factory'), {
    id: 'open_factory',
    enabled: false,
    reason: 'bridge_planned',
  });
  assert.ok(actions.every(action => !Object.hasOwn(action, 'label')));
});

test('Given unchanged polling payload When signed repeatedly Then active review DOM can remain stable until approval changes', async () => {
  // Given
  const { reviewPayloadSignature } = await loadModel();
  const open = { items: [{ reviewId: 'review-1', version: 2, selectedCandidateId: '' }] };

  // When
  const unchanged = reviewPayloadSignature(structuredClone(open));
  const approved = reviewPayloadSignature({
    items: [{ reviewId: 'review-1', version: 2, selectedCandidateId: 'candidate-b' }],
  });

  // Then
  assert.equal(reviewPayloadSignature(open), unchanged);
  assert.notEqual(unchanged, approved);
});
