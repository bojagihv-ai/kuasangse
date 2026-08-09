const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');
const NATIVE_JSON = JSON;

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 정의를 찾지 못했습니다.`);
  const parameterStart = fileSource.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '(') parameterDepth += 1;
    if (fileSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const braceStart = fileSource.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 경계를 찾지 못했습니다.`);
}

function makeSelector({ maxChars, scrub, prepare, compact, minimal, emergency, stringify }) {
  const selectSource = extractFunction(source(CORE_02), 'selectLocalSessionPayload');
  return Function(
    'scrubLocalSessionValue',
    'prepareLocalSessionPayload',
    'buildCompactLocalSessionPayload',
    'buildMinimalLocalSessionPayload',
    'buildEmergencyLocalSessionPayload',
    'LOCAL_SESSION_MAX_CHARS',
    'JSON',
    `"use strict"; ${selectSource}; return selectLocalSessionPayload;`,
  )(scrub, prepare, compact, minimal, emergency, maxChars, { stringify });
}

function countingStringify(counter, options = {}) {
  return value => {
    counter.stringify += 1;
    if (options.throwWhen?.(value)) throw new Error('serialization failed');
    return NATIVE_JSON.stringify(value);
  };
}

test('작은 세션은 첫 payload만 직렬화하고 fallback builder를 호출하지 않는다', () => {
  // Given: 첫 payload가 cap 안에 들어가며 fallback 호출을 관찰할 카운터가 있다.
  const counter = { scrub: 0, prepare: 0, compact: 0, minimal: 0, emergency: 0, stringify: 0 };
  const prepared = { kind: 'prepared', value: 'small' };
  const select = makeSelector({
    maxChars: 100,
    scrub: () => {
      counter.scrub += 1;
      return prepared;
    },
    prepare: () => {
      counter.prepare += 1;
      return prepared;
    },
    compact: () => {
      counter.compact += 1;
      return { kind: 'compact' };
    },
    minimal: () => {
      counter.minimal += 1;
      return { kind: 'minimal' };
    },
    emergency: () => {
      counter.emergency += 1;
      return { kind: 'emergency' };
    },
    stringify: countingStringify(counter),
  });

  // When: small payload selection runs.
  const result = select({ source: 'small' });

  // Then: no fallback work occurs and returned JSON/size describe the selected payload.
  const expectedJson = NATIVE_JSON.stringify(prepared);
  assert.deepEqual(counter, {
    scrub: 1,
    prepare: 0,
    compact: 0,
    minimal: 0,
    emergency: 0,
    stringify: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload, prepared);
  assert.equal(result.json, expectedJson);
  assert.equal(result.size, expectedJson.length);
});

test('cap 초과 또는 직렬화 오류일 때 필요한 fallback만 한 번씩 시도한다', () => {
  // Given: prepared/compact payload는 cap을 넘고 minimal만 cap 안에 들어간다.
  const counter = { scrub: 0, prepare: 0, compact: 0, minimal: 0, emergency: 0, stringify: 0 };
  const prepared = { kind: 'prepared', value: 'x'.repeat(100) };
  const compact = { kind: 'compact', value: 'x'.repeat(100) };
  const minimal = { kind: 'minimal' };
  const select = makeSelector({
    maxChars: 40,
    scrub: () => {
      counter.scrub += 1;
      return prepared;
    },
    prepare: () => {
      counter.prepare += 1;
      return prepared;
    },
    compact: () => {
      counter.compact += 1;
      return compact;
    },
    minimal: () => {
      counter.minimal += 1;
      return minimal;
    },
    emergency: () => {
      counter.emergency += 1;
      return { kind: 'emergency' };
    },
    stringify: countingStringify(counter),
  });

  // When: oversized payload selection runs.
  const result = select({ source: 'large' });

  // Then: each needed form is built/serialized once, and emergency is not built.
  const expectedJson = NATIVE_JSON.stringify(minimal);
  assert.deepEqual(counter, {
    scrub: 1,
    prepare: 0,
    compact: 1,
    minimal: 1,
    emergency: 0,
    stringify: 3,
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload, minimal);
  assert.equal(result.json, expectedJson);
  assert.equal(result.size, expectedJson.length);

  // Given: the first candidate's serialization throws before the compact fallback fits.
  const throwCounter = { scrub: 0, prepare: 0, compact: 0, minimal: 0, emergency: 0, stringify: 0 };
  const throwPrepared = { kind: 'throw-prepared' };
  const throwCompact = { kind: 'compact' };
  const throwSelect = makeSelector({
    maxChars: 40,
    scrub: () => {
      throwCounter.scrub += 1;
      return throwPrepared;
    },
    prepare: () => {
      throwCounter.prepare += 1;
      return throwPrepared;
    },
    compact: () => {
      throwCounter.compact += 1;
      return throwCompact;
    },
    minimal: () => {
      throwCounter.minimal += 1;
      return { kind: 'minimal' };
    },
    emergency: () => {
      throwCounter.emergency += 1;
      return { kind: 'emergency' };
    },
    stringify: countingStringify(throwCounter, {
      throwWhen: value => value === throwPrepared,
    }),
  });

  // When: serialization failure forces the next fallback.
  const throwResult = throwSelect({ source: 'throws' });

  // Then: only the compact fallback is built and its JSON is reused.
  const throwJson = NATIVE_JSON.stringify(throwCompact);
  assert.deepEqual(throwCounter, {
    scrub: 1,
    prepare: 0,
    compact: 1,
    minimal: 0,
    emergency: 0,
    stringify: 2,
  });
  assert.equal(throwResult.ok, true);
  assert.equal(throwResult.payload, throwCompact);
  assert.equal(throwResult.json, throwJson);
  assert.equal(throwResult.size, throwJson.length);
});

test('모든 일반 fallback이 cap을 넘으면 마지막 emergency payload를 그대로 반환한다', () => {
  // Given: every candidate is larger than the cap, including the emergency form.
  const counter = { scrub: 0, prepare: 0, compact: 0, minimal: 0, emergency: 0, stringify: 0 };
  const candidates = {
    prepared: { kind: 'prepared', value: 'x'.repeat(100) },
    compact: { kind: 'compact', value: 'x'.repeat(100) },
    minimal: { kind: 'minimal', value: 'x'.repeat(100) },
    emergency: { kind: 'emergency', value: 'x'.repeat(100) },
  };
  const select = makeSelector({
    maxChars: 20,
    scrub: () => {
      counter.scrub += 1;
      return candidates.prepared;
    },
    prepare: () => {
      counter.prepare += 1;
      return candidates.prepared;
    },
    compact: () => {
      counter.compact += 1;
      return candidates.compact;
    },
    minimal: () => {
      counter.minimal += 1;
      return candidates.minimal;
    },
    emergency: () => {
      counter.emergency += 1;
      return candidates.emergency;
    },
    stringify: countingStringify(counter),
  });

  // When: selection reaches the final emergency fallback.
  const result = select({ source: 'unavoidably-large' });

  // Then: the final form is accepted even though it remains over the cap.
  const expectedJson = NATIVE_JSON.stringify(candidates.emergency);
  assert.deepEqual(counter, {
    scrub: 1,
    prepare: 0,
    compact: 1,
    minimal: 1,
    emergency: 1,
    stringify: 4,
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload, candidates.emergency);
  assert.equal(result.json, expectedJson);
  assert.equal(result.size, expectedJson.length);
  assert.ok(result.size > 20);
});

test('emergency fallback도 옵션 분류기의 색상명과 사진-슬롯 조합을 버리지 않는다', () => {
  const emergencySource = extractFunction(source(CORE_02), 'buildEmergencyLocalSessionPayload');
  const buildEmergency = Function(
    'compactCutsForLocalSession',
    'stripCompPageImages',
    'stripOptionSorterImages',
    'scrubLocalSessionValue',
    `"use strict"; ${emergencySource}; return buildEmergencyLocalSessionPayload;`,
  )(
    () => ({}),
    () => ({}),
    value => value,
    value => value,
  );
  const optionSorter = {
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['image_1'] }],
    pool: ['image_2'],
    images: [{ id: 'image_1', name: '원본 1', archiveId: 'archive_1' }],
    optionPairOrder: ['slot_1'],
    optionAutoColorNameStatus: '색상명 저장 완료',
  };

  const payload = buildEmergency({ step: 'optionsorter', optionSorter });

  assert.deepEqual(payload.optionSorter.slots, optionSorter.slots);
  assert.deepEqual(payload.optionSorter.pool, optionSorter.pool);
  assert.equal(payload.optionSorter.optionPairOrder[0], 'slot_1');
  assert.equal(payload.optionSorter.optionAutoColorNameStatus, '색상명 저장 완료');
});
