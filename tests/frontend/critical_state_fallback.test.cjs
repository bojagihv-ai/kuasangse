const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');

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

const source = fs.readFileSync(CORE_02, 'utf8');
const minimalSource = extractFunction(source, 'buildMinimalLocalSessionPayload');
const emergencySource = extractFunction(source, 'buildEmergencyLocalSessionPayload');

function makeBuilder(functionSource) {
  return Function(
    'compactFactoryForLocalSession',
    'compactCutsForLocalSession',
    'stripOptionSorterImages',
    'stripCompPageImages',
    'stripFixedDetailImagesForSession',
    'loadFixedDetailImages',
    'scrubLocalSessionValue',
    `"use strict"; ${functionSource}; return ${functionSource.match(/function (\w+)\(/)[1]};`,
  )(
    value => value,
    value => value,
    value => value,
    value => value,
    value => value,
    () => [],
    value => value,
  );
}

const buildMinimal = makeBuilder(minimalSource);
const buildEmergency = makeBuilder(emergencySource);

function payload() {
  return {
    step: 'factory',
    productName: '모시꽃수파우치',
    dbMatchCandidates: [{ jcode: 'db-1', product_name: '모시꽃수파우치' }],
    dbMatchLastQuery: '모시꽃수파우치',
    dbMatchSelectionOpen: true,
    compPage: {
      marketScrape: {
        results: [{ id: 'vm-1', siteId: 'auction' }],
        vmResults: [{ id: 'vm-1', siteId: 'auction' }],
        selectedIds: ['vm-1'],
        scrapedImages: [{ id: 'image-1', src: 'https://example.test/image.jpg' }],
        lastUpdatedAt: 123,
      },
    },
    factory: {
      product: {
        productName: '모시꽃수파우치',
        dbCandidates: [{ jcode: 'db-1' }],
        pendingDbCandidates: [{ jcode: 'db-1' }],
        cafe24Candidates: [{ product_no: 'cafe24-1' }],
        pendingCafe24Candidates: [{ product_no: 'cafe24-1' }],
        selectedDbCandidateKey: 'db-1',
        selectedCafe24CandidateKey: 'cafe24-1',
        dbCandidateResolution: 'selected',
        cafe24CandidateResolution: 'selected',
      },
      competitors: {
        compPage: {
          marketScrape: {
            vmResults: [{ id: 'vm-1', siteId: 'auction' }],
            selectedIds: ['vm-1'],
          },
        },
      },
    },
  };
}

function assertCriticalState(snapshot, label) {
  assert.equal(snapshot.dbMatchCandidates?.length, 1, `${label}: DB 후보가 보존되어야 합니다.`);
  assert.equal(snapshot.dbMatchLastQuery, '모시꽃수파우치', `${label}: DB 검색어가 보존되어야 합니다.`);
  assert.equal(snapshot.compPage?.marketScrape?.vmResults?.length, 1, `${label}: VM 후보가 보존되어야 합니다.`);
  assert.deepEqual(snapshot.compPage?.marketScrape?.selectedIds, ['vm-1'], `${label}: VM 선택 상태가 보존되어야 합니다.`);
  assert.equal(snapshot.factory?.product?.dbCandidates?.length, 1, `${label}: factory DB 후보가 보존되어야 합니다.`);
  assert.equal(snapshot.factory?.product?.cafe24Candidates?.length, 1, `${label}: factory Cafe24 후보가 보존되어야 합니다.`);
  assert.equal(snapshot.factory?.product?.selectedDbCandidateKey, 'db-1', `${label}: DB 선택키가 보존되어야 합니다.`);
  assert.equal(snapshot.factory?.product?.selectedCafe24CandidateKey, 'cafe24-1', `${label}: Cafe24 선택키가 보존되어야 합니다.`);
}

test('용량 fallback도 마지막 작업의 DB/Cafe24/VM 후보와 선택 상태를 보존한다', () => {
  // Given: 이미지/진행 상태가 포함된 마지막 작업 payload.
  const original = payload();

  // When: minimal/emergency fallback payload를 만든다.
  const minimal = buildMinimal(original);
  const emergency = buildEmergency(original);

  // Then: 어떤 fallback을 선택해도 새로고침 뒤 핵심 작업 상태가 남아 있어야 한다.
  assertCriticalState(minimal, 'minimal fallback');
  assertCriticalState(emergency, 'emergency fallback');
});
