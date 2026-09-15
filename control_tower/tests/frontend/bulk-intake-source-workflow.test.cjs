const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const sourceModule = () => import(`../../frontend/src/bulk-intake-source.mjs?test=${Date.now()}-${Math.random()}`);
const modelModule = () => import(`../../frontend/src/bulk-intake-model.mjs?test=${Date.now()}-${Math.random()}`);

test('선택 상품 값은 행의 빈칸만 채우고 다른 행과 직접 입력을 보존한다', async () => {
  const { applySelectedProductSource } = await sourceModule();
  const first = { productName: '첫 제품', requiredValues: { material: '직접 적은 면' } };
  const second = { productName: '둘째 제품', requiredValues: { salePrice: '9000' } };
  const secondBefore = structuredClone(second);

  const count = applySelectedProductSource(first, {
    source: { kind: 'sinhwa-db', selectionId: '818' },
    label: '신화사DB #818 · 첫 제품', thumbnail: '/818.jpg',
    values: { product_name: 'DB 이름', sale_price: '3000', material: '색동', weight: '' },
  }, 1700000000000);

  assert.equal(count, 1);
  assert.equal(first.productName, '첫 제품');
  assert.equal(first.requiredValues.material, '직접 적은 면');
  assert.equal(first.requiredValues.salePrice, '3000');
  assert.equal(first.requiredValues.weight, undefined, '모르는 무게는 만들지 않는다');
  assert.equal(first.sourceSelection.selectionId, '818');
  assert.equal(first.sourceFields.sale_price.confirmedAt, 1700000000000);
  assert.deepEqual(second, secondBefore);
});

test('이름 변경과 행 전환 뒤의 늦은 조회 응답은 현재 행에 적용되지 않는다', async () => {
  const { beginProductSourceRequest, beginProductSourceSelection, cancelProductSourceRequests, finishProductSourceRequest, finishProductSourceSelection } = await sourceModule();
  const row = { productName: '처음 이름' };
  const oldRequest = beginProductSourceRequest(row, 'cafe24', '처음 이름');
  row.productName = '바뀐 이름';
  assert.equal(finishProductSourceRequest(row, oldRequest, [{ product_no: 1 }]), false);
  assert.deepEqual(row.sourceLookup.cafe24.candidates, []);

  const currentRequest = beginProductSourceRequest(row, 'cafe24', '바뀐 이름');
  assert.equal(finishProductSourceRequest(row, currentRequest, [{ product_no: 9 }], '', { productName: '다른 활성 행' }), false);
  cancelProductSourceRequests(row);
  assert.equal(row.sourceLookup.cafe24.status, 'idle');
  const replacementRequest = beginProductSourceRequest(row, 'cafe24', '바뀐 이름');
  assert.equal(finishProductSourceRequest(row, replacementRequest, [{ product_no: 2 }]), true);
  assert.equal(row.sourceLookup.cafe24.candidates[0].product_no, 2);

  const oldSelection = beginProductSourceSelection(row, 'cafe24', '2');
  row.productName = '세 번째 이름';
  assert.equal(finishProductSourceSelection(row, oldSelection, {
    source: { kind: 'direct', selectionId: '2' }, values: { sale_price: '9999' },
  }), false);
  assert.equal(row.requiredValues, undefined, '늦은 상세 응답은 바뀐 행을 채우지 않는다');
});

test('선택 출처와 필드 초안은 저장 복원되고 큐 payload는 신규등록 출처만 전달한다', async () => {
  const { serializeWorkingState, hydrateWorkingState, buildBulkPlan, buildProductPayload } = await modelModule();
  const grouped = { products: [{
    productName: '신화 제품', images: [{ blobId: 'photo', fileName: 'a.jpg', role: 'base' }],
    requiredValues: { category: '보자기', salePrice: '3000', widthMm: '500', depthMm: '500', weight: '5.3g' },
    sourceSelection: { kind: 'sinhwa-db', selectionId: '818', label: '신화사DB #818', thumbnail: '/818.jpg', confirmedAt: 7 },
    sourceFields: { weight: { source: '신화사DB #818', confirmedAt: 7 } },
    fieldDrafts: { material: '색동 원단' },
  }] };
  const stored = serializeWorkingState({ grouped });
  const restored = hydrateWorkingState(stored, new Map([['photo', new Blob(['image'])]]), blob => blob);
  const entry = buildBulkPlan(restored.grouped).entries[0];
  const payload = buildProductPayload(entry, { dataUrls: ['data:image/jpeg;base64,eA=='], sha256s: ['abc'] });

  assert.equal(restored.grouped.products[0].fieldDrafts.material, '색동 원단');
  assert.equal(entry.requiredValues.weight, '5.3g');
  assert.deepEqual(payload.source, { kind: 'sinhwa-db', selectionId: '818' });
  assert.equal(payload.jcode, 818);
  assert.equal(payload.requiredValues.weight, '5.3g');
  assert.equal(payload.cafe24ApprovalMode, 'existing_one_time_target_gate');
});

test('Cafe24 원본 금액은 선택·저장 복원·payload 경계에서 원화 정수만 허용하고 자릿수를 키우지 않는다', async () => {
  const { applySelectedProductSource } = await sourceModule();
  const { serializeWorkingState, hydrateWorkingState, buildBulkPlan, buildProductPayload } = await modelModule();
  const cases = [
    ['소수점 0', '7500.00', '4000.00', '7500', '4000', true],
    ['정수', '7600', '4000', '7600', '4000', true],
    ['0', '0', '0', '0', '0', true],
    ['빈값', '', '', undefined, undefined, true],
    ['쉼표·통화', '₩7,500', '4,000원', '7500', '4000', true],
    ['비영 소수', '7,500.50원', '4,000.25원', '7,500.50원', '4,000.25원', false],
    ['다중점', '7,500.0.0원', '4,000.0.0원', '7,500.0.0원', '4,000.0.0원', false],
    ['문자 혼입', '7a5.00?', '4x0.00?', '7a5.00?', '4x0.00?', false],
  ];

  for (const [name, salePrice, supplyPrice, expectedSalePrice, expectedSupplyPrice, accepted] of cases) {
    const product = { productName: `각실청색 ${name}`, images: [{ blobId: 'photo', fileName: 'a.jpg', role: 'base' }] };
    applySelectedProductSource(product, {
      source: { kind: 'direct', selectionId: '10' },
      values: { sale_price: salePrice, purchase_price: supplyPrice },
    }, 1700000000000);
    const stored = serializeWorkingState({ grouped: { products: [product] } });
    const restored = hydrateWorkingState(stored, new Map([['photo', new Blob(['image'])]]), blob => blob);
    const plan = buildBulkPlan(restored.grouped);
    const entry = plan.entries[0];

    assert.equal(restored.grouped.products[0].requiredValues.salePrice, salePrice || undefined, `${name}: source value remains preserved`);
    assert.equal(entry.requiredValues.salePrice, expectedSalePrice, `${name}: row summary value`);
    assert.equal(entry.requiredValues.supplyPrice, expectedSupplyPrice, `${name}: row summary supply value`);
    if (accepted) {
      const payload = buildProductPayload(entry, { dataUrls: ['data:image/jpeg;base64,eA=='], sha256s: ['abc'] });
      assert.equal(payload.requiredValues.salePrice, expectedSalePrice, `${name}: payload sale value`);
      assert.equal(payload.requiredValues.supplyPrice, expectedSupplyPrice, `${name}: payload supply value`);
    } else {
      assert.ok(entry.issues.includes('sale_price_invalid'), `${name}: invalid sale price is explicit`);
      assert.ok(entry.issues.includes('supply_price_invalid'), `${name}: invalid supply price is explicit`);
      assert.equal(plan.blocked, 1, `${name}: invalid money cannot queue`);
      assert.throws(
        () => buildProductPayload(entry, { dataUrls: ['data:image/jpeg;base64,eA=='], sha256s: ['abc'] }),
        /integer money required/,
        `${name}: invalid money cannot become a payload`,
      );
    }
  }
});

test('Cafe24 선택은 기존 상품 업데이트 승인을 만들지 않는다', async () => {
  const { buildProductPayload } = await modelModule();
  const entry = {
    productName: 'Cafe 상품', images: [{ fileName: 'a.jpg', role: 'base' }],
    requiredValues: { category: '지갑', salePrice: '1000', widthMm: '10', depthMm: '10' },
    sourceSelection: { kind: 'direct', selectionId: '3000', label: 'Cafe24 #3000' },
  };
  const payload = buildProductPayload(entry, { dataUrls: ['data:image/jpeg;base64,eA=='], sha256s: ['abc'] });
  assert.deepEqual(payload.source, { kind: 'direct', selectionId: '3000' });
  assert.equal(payload.jcode, undefined);
  assert.equal(payload.updateProductNo, undefined);
  assert.equal(payload.cafe24ApprovalMode, 'existing_one_time_target_gate');
});

test('초안은 수정 가능하고 queued/pending 원본은 필드·출처 쓰기와 늦은 응답을 보존한다', async () => {
  const source = await sourceModule();
  const selected = { source: { kind: 'direct', selectionId: '11' }, values: { material: '새 소재' } };
  const cases = [
    ['필드 초안', row => source.setProductFieldDraft(row, 'sale_price', '8100'), row => row.fieldDrafts.sale_price, '8100'],
    ['필드 확정', row => source.commitProductField(row, 'sale_price', '8100'), row => row.requiredValues.salePrice, '8100'],
    ['전체 확정', row => { for (const [id, value] of [['product_name', '수정 이름'], ['sale_price', '8100']]) source.commitProductField(row, id, value); }, row => [row.productName, row.requiredValues.salePrice], ['수정 이름', '8100']],
    ['조회 시작', row => source.beginProductSourceRequest(row, 'cafe24', '새 검색'), row => row.sourceLookup.cafe24.request.query, '새 검색'],
    ['늦은 조회', row => source.finishProductSourceRequest(row, row.sourceLookup.cafe24.request, [{ product_no: 11 }]), row => row.sourceLookup.cafe24.candidates, [{ product_no: 11 }]],
    ['늦은 조회 실패', row => source.finishProductSourceRequest(row, row.sourceLookup.cafe24.request, [], '조회 실패'), row => row.sourceLookup.cafe24.error, '조회 실패'],
    ['출처 선택 시작', row => source.beginProductSourceSelection(row, 'cafe24', '11'), row => row.sourceSelectionRequest.selectionId, '11'],
    ['늦은 상세 선택', row => source.finishProductSourceSelection(row, row.sourceSelectionRequest, selected, 7), row => row.sourceSelection.selectionId, '11'],
    ['출처 값 적용', row => source.applySelectedProductSource(row, selected, 7), row => row.requiredValues.material, '새 소재'],
    ['행 전환 요청 취소', row => source.cancelProductSourceRequests(row), row => row.sourceSelectionRequest, undefined],
  ];
  for (const [state, lock] of [['draft', {}], ['queued', { queued: true, queuedJobId: 'existing-job' }], ['pending', { queueRequest: { payload: { productName: '보존 이름', requiredValues: { salePrice: '7600' } } } }]]) {
    for (const [name, run, read, expected] of cases) {
      const row = { productName: '보존 이름', requiredValues: { salePrice: '7600', cafe24CategoryId: '84' },
        fieldDrafts: { material: '작성 중인 소재' }, sourceSelection: { kind: 'direct', selectionId: '10' },
        images: [{ fileName: 'original.jpg', blobId: 'original', role: 'base' }], decisionOverrides: { 'field:sale_price': 'manual' } };
      source.beginProductSourceRequest(row, 'cafe24', '보존 이름');
      source.beginProductSourceSelection(row, 'cafe24', '10');
      Object.assign(row, structuredClone(lock));
      const before = structuredClone(row);
      run(row);
      if (state === 'draft') assert.deepEqual(read(row), expected, `${state}: ${name}`);
      else assert.deepEqual(row, before, `${state}: ${name} must not mutate the input or pending payload`);
    }
  }
});

test('queued 보기의 source 계약은 row-open/사진확대만 허용하고 native 필드 쓰기와 busy 열기를 잠근다', () => {
  const ui = readFileSync(path.resolve(__dirname, '../../frontend/src/bulk-intake.mjs'), 'utf8');
  const fields = ui.slice(ui.indexOf('  function renderNativeRequiredFields('), ui.indexOf('  function renderCategoryField('));
  const plan = ui.slice(ui.indexOf('  function renderPlan()'), ui.indexOf('  function labelledConfirmRow('));
  assert.match(plan, /entry\.queued \? '입력 내용 보기'/);
  assert.match(plan, /open\.disabled = busy \|\| restorePending;/);
  assert.match(plan, /if \(entry\.queued \|\| busy \|\| restorePending\) \{\s*for \(const control of card\.querySelectorAll\('input, select, \.bulk-move-action, \.bulk-mini-action:not\(\.bulk-row-open\)'\)\)/);
  assert.match(plan, /selectedEditor\.querySelectorAll\('input, select, textarea, button:not\(\.bulk-thumb\)'\)/);
  assert.match(fields, /if \(group\.queued \|\| group\.queueRequest \|\| busy \|\| restorePending\) \{[\s\S]*?control\.disabled = true;\s*return panel;\s*\}/);
  assert.ok(fields.indexOf('return panel;') < fields.indexOf("input.addEventListener('input'"), 'locked native field panel never binds edit/commit/commit-all handlers');
  assert.match(plan, /disabled: entry\.queued \|\| Boolean\(group\.queueRequest\) \|\| busy \|\| restorePending/);
});
