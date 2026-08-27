const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODEL_URL = pathToFileURL(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'bulk-intake-model.mjs'),
).href;

const files = names => names.map(name => ({ name }));

test('파일 이름에서 제품과 장 번호를 읽는다', async () => {
  const { readImageName } = await import(MODEL_URL);

  assert.deepEqual(readImageName('공단보자기 45cm.jpg'), { productName: '공단보자기 45cm', ordinal: 1 });
  assert.deepEqual(readImageName('공단보자기_2.png'), { productName: '공단보자기', ordinal: 2 });
  assert.deepEqual(readImageName('자수파우치-3.webp'), { productName: '자수파우치', ordinal: 3 });
  assert.deepEqual(readImageName('보자기 12.JPG'), { productName: '보자기', ordinal: 12 });
});

test('여러 장을 같은 제품으로 묶고 장 순서를 정리한다', async () => {
  const { groupImageFiles } = await import(MODEL_URL);

  const grouped = groupImageFiles(files([
    '보자기_3.jpg',
    '보자기_1.jpg',
    '보자기_2.jpg',
    '파우치.png',
    '설명서.pdf',
  ]));

  assert.deepEqual(grouped.products.map(item => item.productName), ['보자기', '파우치']);
  assert.deepEqual(grouped.products[0].images.map(image => image.fileName), ['보자기_1.jpg', '보자기_2.jpg', '보자기_3.jpg']);
  assert.deepEqual(grouped.products[0].images.map(image => image.ordinal), [1, 2, 3]);
  assert.equal(grouped.products[1].images.length, 1);
  assert.deepEqual(grouped.skipped, [{ fileName: '설명서.pdf', reason: 'unsupported_type' }]);
});

test('한글 머리글 CSV 를 읽고 제품별 값을 붙인다', async () => {
  const { parseIntakeCsv } = await import(MODEL_URL);

  const parsed = parseIntakeCsv([
    '제품명,분류,소재,원산지,크기,판매가,용도',
    '보자기,주방,면 100%,대한민국,45cm,12000,생활',
    '파우치,잡화,"폴리, 면",대한민국,20cm,"9,500",수납',
    ',주방,면,대한민국,10cm,1000,생활',
  ].join('\n'));

  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], {
    productName: '보자기',
    requiredValues: { category: '주방', material: '면 100%', originCountry: '대한민국', size: '45cm', salePrice: '12000', usage: '생활' },
  });
  assert.equal(parsed.rows[1].requiredValues.material, '폴리, 면');
  assert.deepEqual(parsed.errors, [{ line: 4, reason: 'product_name_missing' }]);
});

test('제품명 열이 없는 CSV 는 이유를 밝히고 거절한다', async () => {
  const { parseIntakeCsv } = await import(MODEL_URL);

  const parsed = parseIntakeCsv('분류,소재\n주방,면');

  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.errors, [{ line: 1, reason: 'product_name_column_missing' }]);
});

test('파일 묶음과 CSV 와 기본값을 합쳐 투입 계획을 만든다', async () => {
  const { groupImageFiles, parseIntakeCsv, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기.jpg', '파우치_1.jpg', '파우치_2.jpg']));
  const csv = parseIntakeCsv('제품명,분류,판매가\n보자기,주방,12000\n없는제품,잡화,5000');

  const plan = buildBulkPlan(grouped, csv.rows, { material: '면 100%', originCountry: '대한민국' });

  assert.equal(plan.entries.length, 2);
  const [wrapper, pouch] = plan.entries;
  assert.equal(wrapper.productName, '보자기');
  assert.deepEqual(wrapper.requiredValues, {
    material: '면 100%', originCountry: '대한민국', category: '주방', salePrice: '12000',
  });
  assert.deepEqual(wrapper.issues, []);
  assert.equal(wrapper.matchedCsv, true);
  // CSV 에 없는 제품은 기본값만 받고, 빠진 값은 미리 표시된다.
  assert.equal(pouch.productName, '파우치');
  assert.equal(pouch.matchedCsv, false);
  assert.deepEqual(pouch.issues, ['category_missing', 'sale_price_missing']);
  assert.deepEqual(plan.unmatchedCsv, ['없는제품']);
  assert.equal(plan.ready, 2);
  assert.equal(plan.warned, 1);
});

test('계획 한 줄을 조립공장 투입 payload 로 바꾼다', async () => {
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const plan = buildBulkPlan(
    groupImageFiles(files(['보자기_1.jpg', '보자기_2.jpg'])),
    [],
    { category: '주방', material: '면', originCountry: '대한민국', size: '45cm', salePrice: '12,000원', usage: '생활' },
  );

  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'batch-bulk',
    imageModel: 'gemini-3.1-flash-image',
    dataUrls: ['data:image/jpeg;base64,AAA=', 'data:image/jpeg;base64,BBB='],
    sha256s: ['aaa', 'bbb'],
  });

  assert.equal(payload.contractType, 'manual-product-intake');
  assert.equal(payload.productName, '보자기');
  assert.equal(payload.workfileName, '보자기.kuasangse');
  assert.equal(payload.category, '주방');
  assert.equal(payload.source.kind, 'manual');
  assert.equal(payload.mode, 'manual');
  // 판매가는 숫자만 남긴다. 백엔드가 숫자만 받기 때문이다.
  assert.equal(payload.requiredValues.salePrice, '12000');
  // 기본 사진만 있으면 옵션이 없는 제품이다. 여기서 'provided' 로 보내면 조립공장이 만들 수
  // 없는 색상옵션 단계를 돌리다 막힌다.
  assert.equal(payload.requiredValues.optionMode, 'none');
  assert.equal(payload.inputImages.length, 2);
  assert.deepEqual(payload.inputImages.map(image => image.ordinal), [1, 2]);
  assert.deepEqual(payload.inputImages.map(image => image.role), ['base', 'base']);
  assert.equal(payload.inputImages[0].sha256, 'aaa');
  assert.equal(payload.idempotencyKey, 'bulk-batch-bulk-보자기-aaa');
});

test('이미지 없이 payload 를 만들려 하면 거절한다', async () => {
  const { buildProductPayload } = await import(MODEL_URL);

  assert.throws(() => buildProductPayload({ productName: '보자기', images: [] }, { dataUrls: [] }), TypeError);
  assert.throws(
    () => buildProductPayload({ productName: '', images: [{ fileName: 'a.jpg' }] }, { dataUrls: ['x'] }),
    TypeError,
  );
});

test('투입 결과를 한 줄로 요약한다', async () => {
  const { summarizeBulkIntake } = await import(MODEL_URL);

  assert.deepEqual(summarizeBulkIntake([{ status: 'queued' }, { status: 'queued' }, { status: 'error' }]), {
    queued: 2, failed: 1, tone: 'warning', copy: '2건 투입 · 1건 실패',
  });
  assert.equal(summarizeBulkIntake([{ status: 'queued' }]).tone, 'ok');
  assert.equal(summarizeBulkIntake([{ status: 'error' }]).tone, 'error');
  assert.equal(summarizeBulkIntake([]).copy, '투입할 제품이 없습니다.');
});

test('옵션 사진에 색상명을 붙이면 옵션 있는 제품으로 투입한다', async () => {
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg', '보자기_2.jpg']));
  // 두 번째 사진을 색상 옵션으로 지정한다.
  grouped.products[0].images[1].role = 'color-option';
  grouped.products[0].images[1].colorName = '남색';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'batch-bulk',
    dataUrls: ['data:image/jpeg;base64,AAA=', 'data:image/jpeg;base64,BBB='],
    sha256s: ['aaa', 'bbb'],
  });

  assert.equal(payload.requiredValues.optionMode, 'provided');
  assert.deepEqual(payload.inputImages.map(image => image.role), ['base', 'color-option']);
  assert.equal(payload.inputImages[1].colorName, '남색');
  assert.equal(payload.inputImages[0].colorName, undefined);
});

test('옵션 사진인데 색상명이 없으면 투입 전에 잡아낸다', async () => {
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg', '보자기_2.jpg']));
  grouped.products[0].images[1].role = 'color-option';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  assert.ok(plan.entries[0].issues.includes('color_name_missing'));
});

test('기본 이미지가 하나도 없으면 투입 전에 잡아낸다', async () => {
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  grouped.products[0].images[0].role = 'color-option';
  grouped.products[0].images[0].colorName = '남색';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  assert.ok(plan.entries[0].issues.includes('base_image_missing'));
});

test('조립공장이 채울 수 없는 흠은 투입 가능 수에서 빠진다', async () => {
  // Given: 색상명 없는 옵션 사진과, 값만 비어 있는 정상 제품을 함께 둔다.
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg', '보자기_2.jpg', '파우치_1.jpg']));
  const pouch = grouped.products.find(product => product.productName === '보자기');
  pouch.images[1].role = 'color-option';

  // When: 계획을 세운다.
  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });

  // Then: 색상명이 없는 제품은 막히고, 값만 빈 제품은 투입할 수 있다.
  // 막는 흠을 '투입 가능' 으로 세면 버튼이 열린 채 남아 눌러야만 실패를 알게 된다.
  const blockedEntry = plan.entries.find(entry => entry.productName === '보자기');
  assert.ok(blockedEntry.issues.includes('color_name_missing'));
  assert.equal(plan.blocked, 1);
  assert.equal(plan.ready, 1);
  // 기본값을 채워 넣었으므로 파우치에는 흠이 없다 — 경고는 0 이다.
  assert.equal(plan.warned, 0);
});

test('기본 사진이 없는 제품도 투입 가능 수에서 빠진다', async () => {
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  grouped.products[0].images[0].role = 'color-option';
  grouped.products[0].images[0].colorName = '남색';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });

  assert.equal(plan.blocked, 1);
  assert.equal(plan.ready, 0);
});

test('값만 비어 있는 제품은 여전히 투입할 수 있다', async () => {
  // 분류·판매가는 조립공장이 채운다. 이것까지 막으면 정상 흐름이 멈춘다.
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['파우치_1.jpg']));

  const plan = buildBulkPlan(grouped, [], {});

  assert.ok(plan.entries[0].issues.includes('category_missing'));
  assert.equal(plan.ready, 1);
  assert.equal(plan.blocked, 0);
});

test('기본 사진 하나로 단일 색상 옵션까지 만든다', async () => {
  // 색상값은 color-option 역할의 사진에서만 읽힌다. 기본 사진 한 장으로 색상을 만들려면
  // 같은 사진이 기본과 색상 옵션 양쪽으로 실려야 한다.
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  grouped.products[0].images[0].role = 'base-and-color';
  grouped.products[0].images[0].colorName = '남색';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  assert.deepEqual(plan.entries[0].issues, []);

  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'batch-bulk',
    dataUrls: ['data:image/jpeg;base64,AAA='],
    sha256s: ['aaa'],
  });

  assert.equal(payload.requiredValues.optionMode, 'provided');
  assert.deepEqual(payload.inputImages.map(image => image.role), ['base', 'color-option']);
  assert.equal(payload.inputImages[1].colorName, '남색');
  assert.equal(payload.inputImages[0].dataUrl, payload.inputImages[1].dataUrl);
});
