const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.resolve(__dirname, '../../frontend');
const HTML = path.join(FRONTEND, 'control-tower.html');
const MODEL = path.join(FRONTEND, 'src', 'workfile-intake-model.mjs');
const MODULE = path.join(FRONTEND, 'src', 'workfile-intake.mjs');
const WORKER = path.join(FRONTEND, 'src', 'workfile-intake-worker.mjs');
const PRODUCT_INTAKE = path.join(FRONTEND, 'src', 'product-intake.mjs');

function fixture() {
  return {
    format: 'kuasangse.factory.project',
    version: 1,
    workspaceId: 'project-alpha',
    exportedAt: '2026-07-27T12:00:00.000Z',
    persistence: {
      revision: {
        scopeId: 'project:project-alpha',
        counter: 7,
      },
    },
    summary: {
      productName: '모시바둑파우치',
      assets: 4,
      sections: 2,
    },
    resultReport: {
      schema: 'kuasangse.workfile-result-report',
      status: { code: 'cafe24_registered', label: 'Cafe24 등록 완료' },
      workfile: { name: '모시바둑파우치.kuasangse' },
      cafe24: {
        registered: true,
        productNo: '3000',
        productCode: 'P00000MOSI',
        productName: '모시바둑파우치',
        mallId: 'bojagi1928',
        sourceWorkfileName: '모시바둑파우치.kuasangse',
        adminUrl: 'https://bojagi1928.cafe24.com/disp/admin/shop1/product/ProductRegister?product_no=3000',
        storefrontUrl: 'https://bojagi1928.cafe24.com/product/detail.html?product_no=3000',
        optionGroupCount: 1,
        optionValueCount: 2,
        variantCount: 2,
      },
    },
    project: {
      id: 'project-alpha',
      name: '모시바둑파우치',
      payload: {
        productInfoFieldSettings: {
          product_name: { active: true, required: true },
          material: { active: true, required: true },
          width_mm: { active: true, required: true },
        },
        productInfoManualValues: { material: '모시' },
        sectionOrder: ['header', 'hook'],
        sectionImages: {
          header: '__stored_in_indexeddb__',
          hook: '',
        },
        currentSectionVariantIds: {
          header: 'variant-header-a',
          hook: '',
        },
        factory: {
          product: {
            productName: '모시바둑파우치',
            selectedDbCandidateKey: '930',
            naturalHint: '파우치, 전통 선물',
            hasImage: true,
            imageName: '1.기본.jpg',
            inputImages: [
              { id: 'input-1', name: '1.기본.jpg', mime: 'image/jpeg' },
              { id: 'input-2', name: '2.꽃핑크.jpg', colorName: '꽃핑크', mime: 'image/jpeg' },
            ],
            competitors: [{ id: 'competitor-1' }],
            finalDb: {
              product_name: '모시바둑파우치',
              width_mm: '20.5cm',
            },
          },
          stages: {
            hero: { status: 'completed', selectedAssetIds: ['hero-a'] },
            size: { status: 'completed', selectedAssetIds: ['size-a'] },
            options: { status: 'waiting_manual', selectedAssetIds: [] },
          },
          assets: [
            { id: 'hero-a', stageId: 'hero', title: '대표 A컷', imageUrl: '/api/local-archive/assets/hero-a/image' },
            { id: 'hero-b', stageId: 'hero', title: '대표 후보 2' },
            { id: 'size-a', stageId: 'size', title: '사이즈 A컷' },
            { id: 'option-a', stageId: 'options', title: '옵션 후보' },
          ],
        },
      },
    },
  };
}

test('작업파일의 필수값과 이미지를 Input/Output으로 분류한다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?test=${Date.now()}`);
  const result = model.classifyKuasangseWorkfile(fixture());

  assert.equal(result.product.name, '모시바둑파우치');
  assert.equal(result.product.jcode, 930);
  assert.equal(result.file.revision, 7);
  assert.equal(result.inputs.requiredFields.length, 3);
  assert.equal(result.inputs.confirmedFieldCount, 3);
  assert.equal(result.inputs.missingFieldCount, 0);
  assert.deepEqual(
    result.inputs.images.map(image => [image.role, image.name]),
    [
      ['base', '1.기본.jpg'],
      ['color-option', '2.꽃핑크.jpg'],
    ],
  );
  assert.equal(result.inputs.competitorCount, 1);
  assert.equal(result.publication.registered, true);
  assert.equal(result.publication.productNo, '3000');
  assert.equal(result.publication.sourceWorkfileName, '모시바둑파우치.kuasangse');
  assert.equal(result.publication.variantCount, 2);
  assert.equal(result.outputs.totalAssetCount, 4);
  assert.equal(result.outputs.selectedAssetCount, 2);
  assert.deepEqual(
    result.outputs.stages.map(stage => [stage.key, stage.candidateCount, stage.selectedCount]),
    [
      ['hero', 2, 1],
      ['size', 1, 1],
      ['options', 1, 0],
      ['sections', 1, 1],
    ],
  );
  assert.equal(result.outputs.sectionCount, 2);
});

test('지원하지 않는 JSON은 작업파일로 성공 처리하지 않는다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?test=${Date.now()}-invalid`);

  assert.throws(
    () => model.classifyKuasangseWorkfile({ format: 'plain-json', version: 1 }),
    error => error.code === 'workfile_format_invalid',
  );
});

test('실제 B 중첩 identity alias는 충돌 없이 정규화하고 productId를 만들지 않는다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?actual-b=${Date.now()}`);
  const value = fixture();
  delete value.workspaceId;
  delete value.project.payload.factory.product.productId;
  value.persistence.revision.counter = 87;
  const identity = {
    projectId: 'batch:factory-job-b',
    workspaceId: 'batch:factory-job-b',
    productKey: '미니 데스크 오거나이저 B',
    currentRunId: 'run-b-87',
    inputImageFingerprint: 'sha256:b-input',
  };
  value.manifest = { identity: { ...identity } };
  value.project.payload.projectFileManifest = { identity: { ...identity } };
  Object.assign(value.project.payload.factory.product, identity);

  const result = model.classifyKuasangseWorkfile(value);

  assert.deepEqual(result.identity, {
    workspaceId: 'batch:factory-job-b',
    productId: '',
    productKey: '미니 데스크 오거나이저 B',
    runId: 'run-b-87',
    inputFingerprint: 'sha256:b-input',
    revision: 87,
    conflicts: [],
  });

  value.project.payload.projectFileManifest.identity.productKey = '다른 제품';
  const conflicting = model.classifyKuasangseWorkfile(value);
  assert.deepEqual(conflicting.identity.conflicts, ['productKey']);

  value.project.payload.projectFileManifest.identity.productKey = identity.productKey;
  for (const [expectedConflict, mutate] of [
    ['workspaceId', candidate => { candidate.project.payload.projectFileManifest.identity.workspaceId = 'batch:other'; }],
    ['productId', candidate => {
      candidate.manifest.identity.productId = 'cafe24:1';
      candidate.project.payload.projectFileManifest.identity.productId = 'cafe24:2';
    }],
    ['runId', candidate => { candidate.project.payload.projectFileManifest.identity.currentRunId = 'run-other'; }],
    ['inputFingerprint', candidate => { candidate.project.payload.projectFileManifest.identity.inputImageFingerprint = 'sha256:other'; }],
    ['revision', candidate => { candidate.manifest.identity.revision = 88; }],
  ]) {
    const candidate = structuredClone(value);
    mutate(candidate);
    assert.deepEqual(model.classifyKuasangseWorkfile(candidate).identity.conflicts, [expectedConflict]);
  }
});

test('생산관제 화면에 작업파일 선택과 분류 결과 영역이 존재한다', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const moduleSource = fs.readFileSync(MODULE, 'utf8');
  const productIntakeSource = fs.readFileSync(PRODUCT_INTAKE, 'utf8');

  for (const id of [
    'workfile-input',
    'workfile-import-status',
    'workfile-classification',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /accept=["'][^"']*\.kuasangse/);
  assert.match(html, /src=["']\.\/src\/workfile-intake\.mjs(?:\?[^"']*)?["']/);
  assert.equal(fs.existsSync(MODULE), true);
  assert.equal(fs.existsSync(WORKER), true);
  assert.match(moduleSource, /id = 'workfile-link-status'/);
  assert.match(moduleSource, /id = 'workfile-jump-button'/);
  assert.match(moduleSource, /control-tower:workfile-product-linked/);
  assert.match(productIntakeSource, /control-tower:workfile-product-linked/);
  assert.match(html, /#workfile-intake-section[^{]*\{[^}]*word-break:\s*keep-all/s);
});
