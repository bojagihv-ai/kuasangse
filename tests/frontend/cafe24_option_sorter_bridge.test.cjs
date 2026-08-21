const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(name) {
  return fs.readFileSync(path.join(ROOT, 'src', name), 'utf8');
}

function sourceSlice(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return text.slice(startIndex, endIndex);
}

function dedupe(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function createHarness(optionSorter) {
  const factory = {
    product: {
      dbFieldSettings: {},
      cafe24OptionGroupsDraft: [],
      finalDb: {},
    },
  };
  const context = {
    state: { optionSorter },
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    FACTORY_CAFE24_FIELD_SECTIONS: [],
    cloneData: value => JSON.parse(JSON.stringify(value)),
    factoryRuntimeReadFactory: () => factory,
    factoryBuildSourcePanelModel: () => ({ optionGroups: [], optionValues: [] }),
    factoryCafe24DraftMatchesCurrentProduct: () => true,
    factoryDedupeRealOptionValues: dedupe,
    factoryCleanOptionLabel: value => String(value || '').trim(),
    factoryCafe24OptionGroupsForEditor: () => [],
    factoryCafe24VariantRows: () => [],
    factoryCafe24TargetCandidate: () => null,
    parseCafe24Raw: () => ({}),
    factoryCafe24OptionSettingsFinalDb: (_factory, finalDb) => finalDb || {},
    factoryCafe24CleanOptionGroupsForPayload: (groups, optionName, optionValues) => (
      groups.length ? groups : (optionValues.length ? [{
        key: 'group_1',
        name: optionName,
        values: optionValues,
        required_option: 'T',
        option_display_type: 'S',
      }] : [])
    ),
    factoryBuildCafe24ProductOptionsPayload: (_optionName, _optionValues, groups) => groups.map(group => ({
      name: group.name,
      value: group.values,
    })),
    factoryCafe24OptionSettingsTouched: () => false,
    factoryCafe24OptionExtrasModel: () => ({
      useAdditionalOption: 'F',
      additionalOptions: [],
      useAttachedFileOption: 'F',
    }),
    factoryCafe24OptionExtrasTouched: () => false,
    factoryCafe24VariantEditsForCurrent: () => ({}),
    factoryBuildCafe24OptionsUpdatePayload: (_factory, _raw, _finalDb, _name, _values, groups) => ({
      has_option: groups.length ? 'T' : 'F',
      option_type: 'T',
      option_list_type: 'C',
      select_one_by_option: 'F',
    }),
    factoryCafe24ExistingOptionRoot: () => ({}),
    factoryCafe24OptionSetting: (_raw, finalDb, key, fallback) => finalDb?.[key] ?? fallback,
    factoryCafe24PayloadValue: (_key, value) => value,
    factoryCafe24SourceVariantInventoryMap: () => new Map(),
    factoryCafe24SourceInventoryForRow: () => null,
    factoryCafe24AutoInventoryPayload: () => ({}),
    factoryCafe24OriginalOptionsPayload: () => [],
  };
  vm.createContext(context);
  vm.runInContext([
    sourceSlice(
      source('cafe24-options.js'),
      'function factoryOptionNamesFromArchivedPrompt(',
      'function factoryCafe24NormalizeVariantOptions(',
    ),
    sourceSlice(
      source('cafe24-product-form.js'),
      'function factoryCafe24OptionEditorModel(',
      'function factoryOptionGroupSummary(',
    ),
    sourceSlice(
      source('cafe24-payloads.js'),
      'function factoryCafe24OptionStructureTouched(',
      'function factoryCafe24VariantEditsForCurrent(',
    ),
    sourceSlice(
      source('cafe24-sync.js'),
      'function factoryBuildCafe24OptionSyncPlan(',
      'function factoryCafe24VariantNormalizedOptionKey(',
    ),
  ].join('\n'), context);
  return { context, factory };
}

test('옵션분류기에서 확정한 14색은 Cafe24 신상품 payload의 판매 옵션으로 이어진다', () => {
  const names = [
    '1.빨강', '2.꽃핑', '3.연핑', '4.산호', '5.주황', '6.청색', '7.청바지',
    '8.연하늘', '9.옥색', '10.연두', '11.연민트', '12.노랑', '13.밤색', '14.회색',
  ];
  const { context, factory } = createHarness({
    images: names.map((name, index) => ({ id: `image_${index + 1}`, name })),
    slots: names.map((name, index) => ({
      id: `slot_${index + 1}`,
      name,
      imgIds: [`image_${index + 1}`],
    })),
    optionResults: [{ id: 'result_a', image: 'data:image/png;base64,AA==' }],
  });

  const model = context.factoryCafe24OptionEditorModel(factory);
  assert.equal(model.optionName, '색상');
  assert.deepEqual(Array.from(model.optionValues), names);
  assert.equal(context.factoryCafe24OptionStructureTouched(factory), true);

  const product = context.factoryAttachCafe24OptionsToProductPayload({}, factory, {});
  assert.equal(product.has_option, 'T');
  assert.equal(product.options.length, 1);
  assert.deepEqual(Array.from(product.options[0].value), names);
});

test('기본 1번~10번 빈 슬롯은 Cafe24 판매 옵션으로 오인하지 않는다', () => {
  const { context, factory } = createHarness({
    images: [],
    slots: Array.from({ length: 10 }, (_, index) => ({
      id: `slot_${index + 1}`,
      name: `${index + 1}번`,
      imgIds: [],
    })),
    optionResults: [],
  });

  const model = context.factoryCafe24OptionEditorModel(factory);
  assert.deepEqual(Array.from(model.optionValues), []);
  assert.equal(context.factoryCafe24OptionStructureTouched(factory), false);
  assert.deepEqual(context.factoryAttachCafe24OptionsToProductPayload({}, factory, {}), {});
});

test('슬롯명이 복원되지 않아도 생성 결과의 확정 옵션명이 Cafe24 판매 옵션으로 이어진다', () => {
  const names = ['1.빨강', '2.연핑', '3.산호'];
  const { context, factory } = createHarness({
    images: names.map((name, index) => ({ id: `image_${index + 1}`, name })),
    slots: names.map((_, index) => ({
      id: `slot_${index + 1}`,
      name: `${index + 1}번`,
      imgIds: [],
    })),
    optionResults: [{
      id: 'result_restored',
      image: 'data:image/png;base64,AA==',
      optionNames: names,
    }],
  });

  const model = context.factoryCafe24OptionEditorModel(factory);
  assert.deepEqual(Array.from(model.optionValues), names);
  assert.equal(context.factoryCafe24OptionStructureTouched(factory), true);

  const product = context.factoryAttachCafe24OptionsToProductPayload({}, factory, {});
  assert.equal(product.has_option, 'T');
  assert.deepEqual(Array.from(product.options[0].value), names);
});

test('로컬 보관 옵션표 prompt가 있으면 숫자 슬롯에서도 15색 옵션을 복원한다', () => {
  const names = [
    '1.빨강', '2.연핑', '3.산호', '4.주황', '5.곤색', '6.청색', '7.연하늘',
    '8.청바지색', '9.쑥색', '10.녹두', '11.형광연두', '12.노랑', '13.회색', '14.흰색', '15.연보라',
  ];
  const prompt = names.map((name, index) => (
    `${index + 1}. uploaded image "IMG_${6077 + index}" -> option name "${name}"`
  )).join('\n');
  const { context, factory } = createHarness({
    images: [],
    slots: names.map((_, index) => ({ id: `slot_${index + 1}`, name: `${index + 1}번`, imgIds: [] })),
    optionResults: [],
  });
  factory.archive = { localAssets: [{ stageId: 'options', savedAt: '2026-08-07T01:00:00Z', prompt }] };

  const model = context.factoryCafe24OptionEditorModel(factory);
  assert.deepEqual(Array.from(model.optionValues), names);
  assert.equal(context.factoryCafe24OptionStructureTouched(factory), true);
});

test('옵션이 없는 참조상품에서 새 옵션 구조를 만들면 has_option을 T로 강제한다', () => {
  const context = {
    factoryRuntimeReadFactory: () => ({}),
    factoryCafe24CleanOptionGroupsForPayload: groups => groups,
    factoryCafe24OptionExtrasTouched: () => false,
    factoryCafe24OptionExtrasPayload: () => ({}),
    factoryCafe24PayloadValue: (_key, value) => value,
    factoryCafe24OptionSetting: (raw, _finalDb, key, fallback) => raw[key] ?? fallback,
    factoryCafe24ExistingOptionGroup: () => null,
    factoryCafe24OptionsPayloadValueItems: values => values.map(option_text => ({ option_text })),
  };
  vm.createContext(context);
  vm.runInContext(sourceSlice(
    source('cafe24-payloads.js'),
    'function factoryBuildCafe24OptionsUpdatePayload(',
    'function factoryBuildCafe24ProductOptionsPayload(',
  ), context);
  const groups = [{ name: '색상', values: ['초록', '빨강'], required_option: 'T', option_display_type: 'S' }];

  const structurePayload = context.factoryBuildCafe24OptionsUpdatePayload({}, { has_option: 'F' }, {}, '색상', [], groups);
  const settingsPayload = context.factoryBuildCafe24OptionsUpdatePayload({}, { has_option: 'F' }, {}, '색상', [], groups, { settingsOnly: true });

  assert.equal(structurePayload.has_option, 'T');
  assert.equal(settingsPayload.has_option, 'F');
});

test('Cafe24 준비 동기화는 상세 HTML 이미지와 옵션 재고 일괄 적용 경계를 포함한다', () => {
  const syncSource = source('cafe24-sync.js');
  const formSource = source('cafe24-product-form.js');
  const coreSource = source('app-core-06.js');
  assert.match(formSource, /key:\s*'detailHtml'/, '기존 상품 동기화 계획에 상세 HTML 단계가 있어야 한다');
  assert.match(syncSource, /factoryCafe24IsTransferDetailImageUrl/, 'blob/local 상세 이미지 hydration 경계가 있어야 한다');
  assert.match(formSource, /factoryCafe24ApplyInventoryAll/, '옵션별 재고 일괄 적용 컨트롤이 있어야 한다');
  assert.match(formSource, /factoryCafe24SaveVariantInventory/, '행별 재고를 명시적으로 저장하는 컨트롤이 있어야 한다');
  assert.match(coreSource, /factory\/cafe24:sync-options-variants/, '행별 재고 저장은 기존 Cafe24 소유 명령으로 원자적으로 반영돼야 한다');
  assert.match(formSource, /cafe24VariantCatalogProductNo/, '새로 조회한 Cafe24 품목 목록을 상품번호별로 보존해야 한다');
  assert.match(source('cafe24-payloads.js'), /refreshedVariantCatalog/, 'Cafe24 품목 API 재조회 결과를 현재 작업에 연결해야 한다');
  assert.match(syncSource, /factoryCafe24ControlPlanFromBody\(inventoryBody\)/, '직접 재고 저장은 변경안 대기 없이 최종 재조회로 검증해야 한다');
});
