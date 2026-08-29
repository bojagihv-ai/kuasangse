const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const CSV_COLUMNS = Object.freeze({
  productName: ['productname', '제품명', '상품명', '이름', 'name'],
  category: ['category', '분류', '카테고리', '상품분류'],
  material: ['material', '소재', '재질'],
  originCountry: ['origincountry', '원산지', '제조국'],
  size: ['size', '크기', '사이즈', '규격'],
  // 조립공장 사이즈이미지 단계는 가로·세로를 숫자 두 개로 요구한다. 크기 한 줄로는 못 쪼갠다.
  widthMm: ['widthmm', 'width', '가로', '너비', '폭'],
  depthMm: ['depthmm', 'depth', '세로', '길이'],
  salePrice: ['saleprice', '판매가', '가격', '단가'],
  usage: ['usage', '용도', '쓰임'],
  stock: ['stock', '재고', '수량'],
  cafe24CategoryId: ['cafe24categoryid', '제품분류', 'cafe24분류', '분류번호', '카페24분류'],
  supplyPrice: ['supplyprice', '공급가', '원가', '매입가'],
  displayStatus: ['displaystatus', '진열', '진열상태'],
  sellingStatus: ['sellingstatus', '판매', '판매상태'],
});

const REQUIRED_VALUE_KEYS = Object.freeze([
  'category',
  'material',
  'originCountry',
  'size',
  // 가로·세로(mm). 조립공장은 이 둘이 있어야 사이즈이미지를 그린다 — 크기 한 줄로는 못 쪼갠다.
  'widthMm',
  'depthMm',
  'salePrice',
  'usage',
  'stock',
  // Cafe24 등록 대상 값. 여기서 골라 두면 등록이 그대로 따라간다. 비워도 투입은 막지 않는다.
  'cafe24CategoryId',
  'supplyPrice',
  'displayStatus',
  'sellingStatus',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeHeader(value) {
  return text(value).toLowerCase().replace(/[\s_-]/g, '');
}

function extensionOf(fileName) {
  const match = /\.([A-Za-z0-9]+)$/.exec(text(fileName));
  return match ? match[1].toLowerCase() : '';
}

export function isSupportedImage(fileName) {
  return IMAGE_EXTENSIONS.includes(extensionOf(fileName));
}

// 파일명 꼬리를 색상명으로 받아들일 조건. `product_8`·`IMG 0042` 같은 카메라·내보내기
// 꼬리표가 색상명이 되어 옵션표에 올라가면 안 된다 — 숫자가 섞였거나 촬영·내보내기
// 상용구면 색상명이 아니라고 본다. 남색·연분홍·navy 같은 진짜 색상명은 통과한다.
const NON_COLOR_TAIL = /\d|^(?:product|image|img|photo|pic|shot|cut|detail|main|thumb|dsc|screenshot|kakaotalk|사진|이미지|상세|대표|컷|섬네일|썸네일)$/i;

function colorTailOf(rawTail) {
  const tail = text(rawTail).replace(/[_-]+/g, ' ').trim();
  if (!tail || tail.length > 12 || NON_COLOR_TAIL.test(tail)) return '';
  return tail;
}

/**
 * 파일 이름에서 제품과 장 번호를 읽는다.
 * `보자기.jpg` → 보자기 1장, `보자기_2.jpg` / `보자기-3.png` → 같은 제품의 2·3번째 장.
 */
export function readImageName(fileName) {
  const name = text(fileName);
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '');
  // 제품명_번호_색상 (모시보자기_2_남색). 색상명을 파일명에 적어 두는 사람을 위해 받는다.
  // 번호가 있어야 같은 제품으로 묶인다 — 번호 없이 제품명_색상 으로 적으면 그 자체가
  // 다른 제품 이름이 되어 따로 떨어진다. 그 규칙은 그대로 둔다.
  // 꼬리가 색상명으로 안 보이면 묶음(제품명·번호)은 그대로 두고 색상명만 비운다.
  const withColor = /^(.*?)[ _-](\d{1,3})[ _-](.+)$/.exec(stem);
  if (withColor && text(withColor[1])) {
    return {
      productName: text(withColor[1]),
      ordinal: Number(withColor[2]),
      colorName: colorTailOf(withColor[3]),
    };
  }
  const match = /^(.*?)[ _-](\d{1,3})$/.exec(stem);
  if (match && text(match[1])) {
    return { productName: text(match[1]), ordinal: Number(match[2]), colorName: '' };
  }
  return { productName: stem.trim(), ordinal: 1, colorName: '' };
}

/** 고른 파일들을 제품 단위로 묶는다. 파일 본문은 아직 읽지 않는다. */
export function groupImageFiles(filesValue) {
  const groups = new Map();
  const skipped = [];
  for (const file of list(filesValue)) {
    const fileName = text(record(file).name || file);
    if (!fileName) continue;
    if (!isSupportedImage(fileName)) {
      skipped.push({ fileName, reason: 'unsupported_type' });
      continue;
    }
    const { productName, ordinal, colorName } = readImageName(fileName);
    if (!productName) {
      skipped.push({ fileName, reason: 'product_name_missing' });
      continue;
    }
    if (!groups.has(productName)) groups.set(productName, []);
    groups.get(productName).push({ fileName, ordinal, colorName, file });
  }
  const products = [...groups.entries()].map(([productName, images]) => ({
    productName,
    images: images
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal || left.fileName.localeCompare(right.fileName))
      .map((image, index) => ({
        fileName: image.fileName,
        file: image.file,
        ordinal: index + 1,
        role: 'base',
        // 파일명에 색상명을 적어 두었으면 그대로 들고 온다. 화면에서 고쳐 쓸 수 있다.
        fileColorName: text(image.colorName),
        name: image.fileName.replace(/\.[A-Za-z0-9]+$/, ''),
      })),
  }));
  products.sort((left, right) => left.productName.localeCompare(right.productName, 'ko'));
  return { products, skipped };
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',' || char === '\t') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

/** 제품 정보를 담은 CSV/TSV 를 읽는다. 한글 머리글도 그대로 쓸 수 있다. */
export function parseIntakeCsv(textValue) {
  const lines = text(textValue).split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { rows: [], errors: [], columns: [] };
  const header = splitCsvLine(lines[0]).map(normalizeHeader);
  const mapping = new Map();
  for (const [key, aliases] of Object.entries(CSV_COLUMNS)) {
    const index = header.findIndex(cell => aliases.includes(cell));
    if (index >= 0) mapping.set(key, index);
  }
  const errors = [];
  if (!mapping.has('productName')) {
    errors.push({ line: 1, reason: 'product_name_column_missing' });
    return { rows: [], errors, columns: [...mapping.keys()] };
  }
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index]);
    const productName = text(cells[mapping.get('productName')]);
    if (!productName) {
      errors.push({ line: index + 1, reason: 'product_name_missing' });
      continue;
    }
    const values = {};
    for (const key of REQUIRED_VALUE_KEYS) {
      if (!mapping.has(key)) continue;
      const value = text(cells[mapping.get(key)]);
      if (value) values[key] = value;
    }
    rows.push({ productName, requiredValues: normalizeRequiredValues(values) });
  }
  return { rows, errors, columns: [...mapping.keys()] };
}

function normalizeRequiredValues(values) {
  const result = {};
  for (const key of REQUIRED_VALUE_KEYS) {
    const value = text(record(values)[key]);
    if (value) result[key] = value;
  }
  for (const key of ['salePrice', 'stock', 'supplyPrice', 'cafe24CategoryId']) {
    if (result[key] === undefined) continue;
    result[key] = result[key].replace(/[^\d]/g, '');
    if (result[key] === '') delete result[key];
  }
  // 진열·판매는 Cafe24 가 T/F 만 받는다. '진열함' 같은 말도 그대로 알아듣게 한다.
  for (const key of ['displayStatus', 'sellingStatus']) {
    if (result[key] === undefined) continue;
    const raw = result[key];
    result[key] = /^[fn]$|^(false|no)$|안\s*함|숨김|비노출|중지|미진열|미판매|아니/i.test(raw) ? 'F' : 'T';
  }
  // 가로·세로는 mm 숫자로 맞춘다. 직접 적은 칸이 우선이고, 비었으면 크기 한 줄에서 읽어 온다.
  const pair = resolveSizePair(result);
  if (pair.widthMm) result.widthMm = pair.widthMm; else delete result.widthMm;
  if (pair.depthMm) result.depthMm = pair.depthMm; else delete result.depthMm;
  return result;
}

/**
 * 투입 자체를 막아야 하는 흠. 나머지는 경고로 두고 조립공장이 채우게 한다.
 *
 * 분류·판매가는 조립공장이 나중에 채운다. 그러나 사진의 색상명과 기본 사진은
 * 조립공장이 만들어 낼 수 없다 — 색상명이 없으면 옵션표 슬롯명을 정하지 못하고,
 * 기본 사진이 없으면 만들 바탕이 없다. 이 둘을 '투입 가능' 으로 세면 버튼이 열린 채
 * 남아, 사람이 눌러야만 실패를 알게 된다.
 */
export const BLOCKING_ISSUES = new Set([
  'image_missing',
  'base_image_missing',
  'color_name_missing',
  // 이름 없는 제품은 작업파일명도 큐 표기도 만들 수 없다. 파일명에서 온 쓰레기 이름을
  // 지우고 직접 칠 수 있어야 하므로, 비어 있으면 보내지 말고 여기서 막는다.
  'product_name_missing',
  // 자릿수를 넘긴 숫자는 조립공장이 422 로 거절한다(salePrice ≤12자리, stock ≤9자리).
  // 보내 봐야 실패하므로 여기서 막고 이유를 말한다.
  'sale_price_invalid',
  'stock_invalid',
  // 가로·세로가 없으면 조립공장이 사이즈이미지를 그릴 수 없다. 신화사 DB 에서 고른 제품은
  // DB 가 채워 주지만 직접 입력한 제품은 아무도 못 채운다 — 실측 2026-08-28, 6단계 중
  // 2단계에서 '가로/세로 DB 사이즈값을 먼저 채워주세요' 로 멈췄다. 여기서 미리 막는다.
  'size_mm_missing',
  // 2000mm 를 넘는 값은 조립공장이 조용히 버린다(factoryNormalizeDimensionFactValue).
  // 버려지면 다시 '가로/세로가 비었다' 로 돌아오므로, 왜 그런지 여기서 말해 준다.
  'size_mm_invalid',
]);

/** 조립공장이 받아들이는 치수 상한(mm). 이 위는 조용히 버려진다. */
const MAX_DIMENSION_MM = 2000;

function issuesFor(entry) {
  const issues = [];
  if (!entry.images.length) issues.push('image_missing');
  if (!entry.productName) issues.push('product_name_missing');
  if (!entry.requiredValues.category) issues.push('category_missing');
  if (!entry.requiredValues.salePrice) issues.push('sale_price_missing');
  if (entry.requiredValues.salePrice && !/^\d{1,12}$/.test(entry.requiredValues.salePrice)) {
    issues.push('sale_price_invalid');
  }
  if (entry.requiredValues.stock && !/^\d{1,9}$/.test(entry.requiredValues.stock)) {
    issues.push('stock_invalid');
  }
  // 옵션 사진인데 색상명이 없으면 조립공장이 옵션표 슬롯명을 정하지 못한다.
  if (entry.images.some(image => (
    ['color-option', 'base-and-color'].includes(text(record(image).role)) && !text(record(image).colorName)
  ))) {
    issues.push('color_name_missing');
  }
  if (!entry.images.some(image => text(record(image).role) !== 'color-option')) {
    issues.push('base_image_missing');
  }
  const width = text(entry.requiredValues.widthMm);
  const depth = text(entry.requiredValues.depthMm);
  if (!width || !depth) issues.push('size_mm_missing');
  else if (Number(width) > MAX_DIMENSION_MM || Number(depth) > MAX_DIMENSION_MM) {
    issues.push('size_mm_invalid');
  }
  return issues;
}

/** 파일 묶음과 CSV 와 기본값을 합쳐 투입 계획표를 만든다. */
export function buildBulkPlan(groupsValue, csvRowsValue = [], defaultsValue = {}) {
  const defaults = normalizeRequiredValues(defaultsValue);
  const byName = new Map(
    list(csvRowsValue).map(row => [text(record(row).productName), normalizeRequiredValues(record(row).requiredValues)]),
  );
  const groups = list(record(groupsValue).products ?? groupsValue);
  const entries = groups.map(group => {
    const productName = text(record(group).productName);
    const fromCsv = byName.get(productName) || {};
    const entry = {
      productName,
      images: list(record(group).images),
      requiredValues: { ...defaults, ...fromCsv },
      matchedCsv: byName.has(productName),
    };
    return { ...entry, issues: issuesFor(entry) };
  });
  const unmatchedCsv = [...byName.keys()].filter(
    name => name && !entries.some(entry => entry.productName === name),
  );
  return {
    schema: 'factory-bulk-intake-plan:v1',
    entries,
    unmatchedCsv,
    // 조립공장이 나중에 채울 수 있는 값(분류·판매가)은 경고로 두고 투입을 막지 않는다.
    // 그러나 사진의 색상명과 기본 사진은 조립공장이 만들어 낼 수 없다 — 색상명이 없으면
    // 옵션표 슬롯명을 정하지 못하고, 기본 사진이 없으면 만들 바탕이 없다.
    // 이것들을 '투입 가능' 으로 세면 버튼이 열린 채로 눌러야만 실패를 알게 된다.
    ready: entries.filter(entry => !entry.issues.some(issue => BLOCKING_ISSUES.has(issue))).length,
    blocked: entries.filter(entry => entry.issues.some(issue => BLOCKING_ISSUES.has(issue))).length,
    warned: entries.filter(entry => (
      entry.issues.length && !entry.issues.some(issue => BLOCKING_ISSUES.has(issue))
    )).length,
  };
}

/** 계획표 한 줄을 조립공장 투입 payload 로 바꾼다. dataUrl 은 보낼 직전에 채운다. */
export function buildProductPayload(entry, { batchId, imageModel, dataUrls, sha256s, mode, policySnapshot } = {}) {
  const source = record(entry);
  const productName = text(source.productName);
  const images = list(source.images);
  const urls = list(dataUrls);
  const digests = list(sha256s);
  if (!productName) throw new TypeError('product name required');
  if (!images.length || urls.length !== images.length) throw new TypeError('image payload required');
  // 작업파일명은 조립공장이 파일 시스템 이름으로 쓴다. 금지문자(\ / : * ? " < > |)가 있거나
  // 160자를 넘으면 서버가 factory_product_workfile_invalid 로 거절한다. 파일명에서 온
  // 제품명(=z-image-turbo_00221_ 같은)이 그대로 흘러들 수 있으므로 여기서 다듬는다.
  const workfileStem = productName
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'product';
  const requiredValues = normalizeRequiredValues(source.requiredValues);
  const category = requiredValues.category || '';
  // 옵션 사진에 색상명이 붙어 있을 때만 옵션이 있는 제품이다. 없는데 'provided' 로 보내면
  // 조립공장이 만들 수 없는 색상옵션 단계를 돌리다 막힌다.
  const optionImages = images.filter(image => (
    ['color-option', 'base-and-color'].includes(text(record(image).role)) && text(record(image).colorName)
  ));
  const optionMode = optionImages.length ? 'provided' : 'none';
  return {
    contractType: 'manual-product-intake',
    contractVersion: '1.0.0',
    batchId: text(batchId) || 'batch-bulk-intake',
    idempotencyKey: `bulk-${text(batchId) || 'batch'}-${productName}-${digests[0] || images[0].fileName}`,
    // 큐의 직접 입력 폼과 같은 규칙: 잠근 정책이 있으면 그 판단(auto/manual)을 따른다.
    // 스냅샷 없이 보내면 자동화 정책이 기본값으로 돌아가, 같은 제품이라도 어느 폼으로
    // 넣었느냐에 따라 자동/수동이 달라진다.
    mode: mode === 'auto' ? 'auto' : 'manual',
    ...(policySnapshot && typeof policySnapshot === 'object' ? { policySnapshot } : {}),
    cafe24ApprovalMode: 'existing_one_time_target_gate',
    source: { kind: 'manual' },
    productName,
    workfileName: `${workfileStem}.kuasangse`,
    ...(category ? { category } : {}),
    ...(imageModel ? { imageModel: text(imageModel) } : {}),
    requiredValues: { ...requiredValues, optionMode },
    // '기본 + 색상 옵션' 은 같은 사진을 두 번 싣는다. 조립공장은 색상값을 color-option 역할의
    // 사진에서만 읽기 때문에, 기본 사진 하나로 단일 색상을 만들려면 이 방법뿐이다.
    inputImages: images.flatMap((image, index) => {
      const declared = text(record(image).role);
      const colorName = text(record(image).colorName);
      const sha256 = text(digests[index]) || `bulk-${productName}-${index + 1}`;
      const common = {
        name: text(image.name) || text(image.fileName),
        fileName: text(image.fileName),
        sha256,
        dataUrl: urls[index],
      };
      if (declared === 'color-option' && colorName) {
        return [{ role: 'color-option', ordinal: index + 1, colorName, ...common }];
      }
      if (declared === 'base-and-color' && colorName) {
        return [
          { role: 'base', ordinal: index + 1, ...common },
          { role: 'color-option', ordinal: index + 1, colorName, ...common },
        ];
      }
      return [{ role: 'base', ordinal: index + 1, ...common }];
    }),
  };
}

/** 투입 결과를 한 줄 요약으로 만든다. */
export function summarizeBulkIntake(resultsValue) {
  const results = list(resultsValue);
  const queued = results.filter(item => record(item).status === 'queued').length;
  const failed = results.filter(item => record(item).status === 'error').length;
  const parts = [];
  if (queued) parts.push(`${queued}건 투입`);
  if (failed) parts.push(`${failed}건 실패`);
  return {
    queued,
    failed,
    tone: failed ? (queued ? 'warning' : 'error') : 'ok',
    copy: parts.length ? parts.join(' · ') : '투입할 제품이 없습니다.',
  };
}

/**
 * 새로고침(Ctrl+F5)에도 살아남아야 하는 작업 상태를 순수 데이터로 만든다.
 *
 * 사진 본문(File)은 여기 담지 않는다 — 각 image 의 blobId 가 IndexedDB blob 저장소를
 * 가리킨다. 이렇게 나눠야 글자 한 자 칠 때마다 수 MB 를 다시 쓰지 않는다.
 */
export const WORKING_STATE_SCHEMA = 'bulk-intake-working-state:v1';

export function serializeWorkingState({ grouped, csvRows, csvErrors, defaults } = {}) {
  const source = record(grouped);
  return {
    schema: WORKING_STATE_SCHEMA,
    products: list(source.products).map(productValue => {
      const product = record(productValue);
      return {
        productName: text(product.productName),
        images: list(product.images).map(imageValue => {
          const image = record(imageValue);
          return {
            blobId: text(image.blobId),
            fileName: text(image.fileName),
            ordinal: Number(image.ordinal) || 1,
            role: text(image.role) || 'base',
            colorName: text(image.colorName),
            fileColorName: text(image.fileColorName),
            name: text(image.name),
            type: text(record(image.file).type),
          };
        }),
      };
    }),
    skipped: list(source.skipped).map(itemValue => {
      const item = record(itemValue);
      return { fileName: text(item.fileName), reason: text(item.reason) };
    }),
    csvRows: list(csvRows),
    csvErrors: list(csvErrors),
    defaults: record(defaults),
  };
}

/**
 * 저장해 둔 기록을 화면 상태로 되살린다. blobs 는 blobId → Blob 표.
 *
 * 본문이 사라진 사진은 지어내지 않고 dropped 로 보고한다 — file 없는 사진을 살려 두면
 * 투입 단계(readAsDataUrl)에서야 터진다. 이름만 있고 사진이 없는 카드(빈 제품 추가)는
 * 그대로 살린다. 기록이 깨졌으면 null — 빈 화면으로 시작하는 쪽이 안전하다.
 */
export function hydrateWorkingState(recordValue, blobsValue, makeFile) {
  const stored = record(recordValue);
  if (stored.schema !== WORKING_STATE_SCHEMA || !Array.isArray(stored.products)) return null;
  const blobs = blobsValue instanceof Map ? blobsValue : new Map();
  const build = typeof makeFile === 'function'
    ? makeFile
    : (blob, name, type) => new File([blob], name, { type: type || blob.type || '' });
  const dropped = [];
  const products = [];
  for (const productValue of stored.products) {
    const product = record(productValue);
    const images = [];
    for (const imageValue of list(product.images)) {
      const image = record(imageValue);
      const blob = image.blobId ? blobs.get(text(image.blobId)) : null;
      if (!blob) {
        if (text(image.fileName)) dropped.push(text(image.fileName));
        continue;
      }
      images.push({
        blobId: text(image.blobId),
        fileName: text(image.fileName),
        ordinal: Number(image.ordinal) || images.length + 1,
        role: text(image.role) || 'base',
        colorName: text(image.colorName),
        fileColorName: text(image.fileColorName),
        name: text(image.name),
        file: build(blob, text(image.fileName), text(image.type)),
      });
    }
    products.push({ productName: text(product.productName), images });
  }
  return {
    grouped: { products, skipped: list(stored.skipped) },
    csvRows: list(stored.csvRows),
    csvErrors: list(stored.csvErrors),
    defaults: record(stored.defaults),
    dropped,
  };
}

/**
 * 크기 한 줄에서 가로·세로를 읽어 낸다. 단위는 mm 로 맞춘다.
 *
 * 조립공장의 사이즈이미지 단계는 가로·세로를 **숫자 두 개**로 요구한다(mm). 그런데 사람은
 * 크기를 '20x15cm' 처럼 한 줄로 적는다. 그 한 줄에서 읽어 낼 수 있으면 읽어 주고,
 * 못 읽으면 빈 값을 돌려준다 — 지어내면 엉뚱한 크기의 사이즈컷이 만들어진다.
 *
 * 실측 2026-08-28: 크기를 '20cm' 한 덩어리로만 받아, 직접 입력한 제품이 사이즈 단계에서
 * '가로/세로 DB 사이즈값을 먼저 채워주세요' 로 전부 멈췄다.
 */
export function readSizePair(sizeValue) {
  const raw = text(sizeValue).toLowerCase();
  if (!raw) return { widthMm: '', depthMm: '' };
  // 가로/세로를 말로 적은 경우가 먼저다 — '가로 200 세로 150mm'.
  const labelled = /(?:가로|w)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?[^0-9]{0,6}?(?:세로|깊이|d|h)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i.exec(raw);
  if (labelled) {
    return {
      widthMm: toMillimetres(labelled[1], labelled[2] || labelled[4]),
      depthMm: toMillimetres(labelled[3], labelled[4] || labelled[2]),
    };
  }
  // '20x15', '20*15cm', '200 x 150 mm' 처럼 두 수를 붙여 적은 경우.
  const paired = /(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*[x*×╳]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i.exec(raw);
  if (paired) {
    const unit = paired[4] || paired[2];
    return { widthMm: toMillimetres(paired[1], unit), depthMm: toMillimetres(paired[3], unit) };
  }
  // '45cm 정사각' 처럼 한 수만 적었으면 가로·세로가 같다고 볼 근거가 없다. 비워 둔다.
  return { widthMm: '', depthMm: '' };
}

/**
 * 숫자와 단위를 mm 정수 문자열로 바꾼다.
 *
 * 단위를 안 적었을 때 무엇으로 볼지는 어느 칸에서 왔느냐에 달렸다.
 * - 크기 한 줄('20x15')은 사람이 cm 로 적는다.
 * - 가로/세로 칸은 라벨에 mm 라고 적혀 있으므로 그대로 mm 다.
 * 이 둘을 같게 두면 250 이라고 친 가로가 2500mm 가 된다 — 실측으로 잡은 자리다.
 */
export function toMillimetres(numberValue, unitValue, fallbackUnit = 'cm') {
  const amount = Number(numberValue);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const unit = text(unitValue).toLowerCase() || fallbackUnit;
  const factor = unit === 'mm' ? 1 : unit === 'm' ? 1000 : 10;
  const millimetres = Math.round(amount * factor);
  return millimetres > 0 ? String(millimetres) : '';
}

/**
 * 사람이 적은 가로/세로 칸 값을 mm 로 다듬는다. '20cm' 도 '200' 도 받는다.
 * 칸이 비어 있으면 크기 한 줄에서 읽어 온 값으로 메운다 — 직접 적은 값이 언제나 우선이다.
 */
export function resolveSizePair(values) {
  const source = record(values);
  const fromSize = readSizePair(source.size);
  const pick = (typed, derived) => {
    const raw = text(typed);
    if (!raw) return derived;
    const match = /(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i.exec(raw.toLowerCase());
    // 이 칸은 mm 칸이다. 단위를 안 적었으면 적힌 그대로 mm 로 읽는다.
    return match ? toMillimetres(match[1], match[2], 'mm') : '';
  };
  return {
    widthMm: pick(source.widthMm, fromSize.widthMm),
    depthMm: pick(source.depthMm, fromSize.depthMm),
  };
}
