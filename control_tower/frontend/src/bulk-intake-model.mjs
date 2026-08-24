const IMAGE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const CSV_COLUMNS = Object.freeze({
  productName: ['productname', '제품명', '상품명', '이름', 'name'],
  category: ['category', '분류', '카테고리', '상품분류'],
  material: ['material', '소재', '재질'],
  originCountry: ['origincountry', '원산지', '제조국'],
  size: ['size', '크기', '사이즈', '규격'],
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

/**
 * 파일 이름에서 제품과 장 번호를 읽는다.
 * `보자기.jpg` → 보자기 1장, `보자기_2.jpg` / `보자기-3.png` → 같은 제품의 2·3번째 장.
 */
export function readImageName(fileName) {
  const name = text(fileName);
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '');
  const match = /^(.*?)[ _-](\d{1,3})$/.exec(stem);
  if (match && text(match[1])) {
    return { productName: text(match[1]), ordinal: Number(match[2]) };
  }
  return { productName: stem.trim(), ordinal: 1 };
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
    const { productName, ordinal } = readImageName(fileName);
    if (!productName) {
      skipped.push({ fileName, reason: 'product_name_missing' });
      continue;
    }
    if (!groups.has(productName)) groups.set(productName, []);
    groups.get(productName).push({ fileName, ordinal, file });
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
  return result;
}

function issuesFor(entry) {
  const issues = [];
  if (!entry.images.length) issues.push('image_missing');
  if (!entry.productName) issues.push('product_name_missing');
  if (!entry.requiredValues.category) issues.push('category_missing');
  if (!entry.requiredValues.salePrice) issues.push('sale_price_missing');
  // 옵션 사진인데 색상명이 없으면 조립공장이 옵션표 슬롯명을 정하지 못한다.
  if (entry.images.some(image => (
    ['color-option', 'base-and-color'].includes(text(record(image).role)) && !text(record(image).colorName)
  ))) {
    issues.push('color_name_missing');
  }
  if (!entry.images.some(image => text(record(image).role) !== 'color-option')) {
    issues.push('base_image_missing');
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
    ready: entries.filter(entry => !entry.issues.includes('image_missing')).length,
    blocked: entries.filter(entry => entry.issues.includes('image_missing')).length,
    warned: entries.filter(entry => entry.issues.length && !entry.issues.includes('image_missing')).length,
  };
}

/** 계획표 한 줄을 조립공장 투입 payload 로 바꾼다. dataUrl 은 보낼 직전에 채운다. */
export function buildProductPayload(entry, { batchId, imageModel, dataUrls, sha256s } = {}) {
  const source = record(entry);
  const productName = text(source.productName);
  const images = list(source.images);
  const urls = list(dataUrls);
  const digests = list(sha256s);
  if (!productName) throw new TypeError('product name required');
  if (!images.length || urls.length !== images.length) throw new TypeError('image payload required');
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
    mode: 'manual',
    source: { kind: 'manual' },
    productName,
    workfileName: `${productName}.kuasangse`,
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
