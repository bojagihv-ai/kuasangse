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

  assert.deepEqual(readImageName('공단보자기 45cm.jpg'), { productName: '공단보자기 45cm', ordinal: 1, colorName: '' });
  assert.deepEqual(readImageName('공단보자기_2.png'), { productName: '공단보자기', ordinal: 2, colorName: '' });
  assert.deepEqual(readImageName('자수파우치-3.webp'), { productName: '자수파우치', ordinal: 3, colorName: '' });
  assert.deepEqual(readImageName('보자기 12.JPG'), { productName: '보자기', ordinal: 12, colorName: '' });
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

  const plan = buildBulkPlan(grouped, csv.rows, { material: '면 100%', originCountry: '대한민국', size: '20x15cm' });

  assert.equal(plan.entries.length, 2);
  const [wrapper, pouch] = plan.entries;
  assert.equal(wrapper.productName, '보자기');
  assert.deepEqual(wrapper.requiredValues, {
    material: '면 100%', originCountry: '대한민국', size: '20x15cm',
    widthMm: '200', depthMm: '150', category: '주방', salePrice: '12000',
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

  // When: 계획을 세운다. (가로·세로는 조립공장이 못 채우므로 여기서는 채워 둔다)
  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', size: '20x15cm' });

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
  // 가로·세로는 조립공장이 못 채우므로 여기서는 채워 두고, 나머지만 비운다.
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['파우치_1.jpg']));

  const plan = buildBulkPlan(grouped, [], { size: '20x15cm' });

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

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', size: '20x15cm' });
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


test('파일명에 적어 둔 색상명을 제품 묶음을 깨지 않고 읽어 온다', async () => {
  // Given: 제품명_번호_색상 으로 적은 사진들.
  const { groupImageFiles, readImageName } = await import(MODEL_URL);

  // When: 이름을 읽고 묶는다.
  const parsed = readImageName('모시보자기_2_남색.png');
  const grouped = groupImageFiles(files(['모시보자기_1.jpg', '모시보자기_2_남색.jpg', '모시보자기_3_산호.jpg']));

  // Then: 세 장이 한 제품으로 묶이고, 색상명은 따로 실려 온다.
  // 번호가 있어야 묶이므로 색상명 자리는 그 뒤다 — 번호 없이 제품명_색상 으로 적으면
  // 그 자체가 다른 제품 이름이 되어 따로 떨어진다.
  assert.equal(parsed.productName, '모시보자기');
  assert.equal(parsed.ordinal, 2);
  assert.equal(parsed.colorName, '남색');
  assert.equal(grouped.products.length, 1);
  assert.deepEqual(
    grouped.products[0].images.map(image => image.fileColorName),
    ['', '남색', '산호'],
  );
});

test('번호만 적은 파일명은 색상명을 지어내지 않는다', async () => {
  const { groupImageFiles } = await import(MODEL_URL);

  const grouped = groupImageFiles(files(['모시보자기_1.jpg', '모시보자기_2.jpg']));

  assert.deepEqual(grouped.products[0].images.map(image => image.fileColorName), ['', '']);
});

test('카메라·내보내기 꼬리표는 색상명으로 오인하지 않는다', async () => {
  // Given: 사용자가 실제로 겪은 파일명들. product_8 이 색상명 "product 8" 로 올라갔었다.
  const { readImageName } = await import(MODEL_URL);

  // Then: 묶음(제품명·번호)은 그대로, 색상명만 비운다.
  assert.deepEqual(readImageName('7번_01_product_8.jpg'), { productName: '7번', ordinal: 1, colorName: '' });
  assert.deepEqual(readImageName('3.꽃핑_03_product_3.jpg'), { productName: '3.꽃핑', ordinal: 3, colorName: '' });
  assert.equal(readImageName('보자기_2_IMG_0042.jpg').colorName, '');
  assert.equal(readImageName('보자기_2_상세.jpg').colorName, '');

  // 진짜 색상명은 계속 통과한다 — 한글도 영문도.
  assert.equal(readImageName('모시보자기_2_남색.jpg').colorName, '남색');
  assert.equal(readImageName('모시보자기_3_navy.jpg').colorName, 'navy');
});

test('작업파일명은 금지문자를 다듬고 길이를 자른다', async () => {
  // Given: 파일명에서 온 별난 제품명. 조립공장은 \ / : * ? " < > | 와 160자 초과를 422 로 거절한다.
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  grouped.products[0].productName = '슬라브/겹보:55*55?';

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  const payload = buildProductPayload({ ...plan.entries[0], productName: '슬라브/겹보:55*55?' }, {
    batchId: 'b', dataUrls: ['data:image/jpeg;base64,AAA='], sha256s: ['aaa'],
  });

  // Then: 금지문자가 사라지고 .kuasangse 로 끝난다. 서버까지 갔다가 튕기지 않는다.
  assert.equal(payload.workfileName, '슬라브 겹보 55 55.kuasangse');

  const longName = '가'.repeat(200);
  const longPayload = buildProductPayload(
    { productName: longName, images: plan.entries[0].images, requiredValues: {} },
    { batchId: 'b', dataUrls: ['data:image/jpeg;base64,AAA='], sha256s: ['aaa'] },
  );
  assert.ok(longPayload.workfileName.length <= 160);
  assert.ok(longPayload.workfileName.endsWith('.kuasangse'));
});

test('자릿수를 넘긴 판매가·재고는 투입 전에 막는다', async () => {
  // 조립공장 규칙: salePrice ^\d{1,12}$, stock ^\d{1,9}$. 넘기면 보내 봐야 422 다.
  const { groupImageFiles, buildBulkPlan, BLOCKING_ISSUES } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));

  const plan = buildBulkPlan(grouped, [], {
    category: '주방', salePrice: '1234567890123', stock: '1234567890',
  });

  assert.ok(plan.entries[0].issues.includes('sale_price_invalid'));
  assert.ok(plan.entries[0].issues.includes('stock_invalid'));
  assert.ok(BLOCKING_ISSUES.has('sale_price_invalid'));
  assert.ok(BLOCKING_ISSUES.has('stock_invalid'));
  assert.equal(plan.blocked, 1);
  assert.equal(plan.ready, 0);
});

test('차단 흠 목록은 모델이 한 곳에서 내보낸다', async () => {
  // 화면과 제출 경로가 각자 목록을 들고 있으면 한쪽만 고쳐져 어긋난다.
  const { BLOCKING_ISSUES } = await import(MODEL_URL);
  for (const key of ['image_missing', 'base_image_missing', 'color_name_missing']) {
    assert.ok(BLOCKING_ISSUES.has(key), key);
  }
});

test('잠근 정책 스냅샷과 판단 모드를 큐 폼과 같은 규칙으로 싣는다', async () => {
  // Given: 정책이 잠긴 제품. 스냅샷 없이 보내면 자동화 정책이 기본값으로 돌아가,
  // 같은 제품이라도 어느 폼으로 넣었느냐에 따라 자동/수동이 달라진다.
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const plan = buildBulkPlan(groupImageFiles(files(['보자기_1.jpg'])), [], { category: '주방', salePrice: '12000' });
  const snapshot = { snapshotId: 'snap-1', locked: true, resolved: {} };

  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'b', dataUrls: ['data:image/jpeg;base64,AAA='], sha256s: ['aaa'],
    mode: 'auto', policySnapshot: snapshot,
  });

  assert.equal(payload.mode, 'auto');
  assert.deepEqual(payload.policySnapshot, snapshot);
  // Cafe24 승인 관문도 큐 폼과 같은 값이어야 한다.
  assert.equal(payload.cafe24ApprovalMode, 'existing_one_time_target_gate');
});

test('스냅샷이 없으면 이전과 같이 manual 로 보낸다', async () => {
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const plan = buildBulkPlan(groupImageFiles(files(['보자기_1.jpg'])), [], { category: '주방', salePrice: '12000' });

  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'b', dataUrls: ['data:image/jpeg;base64,AAA='], sha256s: ['aaa'],
  });

  assert.equal(payload.mode, 'manual');
  assert.equal('policySnapshot' in payload, false);
});

test('이름 없는 제품은 투입 가능 수에서 빠진다', async () => {
  // 이름 없는 제품은 작업파일명도 큐 표기도 만들 수 없다. 파일명 유래 임시 이름을 지우고
  // 직접 치게 하려면, 비어 있는 동안은 보내지 말아야 한다.
  const { buildBulkPlan } = await import(MODEL_URL);

  const plan = buildBulkPlan(
    { products: [{ productName: '', images: [{ fileName: 'a.jpg', ordinal: 1, role: 'base' }] }], skipped: [] },
    [],
    { category: '주방', salePrice: '12000' },
  );

  assert.ok(plan.entries[0].issues.includes('product_name_missing'));
  assert.equal(plan.blocked, 1);
  assert.equal(plan.ready, 0);
});
test('새로고침 저장분을 되살려도 투입 계획이 그대로다', async () => {
  // Given: 사람이 손질까지 끝낸 작업 상태 — 역할 이동, 색상명, 기본값.
  const { groupImageFiles, serializeWorkingState, hydrateWorkingState, buildBulkPlan } = await import(MODEL_URL);
  const fileA = new File([Buffer.from('aa')], '보자기_1.jpg', { type: 'image/jpeg' });
  const fileB = new File([Buffer.from('bb')], '보자기_2_남색.jpg', { type: 'image/jpeg' });
  const grouped = groupImageFiles([fileA, fileB]);
  grouped.products[0].images[1].role = 'color-option';
  grouped.products[0].images[1].colorName = '남색';
  grouped.products[0].images.forEach((image, index) => { image.blobId = 'blob-' + index; });
  const defaults = { category: '주방', salePrice: '12000', stock: '9' };

  // When: 저장(JSON 왕복은 IndexedDB 구조적 복제의 근사) 후 본문 표와 함께 복원.
  const stored = JSON.parse(JSON.stringify(serializeWorkingState({ grouped, csvRows: [], csvErrors: [], defaults })));
  const revived = hydrateWorkingState(stored, new Map([['blob-0', fileA], ['blob-1', fileB]]));

  // Then: 계획이 같고, 손질과 파일 본문이 그대로다.
  assert.equal(revived.dropped.length, 0);
  const before = buildBulkPlan(grouped, [], defaults);
  const after = buildBulkPlan(revived.grouped, revived.csvRows, revived.defaults);
  assert.equal(after.ready, before.ready);
  assert.deepEqual(after.entries.map(entry => entry.productName), before.entries.map(entry => entry.productName));
  assert.equal(revived.grouped.products[0].images[1].colorName, '남색');
  assert.equal(revived.grouped.products[0].images[1].role, 'color-option');
  assert.equal(revived.grouped.products[0].images[0].file.name, '보자기_1.jpg');
  assert.equal(revived.defaults.stock, '9');
});

test('본문이 사라진 사진은 지어내지 않고 뺐다고 알린다', async () => {
  const { groupImageFiles, serializeWorkingState, hydrateWorkingState } = await import(MODEL_URL);
  const grouped = groupImageFiles([new File([Buffer.from('aa')], '보자기_1.jpg', { type: 'image/jpeg' })]);
  grouped.products[0].images[0].blobId = 'blob-0';
  // 이름만 있는 빈 카드(＋ 빈 제품 추가)도 함께 저장돼 있었다.
  grouped.products.push({ productName: '수동제품', images: [] });

  const revived = hydrateWorkingState(
    serializeWorkingState({ grouped, csvRows: [], csvErrors: [], defaults: {} }),
    new Map(),
  );

  // Then: 본문 없는 사진은 dropped 로 보고하고, 빈 카드는 이름째 살아남는다.
  assert.deepEqual(revived.dropped, ['보자기_1.jpg']);
  assert.deepEqual(revived.grouped.products.map(product => product.productName), ['보자기', '수동제품']);
  assert.equal(revived.grouped.products[0].images.length, 0);
});

test('모르는 저장 기록은 되살리지 않는다', async () => {
  const { hydrateWorkingState } = await import(MODEL_URL);
  assert.equal(hydrateWorkingState({ schema: 'bulk-intake-working-state:v99', products: [] }, new Map()), null);
  assert.equal(hydrateWorkingState('garbage', new Map()), null);
  assert.equal(hydrateWorkingState(null, new Map()), null);
});

test('정책 스냅샷은 작업이 실제로 실릴 묶음 이름으로 잠근다', async () => {
  // 조립공장은 policySnapshot.batchId 와 작업의 batchId 가 정확히 같아야 받아 준다.
  // 다르면 policy_identity_missing 으로 전건 거절한다 — 실측 2026-08-28, 실제 투입에서 재현.
  // 가로채기(intercept)로만 확인하면 서버가 보지 않으므로 이 어긋남을 못 잡는다.
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000' });
  const batchId = 'batch-bulk-1-보자기';

  const payload = buildProductPayload(plan.entries[0], {
    batchId,
    dataUrls: ['data:image/jpeg;base64,AAA='],
    sha256s: ['aaa'],
    mode: 'auto',
    policySnapshot: { schema: 'automation-policy-snapshot:v1', snapshotId: 'policy:abc', locked: true, batchId, productId: '보자기' },
  });

  assert.equal(payload.batchId, batchId);
  assert.equal(payload.policySnapshot.batchId, payload.batchId);
  assert.equal(payload.policySnapshot.productId, payload.productName);
});

test('크기 한 줄에서 가로·세로를 읽어 mm 로 맞춘다', async () => {
  // 조립공장 사이즈이미지 단계는 가로·세로를 mm 숫자 두 개로 요구한다.
  const { readSizePair, resolveSizePair } = await import(MODEL_URL);

  // 크기 칸은 사람이 cm 로 적는다.
  assert.deepEqual(readSizePair('20x15cm'), { widthMm: '200', depthMm: '150' });
  assert.deepEqual(readSizePair('20*15'), { widthMm: '200', depthMm: '150' });
  assert.deepEqual(readSizePair('200 x 150 mm'), { widthMm: '200', depthMm: '150' });
  assert.deepEqual(readSizePair('가로 200 세로 150mm'), { widthMm: '200', depthMm: '150' });
  // 애매하면 지어내지 않는다. 틀린 치수로 사이즈컷이 만들어지면 사람이 못 알아챈다.
  assert.deepEqual(readSizePair('45cm 정사각'), { widthMm: '', depthMm: '' });
  assert.deepEqual(readSizePair('20cm'), { widthMm: '', depthMm: '' });

  // 가로/세로 칸은 라벨이 mm 다 — 단위를 안 적으면 적힌 그대로 mm.
  assert.deepEqual(resolveSizePair({ size: '20x15cm', widthMm: '250' }), { widthMm: '250', depthMm: '150' });
  assert.deepEqual(resolveSizePair({ widthMm: '25cm', depthMm: '30cm' }), { widthMm: '250', depthMm: '300' });
  // 직접 적은 값이 언제나 크기 파싱보다 우선한다.
  assert.deepEqual(resolveSizePair({ size: '20x15cm' }), { widthMm: '200', depthMm: '150' });
});

test('가로·세로가 없으면 투입 전에 막는다', async () => {
  // 신화사 DB 에서 고른 제품은 DB 가 채워 주지만 직접 입력한 제품은 아무도 못 채운다.
  // 그대로 보내면 6단계 중 2단계에서 멈춘다 — 실측 2026-08-28.
  const { groupImageFiles, buildBulkPlan, BLOCKING_ISSUES } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));

  const blocked = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', size: '45cm 정사각' });
  assert.ok(blocked.entries[0].issues.includes('size_mm_missing'));
  assert.ok(BLOCKING_ISSUES.has('size_mm_missing'));
  assert.equal(blocked.ready, 0);

  // 크기에 두 수를 적으면 저절로 풀린다.
  const ready = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', size: '20x15cm' });
  assert.deepEqual(ready.entries[0].issues, []);
  assert.equal(ready.entries[0].requiredValues.widthMm, '200');
  assert.equal(ready.entries[0].requiredValues.depthMm, '150');
  assert.equal(ready.ready, 1);
});

test('2000mm 를 넘는 치수는 조용히 버려지기 전에 잡는다', async () => {
  // factoryNormalizeDimensionFactValue 는 2000 초과를 빈 값으로 만든다. 그러면 화면에는
  // 다시 '가로/세로가 비었다' 로만 돌아와 이유를 알 수 없다.
  const { groupImageFiles, buildBulkPlan } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));

  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', widthMm: '2500', depthMm: '150' });

  assert.ok(plan.entries[0].issues.includes('size_mm_invalid'));
  assert.equal(plan.ready, 0);
});

test('가로·세로가 조립공장 payload 까지 살아서 간다', async () => {
  const { groupImageFiles, buildBulkPlan, buildProductPayload } = await import(MODEL_URL);
  const grouped = groupImageFiles(files(['보자기_1.jpg']));
  const plan = buildBulkPlan(grouped, [], { category: '주방', salePrice: '12000', size: '20x15cm' });

  const payload = buildProductPayload(plan.entries[0], {
    batchId: 'batch-bulk', dataUrls: ['data:image/jpeg;base64,AAA='], sha256s: ['aaa'],
  });

  assert.equal(payload.requiredValues.widthMm, '200');
  assert.equal(payload.requiredValues.depthMm, '150');
});

test('CSV 의 가로·세로 열도 읽는다', async () => {
  const { parseIntakeCsv } = await import(MODEL_URL);

  const parsed = parseIntakeCsv(['제품명,분류,판매가,가로,세로', '보자기,주방,12000,200,150'].join('\n'));

  assert.equal(parsed.rows[0].requiredValues.widthMm, '200');
  assert.equal(parsed.rows[0].requiredValues.depthMm, '150');
});
