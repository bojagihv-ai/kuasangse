import { resolveWorkfileIdentity } from './workfile-identity-model.mjs?actualB=1';

const text = value => String(value ?? '').trim();
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function workfileEventIdentity(value, classification) {
  const identity = resolveWorkfileIdentity(value);
  return Object.freeze({
    ...identity,
    workspaceId: text(identity.workspaceId || classification.file.workspaceId),
    productKey: text(identity.productKey || classification.product.productKey),
    runId: text(identity.runId || classification.product.runId),
    revision: Number(identity.revision),
  });
}

function httpUrl(value) {
  const candidate = text(value);
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

function element(tag, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function externalLink(label, href) {
  const link = element('a', 'button-secondary ledger-link', label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  return link;
}

function pill(value, tone = '') {
  const node = element('span', 'factory-pill workfile-pill', value);
  if (tone) node.dataset.tone = tone;
  return node;
}

function fileSizeLabel(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function fieldRow(field) {
  const row = element('div', 'workfile-record-row');
  row.dataset.state = field.status;
  const copy = element('div', 'workfile-record-copy');
  copy.append(
    element('strong', '', field.label),
    element('span', 'status-message', field.value || '값 없음'),
  );
  row.append(
    copy,
    pill(field.status === 'confirmed' ? '확인값' : '누락', field.status === 'confirmed' ? 'ok' : 'error'),
  );
  if (field.source) row.append(element('small', 'workfile-source', field.source));
  return row;
}

function inputImageRow(image) {
  const row = element('div', 'workfile-record-row');
  const copy = element('div', 'workfile-record-copy');
  const role = image.role === 'color-option' ? `색상 옵션${image.colorName ? ` · ${image.colorName}` : ''}` : '기본 이미지';
  copy.append(
    element('strong', '', image.name),
    element('span', 'status-message', `${role}${image.mime ? ` · ${image.mime}` : ''}`),
  );
  row.append(copy, pill(image.available ? '파일 있음' : '참조만 있음', image.available ? 'ok' : ''));
  return row;
}

function outputStage(stage) {
  const card = element('article', 'workfile-stage-card');
  const header = element('div', 'workfile-stage-heading');
  header.append(
    element('strong', '', stage.label),
    pill(`후보 ${stage.candidateCount}`),
    pill(`선택 ${stage.selectedCount}`, stage.selectedCount ? 'ok' : stage.candidateCount ? 'error' : ''),
  );
  card.append(header);
  if (stage.assets.length) {
    const listRoot = element('div', 'workfile-asset-list');
    for (const asset of stage.assets) {
      const row = element('div', 'workfile-asset-row');
      row.append(
        element('span', '', asset.title),
        pill(asset.selected ? 'A컷' : '후보', asset.selected ? 'ok' : ''),
      );
      listRoot.append(row);
    }
    card.append(listRoot);
  } else {
    card.append(element('p', 'status-message', '저장된 결과 자산이 없습니다.'));
  }
  return card;
}

function metric(label, value, tone = '') {
  const node = element('div', 'workfile-metric');
  node.append(element('span', 'label', label), element('strong', '', String(value)));
  if (tone) node.dataset.tone = tone;
  return node;
}

function renderClassification(root, file, result) {
  root.replaceChildren();
  root.hidden = false;

  const header = element('article', 'factory-card workfile-summary-card');
  const title = element('div', 'workfile-title');
  title.append(
    element('span', 'label', '읽어온 상세페이지 작업'),
    element('h3', '', result.product.name),
    element(
      'p',
      'status-message',
      `${file.name} · ${fileSizeLabel(file.size)} · 저장 차수 ${result.file.revision}`,
    ),
  );
  const identity = element('div', 'workfile-identity');
  const linkStatus = pill(
    result.product.jcode ? '신화사 제품 연결 확인 중' : '신화사 제품 미연결',
    result.product.jcode ? 'warning' : 'error',
  );
  linkStatus.id = 'workfile-link-status';
  const jumpButton = element('button', 'button-secondary workfile-jump-button', '대량 제품 투입으로 이동');
  jumpButton.id = 'workfile-jump-button';
  jumpButton.type = 'button';
  jumpButton.addEventListener('click', () => {
    document.getElementById('intake-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  identity.append(
    pill(result.product.jcode ? `신화사 품번 ${result.product.jcode}` : '신화사 제품 미연결', result.product.jcode ? 'ok' : 'error'),
    pill(result.product.runId ? '생성 run 있음' : '생성 run 없음', result.product.runId ? 'ok' : ''),
    linkStatus,
    jumpButton,
  );
  header.append(title, identity);
  root.append(header);

  const metrics = element('div', 'workfile-metrics');
  metrics.append(
    metric('필수값 확인', result.inputs.confirmedFieldCount, result.inputs.missingFieldCount ? '' : 'ok'),
    metric('필수값 누락', result.inputs.missingFieldCount, result.inputs.missingFieldCount ? 'error' : 'ok'),
    metric('입력 이미지', result.inputs.images.length, result.inputs.images.length ? 'ok' : 'error'),
    metric('Output 후보', result.outputs.totalAssetCount),
    metric('선택 A컷', result.outputs.selectedAssetCount, result.outputs.selectedAssetCount ? 'ok' : ''),
    metric('상세 섹션', result.outputs.sectionCount),
  );
  root.append(metrics);

  const publication = result.publication || {};
  const publicationCard = element('article', 'factory-card publication-summary');
  publicationCard.append(
    element('p', 'eyebrow', 'CAFE24 RESULT REPORT'),
    element('h3', '', 'Cafe24 등록 결과 · 작업파일에 저장된 영수증'),
  );
  if (publication.registered && publication.productNo) {
    publicationCard.append(
      pill('Cafe24 등록 완료', 'ok'),
      element(
        'p',
        'card-copy',
        `${publication.productName || result.product.name} · 상품번호 ${publication.productNo}${publication.productCode ? ` · 상품코드 ${publication.productCode}` : ''}`,
      ),
      element('p', 'status-message', `저장된 작업파일: ${publication.sourceWorkfileName || file.name}`),
    );
    const links = element('div', 'button-row');
    const storefrontUrl = httpUrl(publication.storefrontUrl);
    const adminUrl = httpUrl(publication.adminUrl);
    if (storefrontUrl) links.append(externalLink('쇼핑몰 상품 보기', storefrontUrl));
    if (adminUrl) links.append(externalLink('Cafe24 관리자 보기', adminUrl));
    if (links.childElementCount) publicationCard.append(links);
    publicationCard.append(
      element(
        'p',
        'status-message',
        `옵션 그룹 ${publication.optionGroupCount}개 · 옵션값 ${publication.optionValueCount}개 · 조합 ${publication.variantCount}개`,
      ),
    );
  } else {
    publicationCard.append(
      pill('Cafe24 등록 영수증 없음', 'warning'),
      element('p', 'status-message', '이 .kuasangse 파일에는 Cafe24 등록 결과가 저장되어 있지 않습니다.'),
      element('p', 'status-message', '생산관제의 Cafe24 등록 회차와 파일을 먼저 연결한 뒤 저장해야 이 영역에 상품번호와 바로가기가 남습니다.'),
    );
  }
  root.append(publicationCard);

  const lanes = element('div', 'workfile-lanes');
  const inputLane = element('section', 'factory-card workfile-lane');
  inputLane.append(
    element('p', 'eyebrow', 'INPUT'),
    element('h3', '', '자동화에 들어가는 원재료'),
    element(
      'p',
      'card-copy',
      `필수값 ${result.inputs.requiredFields.length}개 · 입력 이미지 ${result.inputs.images.length}장 · 경쟁사 자료 ${result.inputs.competitorCount}건`,
    ),
  );
  const fieldList = element('div', 'workfile-record-list');
  for (const field of result.inputs.requiredFields) fieldList.append(fieldRow(field));
  if (!result.inputs.requiredFields.length) {
    fieldList.append(element('p', 'status-message', '필수값 설정 기록이 없습니다.'));
  }
  inputLane.append(element('h3', 'workfile-subheading', '필수값'), fieldList);
  const imageList = element('div', 'workfile-record-list');
  for (const image of result.inputs.images) imageList.append(inputImageRow(image));
  if (!result.inputs.images.length) {
    imageList.append(element('p', 'status-message', '기본·색상 입력 이미지를 찾지 못했습니다.'));
  }
  inputLane.append(element('h3', 'workfile-subheading', '기본·색상 입력 이미지'), imageList);
  inputLane.append(
    pill(result.inputs.analysisReady ? 'AI 제품 분석 있음' : 'AI 제품 분석 없음', result.inputs.analysisReady ? 'ok' : ''),
    pill(`경쟁사 자료 ${result.inputs.competitorCount}건`),
  );

  const outputLane = element('section', 'factory-card workfile-lane');
  outputLane.append(
    element('p', 'eyebrow', 'OUTPUT'),
    element('h3', '', '생성된 후보와 선택 결과'),
    element(
      'p',
      'card-copy',
      `생성 후보 ${result.outputs.totalAssetCount}개 · 선택 A컷 ${result.outputs.selectedAssetCount}개 · 선택 섹션 ${result.outputs.selectedSectionCount}개`,
    ),
  );
  const stageList = element('div', 'workfile-stage-list');
  for (const stage of result.outputs.stages) stageList.append(outputStage(stage));
  if (!result.outputs.stages.length) {
    stageList.append(element('p', 'status-message', '저장된 생성 결과가 없습니다.'));
  }
  outputLane.append(stageList);
  outputLane.append(
    pill(result.outputs.finalDetailReady ? '최종 상세페이지 있음' : '최종 상세페이지 미완성', result.outputs.finalDetailReady ? 'ok' : 'error'),
  );
  lanes.append(inputLane, outputLane);
  root.append(lanes);

  const next = element('article', 'factory-card workfile-next-step');
  const linkDetail = element(
    'strong',
    '',
    result.product.jcode ? `신화사 품번 ${result.product.jcode} 연결을 확인하고 있습니다.` : '신화사 제품 연결이 필요합니다.',
  );
  linkDetail.id = 'workfile-link-detail';
  next.append(
    linkDetail,
    element(
      'p',
      'status-message',
      result.product.jcode
        ? '아래 대량 제품 투입에서 같은 제품을 자동 검색합니다. 검색 결과와 작업파일 제품명이 맞는지 확인한 뒤 컨베이어에 투입하세요.'
        : '아래 대량 제품 투입에서 제품명이나 신화사 품번을 검색해 이 작업파일과 연결할 제품을 선택하세요.',
    ),
  );
  if (result.warnings.length) {
    const warnings = element('ul', 'workfile-warning-list');
    for (const warning of result.warnings) warnings.append(element('li', '', warning));
    next.append(warnings);
  }
  root.append(next);
}

const ERROR_MESSAGES = Object.freeze({
  workfile_required: '작업파일을 선택해 주세요.',
  workfile_format_invalid: '상세페이지 프로그램에서 저장한 .kuasangse 작업파일이 아닙니다.',
  workfile_json_invalid: '작업파일 JSON이 손상되어 읽을 수 없습니다.',
  workfile_read_failed: '작업파일을 읽는 중 오류가 발생했습니다.',
});

export function mountWorkfileIntake() {
  const input = document.getElementById('workfile-input');
  const selectedFileName = document.getElementById('workfile-file-name');
  const status = document.getElementById('workfile-import-status');
  const resultRoot = document.getElementById('workfile-classification');
  if (!input || !selectedFileName || !status || !resultRoot) return () => {};

  let worker = null;
  const setImportStatus = (message, tone = '') => {
    status.textContent = message;
    status.dataset.tone = tone;
  };
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
  };
  const importFile = file => {
    stopWorker();
    resultRoot.hidden = true;
    resultRoot.replaceChildren();
    selectedFileName.textContent = file?.name || '선택한 파일 없음';
    if (!file || !file.name.toLowerCase().endsWith('.kuasangse')) {
      setImportStatus('확장자가 .kuasangse인 작업파일을 선택해 주세요.', 'error');
      return;
    }
    setImportStatus(`${file.name} 읽는 중 · ${fileSizeLabel(file.size)}`);
    const sourcePromise = file.text();
    worker = new Worker(new URL('./workfile-intake-worker.mjs', import.meta.url), { type: 'module' });
    worker.addEventListener('message', async event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        setImportStatus(
          message.phase === 'parsing'
            ? `${file.name} 내부 필수값·이미지 분류 중`
            : `${file.name} 읽는 중 · ${fileSizeLabel(file.size)}`,
        );
        return;
      }
      if (message.type === 'error') {
        setImportStatus(ERROR_MESSAGES[message.code] || `작업파일 열기 실패 · ${message.code}`, 'error');
        stopWorker();
        return;
      }
      if (message.type !== 'complete') return;
      renderClassification(resultRoot, file, message.result);
      const followUpCount = message.result.warnings.length;
      setImportStatus(
        `${message.result.product.name} 분류 완료${followUpCount ? ` · 보완 필요 ${followUpCount}건` : ' · 생산 준비 완료'} · Input ${message.result.inputs.images.length}장 · Output ${message.result.outputs.totalAssetCount}개`,
        followUpCount ? 'warning' : 'ok',
      );
      try {
        const workfileText = await sourcePromise;
        const value = JSON.parse(workfileText);
        window.dispatchEvent(new CustomEvent('control-tower:workfile-classified', {
          detail: {
            fileName: file.name,
            file,
            workfileText,
            sha256: await sha256Hex(workfileText),
            identity: workfileEventIdentity(value, message.result),
            classification: message.result,
          },
        }));
      } catch (error) {
        setImportStatus(`${file.name} 연결 신원 확인 실패 · ${text(error?.message || error)}`, 'error');
      }
      stopWorker();
    });
    worker.addEventListener('error', () => {
      setImportStatus(ERROR_MESSAGES.workfile_read_failed, 'error');
      stopWorker();
    });
    worker.postMessage({ file });
  };

  const updateProductLink = event => {
    const detail = event.detail || {};
    const linkStatus = document.getElementById('workfile-link-status');
    const linkDetail = document.getElementById('workfile-link-detail');
    if (!linkStatus || !linkDetail) return;
    if (detail.status === 'selected') {
      linkStatus.textContent = detail.ready
        ? '제품 연결 완료 · 원장 입력 준비 완료'
        : '제품 연결 완료 · 원장 보완 필요';
      linkStatus.dataset.tone = detail.ready ? 'ok' : 'warning';
      linkDetail.textContent = detail.ready
        ? `${detail.productName} (신화사 품번 ${detail.jcode}) 선택 완료. 작업파일 제품명과 맞는지 확인한 뒤 컨베이어에 투입하세요.`
        : `${detail.productName} (신화사 품번 ${detail.jcode}) 연결 완료. 원장 누락·경고를 먼저 보완하세요.`;
      return;
    }
    linkStatus.textContent = detail.status === 'not_found' ? '신화사 제품 검색 결과 없음' : '신화사 제품 연결 실패';
    linkStatus.dataset.tone = 'error';
    linkDetail.textContent = detail.status === 'not_found'
      ? `신화사 품번 ${detail.jcode} 검색 결과가 없습니다. 대량 제품 투입에서 제품을 직접 찾아 연결하세요.`
      : '신화사 제품 연결 중 오류가 발생했습니다. 대량 제품 투입에서 다시 검색하세요.';
  };

  input.addEventListener('change', event => importFile(event.target.files?.[0]));
  window.addEventListener('control-tower:workfile-product-linked', updateProductLink);
  window.addEventListener('beforeunload', stopWorker, { once: true });
  return () => {
    stopWorker();
    window.removeEventListener('control-tower:workfile-product-linked', updateProductLink);
  };
}

if (typeof document !== 'undefined') {
  mountWorkfileIntake();
}
