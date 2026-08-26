export const BOARD_STAGES = Object.freeze([
  Object.freeze({ key: 'representative', label: '대표' }),
  Object.freeze({ key: 'size', label: '사이즈' }),
  Object.freeze({ key: 'option_color', label: '옵션·색상' }),
  Object.freeze({ key: 'general', label: '일반' }),
  Object.freeze({ key: 'sections', label: '섹션' }),
  Object.freeze({ key: 'final_detail', label: '최종' }),
]);

const STATUS_LABELS = Object.freeze({
  queued: '대기',
  running: '진행 중',
  waiting_manual: '컷 선택 대기',
  blocked: '차단',
  completed: '완료',
});

const STATUS_TONES = Object.freeze({
  queued: 'neutral',
  running: 'active',
  waiting_manual: 'attention',
  blocked: 'error',
  completed: 'ok',
});

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function stageIndex(stageKey) {
  return BOARD_STAGES.findIndex(stage => stage.key === stageKey);
}

function normalizeCandidate(value) {
  const source = record(value);
  const id = text(source.id || source.candidateId || source.assetId);
  return id
    ? {
      id,
      thumbnailUrl: text(source.thumbnailUrl || source.thumbnailRef),
      model: text(source.model),
      source: text(source.source),
      confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
      rationale: text(source.rationale),
      // 섹션 단계는 한 칸에 여러 섹션의 변형이 함께 온다. 어느 섹션의 것인지 잃어버리면
      // 52개가 한 줄에 쏟아져 사람이 고를 수 없다. id 는 "섹션:변형" 꼴이다.
      sectionId: text(source.sectionId) || text(id).split(':')[0],
      variantId: text(source.variantId),
    }
    : null;
}

function progressStages(progress) {
  const byKey = new Map();
  for (const stage of list(record(progress).stages)) {
    const source = record(stage);
    const key = text(source.key);
    if (!key) continue;
    byKey.set(key, {
      key,
      status: text(source.status),
      selectedId: text(source.selectedId),
      // 섹션 단계의 선택은 섹션마다 하나씩이라 selectedId 하나로는 다 담기지 않는다.
      selectedIds: list(source.selectedIds).map(text).filter(Boolean),
      candidates: list(source.candidates).map(normalizeCandidate).filter(Boolean),
    });
  }
  return byKey;
}

function cellState(stage, { reservedCandidateId, jobStatus, waitingStageKey, reachedIndex, index }) {
  if (reservedCandidateId) return 'reserved';
  if (stage && stage.selectedId) return 'selected';
  if (stage && stage.candidates.length) {
    return jobStatus === 'running' && waitingStageKey === stage.key ? 'running' : 'awaiting';
  }
  if (jobStatus === 'running' && index === reachedIndex) return 'running';
  return 'empty';
}

// 투입값 이름을 사람 말로 보여준다. 코드 이름을 그대로 내면 무엇을 채워야 할지 모른다.
export const PRODUCT_VALUE_LABELS = Object.freeze({
  category: '상품 종류',
  material: '소재',
  originCountry: '원산지',
  size: '사이즈/규격',
  salePrice: '판매가',
  stock: '기본 재고',
  usage: '사용용도',
  optionMode: '옵션 여부',
  cafe24CategoryId: 'Cafe24 분류번호',
  supplyPrice: '공급가',
  displayStatus: '진열',
  sellingStatus: '판매',
});

function valueLabel(key) {
  return PRODUCT_VALUE_LABELS[text(key)] || text(key);
}

const OPERATOR_MESSAGES = Object.freeze({
  factory_product_checkpoint_save_failed: '작업 저장에 실패했습니다. 조립공장에서 이 작업을 다시 열고 재개하세요.',
  factory_product_checkpoint_missing: '저장된 작업 상태가 없습니다. 처음부터 다시 실행해야 합니다.',
  factory_product_checkpoint_invalid: '저장된 작업 상태를 읽을 수 없습니다. 조립공장에서 작업파일을 다시 여세요.',
  factory_product_job_not_resumable: '지금은 재개할 수 없는 상태입니다. 작업 상태를 확인하세요.',
  factory_product_asset_missing: '입력 이미지 원본을 찾지 못했습니다. 이미지를 다시 투입하세요.',
  factory_product_images_too_large: '입력 이미지 용량이 한도를 넘었습니다. 장수나 해상도를 줄이세요.',
  factory_product_required_values_missing: '필수 입력값이 비어 있습니다. 입력·소스에서 채워 주세요.',
  factory_worker_build_mismatch: '조립공장 버전이 관제와 다릅니다. 생산관제를 재시작해 버전을 맞추세요.',
  factory_worker_build_not_admitted: '허용되지 않은 조립공장 버전입니다. 조립공장을 최신으로 실행하세요.',
  factory_session_missing: '조립공장 연결이 끊겼습니다. 조립공장 창을 다시 여세요.',
  stale_factory_session: '조립공장 연결이 새로 맺어졌습니다. 이 작업을 다시 재개하세요.',
  stale_workfile_revision: '작업파일이 더 최신 상태입니다. 조립공장에서 작업파일을 다시 여세요.',
  stale_run_fingerprint: '입력이 바뀌어 이전 결과와 맞지 않습니다. 작업을 다시 실행하세요.',
  candidate_membership_invalid: '고른 컷이 현재 후보에 없습니다. 후보를 다시 확인하세요.',
  factory_decision_required: '자동 판단이 보류됐습니다. 직접 컷을 골라 주세요.',
  factory_product_state_write_failed: '작업 상태를 저장하지 못했습니다. 디스크 여유를 확인하세요.',
  factory_product_checkpoint_restore_mismatch: '저장된 지점과 현재 문서가 달라 복원하지 못했습니다. 다시 시도하세요.',
  factory_product_checkpoint_hydration_failed: '저장된 작업을 불러오지 못했습니다. 다시 시도하세요.',
  factory_cafe24_job_not_ready: '조립공장 생성이 끝난 뒤에 Cafe24 등록을 지시할 수 있습니다.',
  factory_cafe24_target_mismatch: '조립공장이 다른 제품을 열고 있어 등록하지 못했습니다. 다시 시도하세요.',
  factory_cafe24_values_invalid: 'Cafe24 등록값 형식이 잘못됐습니다. 값을 다시 확인하세요.',
});

// Cafe24 등록이 무엇 때문에 막혔는지, 코드가 아니라 사람 말로 보여준다.
const CAFE24_BLOCKER_LABELS = Object.freeze({
  product_id: '상품번호 없음',
  product_key: '작업 식별값 없음',
  run_id: '작업 식별값 없음',
  input_fingerprint: '작업 식별값 없음',
  category_id: '분류번호 없음',
  html_digest: '상세페이지 확정 필요',
  image_digests: '등록 이미지 없음',
  'current-section-export': '상세페이지 내보내기 미완',
});

function cafe24BlockerLabel(token) {
  const key = text(token);
  if (CAFE24_BLOCKER_LABELS[key]) return CAFE24_BLOCKER_LABELS[key];
  const aCut = key.match(/^(.+)_a_cut$/);
  if (aCut) {
    const stage = BOARD_STAGES.find(item => item.key === aCut[1]);
    return `${stage ? stage.label : aCut[1]} 컷 미선택`;
  }
  return key ? withStageLabels(key) : '';
}

const CODE_SHAPE = /^[a-z][a-z0-9_]*(?::[^\s]+)?$/;

const RESULT_ERRORS = Object.freeze({
  factory_history_manifest_unavailable: '이 작업의 결과가 아직 보관함에 저장되지 않았습니다.',
  factory_history_identity_mismatch: '보관함에 있는 결과가 이 작업과 맞지 않습니다.',
  factory_product_job_not_found: '이 작업을 더 이상 찾을 수 없습니다.',
  factory_history_checkpoint_missing: '이 작업은 저장된 지점이 없어 결과를 찾을 수 없습니다. 다시 실행해야 합니다.',
});

/** 고른 컷을 못 불러왔을 때의 이유를 운영자 말로 바꾼다. */
export function describeResultError(code) {
  const key = text(code).split(':')[0];
  return RESULT_ERRORS[key] || '고른 컷을 불러오지 못했습니다.';
}

/** 백엔드 오류 코드를 운영자가 읽을 문장으로 바꾸고, 원래 코드는 따로 남긴다. */
function withStageLabels(value) {
  let copy = value;
  for (const stage of BOARD_STAGES) {
    copy = copy.replace(new RegExp(`\\b${stage.key}\\b`, 'g'), stage.label);
  }
  return copy;
}

export function operatorMessage(value) {
  const message = text(value);
  if (!message) return { copy: '', code: '' };
  const [head, ...rest] = message.split(':');
  const code = text(head);
  const known = OPERATOR_MESSAGES[code];
  if (known) return { copy: known, code: message };
  if (code === 'factory_cafe24_registration_declined') {
    const reasons = (message.split(/등록 차단\s*:/)[1] || '')
      .split(',').map(cafe24BlockerLabel).filter(Boolean);
    const unique = [...new Set(reasons)];
    return {
      copy: unique.length
        ? `Cafe24 등록이 막혔습니다 · ${unique.join(' · ')}`
        : 'Cafe24 등록이 막혔습니다. 등록값을 확인하세요.',
      code: message,
    };
  }
  if (/selection required/i.test(message)) return { copy: '이 단계의 A컷 선택이 필요합니다.', code: '' };
  if (/factory worker failed/i.test(message)) return { copy: '조립공장 실행이 실패했습니다.', code: message };
  if (CODE_SHAPE.test(message) || (CODE_SHAPE.test(code) && rest.length && !/[가-힣]/.test(message))) {
    return { copy: '조립공장에서 처리하지 못했습니다.', code: message };
  }
  return { copy: withStageLabels(message), code: '' };
}

/**
 * 작업 여러 건을 한 화면에 표처럼 나란히 놓기 위한 행/열 모델을 만든다.
 * 각 행은 작업 하나, 각 열은 공정 한 단계이며, 멈춘 칸에서 바로 컷을 고를 수 있다.
 */
export function projectProductionBoard(jobsValue, optionsValue = {}) {
  const options = record(optionsValue);
  const stageFilter = text(options.stageKey);
  const archived = record(options.results);
  const rows = list(jobsValue).map((jobValue, index) => {
    const job = record(jobValue);
    const jobId = text(job.jobId);
    const status = text(job.status) || 'queued';
    const progress = record(job.progress);
    const stages = progressStages(progress);
    // 보관함은 언제나 읽는다. 진행 스냅샷이 있어도 섹션처럼 썸네일이 빠진 단계가 있어,
    // 스냅샷이 있다는 이유로 보관함을 건너뛰면 그 칸은 이미지가 있는데도 체크표시만 뜬다.
    const fromArchive = stagesFromResults(archived[jobId]);
    const pending = record(job.pendingSelection);
    const reservedStageKey = text(pending.stageKey);
    const reservedCandidateId = text(pending.candidateId);
    const awaiting = list(progress.awaitingStageKeys).map(text).filter(Boolean);
    const waitingStageKey = awaiting[0] || text(job.stageKey) || text(progress.stageKey);
    const reachedIndex = Math.max(
      stageIndex(waitingStageKey),
      ...[...stages.values()].map(stage => (stage.selectedId || stage.candidates.length ? stageIndex(stage.key) : -1)),
    );
    const cells = BOARD_STAGES.map((definition, cellIndex) => {
      const archivedStage = fromArchive.get(definition.key) || null;
      // 진행 스냅샷이 있으면 그것이 정본이다. 보관함 기록으로 없는 단계를 만들어 내면,
      // 아직 안 만든 칸이 "고름" 으로 보인다. 보관함은 스냅샷이 아예 없을 때만 단계를 세운다.
      const archivedStageAsSource = stages.size ? null : archivedStage;
      const stage = stages.get(definition.key)
        || (archivedStageAsSource
          ? {
            key: definition.key,
            status: 'selected',
            selectedId: archivedStageAsSource.selectedId,
            candidates: [{
              id: archivedStageAsSource.selectedId,
              thumbnailUrl: archivedStageAsSource.thumbnailUrl,
              model: '', source: 'archive', confidence: null, rationale: '',
            }],
          }
          : null);
      const reserved = reservedStageKey === definition.key ? reservedCandidateId : '';
      const state = cellState(stage, {
        reservedCandidateId: reserved,
        jobStatus: status,
        waitingStageKey,
        reachedIndex,
        index: cellIndex,
      });
      return {
        jobId,
        stageKey: definition.key,
        stageLabel: definition.label,
        state,
        candidateCount: stage ? stage.candidates.length : 0,
        candidates: stage ? stage.candidates : [],
        selectedId: stage ? stage.selectedId : '',
        selectedIds: stage && Array.isArray(stage.selectedIds) ? stage.selectedIds : [],
        reservedCandidateId: reserved,
        // 고른 컷의 그림은 진행 스냅샷에 없을 수 있다. 그때만 보관함에 남은 것을 쓴다.
        // 아직 고르지 않은 칸까지 채우면, 빈 칸이 그림을 달고 나와 표가 들쭉날쭉해진다.
        selectedThumbnailUrl: stage && stage.selectedId
          ? ((stage.candidates.find(candidate => candidate.id === stage.selectedId)?.thumbnailUrl || '')
            || text(archivedStage?.thumbnailUrl))
          : '',
        // 크게 보기용 원본. 고른 칸에서만 쓴다.
        selectedContentUrl: stage && stage.selectedId ? text(archivedStage?.contentUrl) : '',
        // 몇 개 중 몇 번째를 골랐는지. 이게 없으면 화면은 "고름" 만 말하고 무엇을 골랐는지는 안 말한다.
        selectedIndex: stage && stage.selectedId
          ? stage.candidates.findIndex(candidate => candidate.id === stage.selectedId) + 1
          : 0,
        pickable: Boolean(stage && stage.candidates.length && !stage.selectedId)
          && (status === 'waiting_manual' || status === 'blocked'),
        // 이미 고른 칸도 다시 고를 수 있어야 한다. 사람이 마음을 바꾸는 것이 정상이다.
        changeable: Boolean(stage && stage.candidates.length > 1 && stage.selectedId)
          && (status === 'waiting_manual' || status === 'blocked' || status === 'completed'),
      };
    });
    const selectedStageCount = stages.size
      ? integer(progress.selectedStageCount)
      : fromArchive.size || integer(progress.selectedStageCount);
    const messageInfo = operatorMessage(job.message);
    const cafe24Registered = text(job.stageKey) === 'cafe24' && status === 'completed';
    const cafe24Values = record(job.cafe24Values);
    const cafe24Declined = messageInfo.code.startsWith('factory_cafe24_registration_declined');
    // "5/6단계" 는 다음에 무엇을 해야 하는지 말해 주지 않는다. 행마다 다음 할 일
    // 한 줄을 만들어 사람이 세지 않고도 바로 움직일 수 있게 한다.
    const pickableCell = cells.find(cell => cell.pickable);
    const firstUnfinished = cells.find(cell => !cell.selectedId);
    const missingValues = list(job.missingRequiredValues).map(text).filter(Boolean);
    const nextAction = (() => {
      if (cafe24Registered) return { kind: 'registered', copy: 'Cafe24 등록까지 끝났습니다', tone: 'ok' };
      // 값이 비어 있으면 무엇을 만들어도 어긋난다. 다른 안내보다 먼저 지목한다.
      if (missingValues.length && status !== 'running') {
        return {
          kind: 'values',
          copy: `다음: 투입값 채우기 · ${missingValues.map(valueLabel).join(', ')}`,
          tone: 'attention',
        };
      }
      if (status === 'completed' || cafe24Declined) {
        return { kind: 'cafe24', copy: '다음: Cafe24 등록', tone: 'attention' };
      }
      if (pickableCell) {
        return {
          kind: 'pick',
          stageKey: pickableCell.stageKey,
          copy: `다음: ${pickableCell.stageLabel} 컷 고르기 · 후보 ${pickableCell.candidateCount}개`,
          tone: 'attention',
        };
      }
      if (status === 'running') {
        return {
          kind: 'running',
          copy: firstUnfinished ? `지금: ${firstUnfinished.stageLabel} 만드는 중` : '마무리 저장 중',
          tone: 'active',
        };
      }
      if (status === 'waiting_manual') {
        // "컷 선택 대기" 라고 써 놓고 고를 후보가 하나도 없으면, 사람은 무엇을 눌러야
        // 하는지 알 수 없다. 후보가 사라진 상태임을 그대로 말해 준다.
        // 기다리는 그 단계에 고를 후보가 있는지가 핵심이다. 다른 단계에 후보가 남아
        // 있다고 "재개"만 띄우면, 왜 고를 수 없는지 설명이 안 된다.
        const waitingCell = cells.find(cell => cell.stageKey === waitingStageKey) || firstUnfinished;
        const stageLabel = waitingCell ? waitingCell.stageLabel : '';
        return {
          kind: 'resume',
          copy: waitingCell && waitingCell.candidateCount > 0
            ? `다음: 작업 재개 · ${stageLabel} 이어서 진행`
            : `다음: 작업 재개 · ${stageLabel ? `${stageLabel} 후보를 다시 만듭니다` : '남은 단계를 이어갑니다'}`,
          tone: 'attention',
        };
      }
      if (status === 'queued') return { kind: 'queued', copy: '조립공장 차례를 기다리는 중', tone: 'neutral' };
      if (status === 'blocked') return { kind: 'retry', copy: '다음: 다시 시도 누르기', tone: 'error' };
      return { kind: 'idle', copy: '', tone: 'neutral' };
    })();
    return {
      jobId,
      index,
      order: index + 1,
      productName: text(job.productName) || jobId,
      workfileName: text(job.workfileName),
      jcode: job.jcode ?? null,
      mode: text(job.mode),
      status,
      statusLabel: STATUS_LABELS[status] || status,
      statusTone: STATUS_TONES[status] || 'neutral',
      dispatched: job.dispatched === true,
      message: messageInfo.copy,
      messageCode: messageInfo.code,
      attempts: integer(job.attempts),
      imageCount: integer(job.imageCount),
      percent: Math.max(0, Math.min(100, integer(progress.percent))),
      selectedStageCount,
      totalStageCount: integer(progress.totalStageCount) || BOARD_STAGES.length,
      stepLabel: `${Math.min(selectedStageCount, BOARD_STAGES.length)} / ${BOARD_STAGES.length}단계`,
      waitingStageKey,
      reservedStageKey,
      reservedCandidateId,
      hasReservation: Boolean(reservedStageKey && reservedCandidateId),
      cafe24Registered,
      // 분류 입력이 생기기 전에 투입된 작업은 등록 대상 값이 비어 있다. 그대로 등록을
      // 지시하면 조립공장 깊은 곳에서 "등록 차단: category_id" 로 끝나, 사람이 어디를
      // 고쳐야 하는지 알 수 없다.
      cafe24Values,
      cafe24Declined,
      // 비어 있는 투입값을 화면이 알아야, 입력·소스로 되돌아가지 않고 그 자리에서 채울 수 있다.
      requiredValues: record(job.requiredValues),
      missingRequiredValues: list(job.missingRequiredValues).map(text).filter(Boolean),
      // 무엇을 올렸는지 보여야 무엇을 바꿀지 판단할 수 있다.
      inputImageSummary: list(job.inputImageSummary).map(value => {
        const image = record(value);
        return {
          role: text(image.role),
          name: text(image.name),
          fileName: text(image.fileName),
          colorName: text(image.colorName),
        };
      }).filter(image => image.role),
      nextAction,
      autoResumePending: job.autoResumePending === true,
      machineMs: integer(record(job.timing).totalMachineMs),
      waitMs: integer(record(job.timing).totalWaitMs),
      cells: stageFilter ? cells.filter(cell => cell.stageKey === stageFilter) : cells,
    };
  }).filter(row => row.jobId);

  const summary = {
    total: rows.length,
    queued: rows.filter(row => row.status === 'queued').length,
    running: rows.filter(row => row.status === 'running').length,
    waiting: rows.filter(row => row.status === 'waiting_manual').length,
    blocked: rows.filter(row => row.status === 'blocked').length,
    completed: rows.filter(row => row.status === 'completed').length,
    reserved: rows.filter(row => row.hasReservation).length,
    resumable: rows.filter(row => row.status === 'waiting_manual' || row.status === 'blocked').length,
    autoResuming: rows.filter(row => row.autoResumePending).length,
    totalMachineMs: rows.reduce((total, row) => total + row.machineMs, 0),
    totalWaitMs: rows.reduce((total, row) => total + row.waitMs, 0),
    pickableCells: rows.reduce((total, row) => total + row.cells.filter(cell => cell.pickable && !cell.reservedCandidateId).length, 0),
  };
  return { schema: 'factory-production-board:v1', stages: BOARD_STAGES, rows, summary };
}

const BLOCKED_CAUSES = Object.freeze({
  factory_product_checkpoint_save_failed: '조립공장이 작업 상태를 저장하지 못했습니다.',
  factory_worker_failed: '조립공장 실행이 실패했습니다.',
  factory_heartbeat_timeout: '조립공장 연결이 끊긴 채로 멈췄습니다.',
});

/** 차단된 작업이 왜 멈췄고 무엇을 하면 되는지 한 줄로 알려준다. */
export function describeBlocked(row) {
  const source = record(row);
  if (text(source.status) !== 'blocked') return null;
  const code = text(source.messageCode).split(':')[0];
  return {
    cause: BLOCKED_CAUSES[code] || text(source.message) || '조립공장이 이 작업을 끝내지 못했습니다.',
    action: '다시 시도하면 저장된 지점부터 이어서 진행합니다.',
  };
}


const RESULT_STAGE_LIMIT = 4;

/**
 * 보관함에서 읽은 고른 컷을 공정 단계별로 묶는다.
 * 한 작업이 200장 넘게 고른 컷을 갖는 경우가 있어, 그대로 쏟으면 화면이 못 쓰게 된다.
 * 단계마다 앞의 몇 장만 보여주고 나머지는 개수로 알린다.
 */
export function groupResultCuts(assetsValue, { limit = RESULT_STAGE_LIMIT } = {}) {
  const selected = list(assetsValue)
    .map(record)
    .filter(asset => asset.phase === 'output' && asset.selectionState === 'selected');
  const groups = [];
  for (const stage of BOARD_STAGES) {
    const matched = selected.filter(asset => text(asset.stage) === stage.key);
    if (!matched.length) continue;
    groups.push({
      stageKey: stage.key,
      stageLabel: stage.label,
      total: matched.length,
      hidden: Math.max(0, matched.length - limit),
      cuts: matched.slice(0, limit).map(asset => ({
        id: text(asset.id || asset.assetKey),
        displayName: text(asset.displayName || asset.assetKey),
        thumbnailReference: text(asset.thumbnailReference),
        contentReference: text(asset.contentReference),
      })),
    });
  }
  const known = new Set(BOARD_STAGES.map(stage => stage.key));
  const others = selected.filter(asset => !known.has(text(asset.stage)));
  if (others.length) {
    groups.push({
      stageKey: 'other',
      stageLabel: '기타',
      total: others.length,
      hidden: Math.max(0, others.length - limit),
      cuts: others.slice(0, limit).map(asset => ({
        id: text(asset.id || asset.assetKey),
        displayName: text(asset.displayName || asset.assetKey),
        thumbnailReference: text(asset.thumbnailReference),
        contentReference: text(asset.contentReference),
      })),
    });
  }
  return { total: selected.length, groups };
}


/**
 * 보관함에서 읽은 고른 컷으로 공정 칸을 채운다.
 * 진행 스냅샷이 없는 예전 작업(특히 이미 완료된 작업)은 이것 말고는 단계를 알 길이 없다.
 */
export function stagesFromResults(assetsValue) {
  const byStage = new Map();
  for (const asset of list(assetsValue).map(record)) {
    if (asset.phase !== 'output' || asset.selectionState !== 'selected') continue;
    const key = text(asset.stage);
    if (!key || byStage.has(key)) continue;
    byStage.set(key, {
      selectedId: text(asset.id || asset.assetKey),
      thumbnailUrl: text(asset.thumbnailReference),
      // 크게 볼 때는 축소본이 아니라 원본을 띄워야 한다. 축소본을 늘리면 뭉개져서
      // 크게 본 의미가 없다.
      contentUrl: text(asset.contentReference),
    });
  }
  return byStage;
}


/** 밀리초를 사람이 읽는 짧은 길이로 바꾼다. */
export function durationLabel(milliseconds) {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0) / 1000);
  if (total < 1) return '0초';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

/**
 * 전체 시간 중 기계가 실제로 돌아간 비중을 알려준다.
 * 이 비중이 낮으면 조립공장을 여러 개 띄워도 단축될 여지가 그만큼밖에 없다는 뜻이다.
 */
export function describeParallelHeadroom(summaryValue) {
  const summary = record(summaryValue);
  const machine = integer(summary.totalMachineMs);
  const wait = integer(summary.totalWaitMs);
  const total = machine + wait;
  if (!total) {
    return { measured: false, machineSharePercent: 0, tone: '', copy: '아직 측정된 공정 시간이 없습니다.' };
  }
  const share = Math.round((machine / total) * 100);
  const verdict = share >= 65
    ? '조립공장을 늘리면 그만큼 빨라질 여지가 큽니다.'
    : share >= 35
      ? '조립공장을 늘리면 절반 정도 효과를 볼 수 있습니다.'
      : '대부분 사람 판단을 기다린 시간이라, 조립공장을 늘려도 크게 빨라지지 않습니다.';
  return {
    measured: true,
    machineSharePercent: share,
    tone: share >= 65 ? 'ok' : share >= 35 ? '' : 'warning',
    copy: `기계 ${durationLabel(machine)} · 사람 대기 ${durationLabel(wait)} (기계 비중 ${share}%) · ${verdict}`,
  };
}


/** 예약되지 않은 대기 칸만 모아 일괄 선택 요청 본문으로 만든다. */
export function buildBatchSelectionRequest(board, { candidateId = '', mode = 'manual' } = {}) {
  const rows = list(record(board).rows);
  const selections = [];
  for (const row of rows) {
    for (const cell of list(record(row).cells)) {
      if (!cell.pickable || cell.reservedCandidateId) continue;
      const chosen = candidateId || cell.candidates[0]?.id || '';
      if (!chosen) continue;
      selections.push({ jobId: row.jobId, stageKey: cell.stageKey, candidateId: chosen });
      break;
    }
  }
  return mode === 'auto'
    ? { mode: 'auto', jobIds: selections.map(entry => entry.jobId) }
    : { mode: 'manual', selections };
}

/** 일괄 선택 응답을 사람이 읽을 한 줄 요약으로 만든다. */
/** 서버가 돌려주는 보류 사유를 사람 말로 옮긴다. 모르는 코드는 그대로 보여 준다. */
const BATCH_SELECTION_REASONS = Object.freeze({
  policy_snapshot_missing: '정책 스냅샷 없음',
  policy_snapshot_invalid: '정책 스냅샷이 올바르지 않음',
  no_pickable_stage: '고를 대기 단계 없음',
  no_candidates: '후보 없음',
  job_busy: '조립공장이 이 작업을 물고 있음',
  factory_product_job_busy: '조립공장이 이 작업을 물고 있음',
  already_reserved: '이미 예약됨',
});

export function summarizeBatchSelection(responseValue) {
  const response = record(responseValue);
  const applied = integer(response.applied);
  const reserved = integer(response.reserved);
  const skipped = integer(response.skipped);
  const failed = integer(response.failed);
  const parts = [];
  if (applied) parts.push(`${applied}건 즉시 적용`);
  if (reserved) parts.push(`${reserved}건 예약`);
  if (skipped) parts.push(`${skipped}건 보류`);
  if (failed) parts.push(`${failed}건 실패`);
  // "3건 보류" 만 적어 두면 왜 안 됐는지 알 길이 없다. 서버는 작업마다 사유를
  // 돌려주는데 화면이 그것을 버리고 있었다. 실측 2026-08-26: 사유가
  // policy_snapshot_missing 이었는데 화면에는 아무 데도 없었다.
  const reasons = [...new Set(
    list(response.results)
      .map(item => text(record(item).reason))
      .filter(Boolean),
  )];
  const reasonCopy = reasons.length
    ? ` · 사유 ${reasons.map(reason => BATCH_SELECTION_REASONS[reason] || reason).join(', ')}`
    : '';
  return {
    applied,
    reserved,
    skipped,
    failed,
    reasons,
    tone: failed ? 'error' : skipped ? 'warning' : 'ok',
    copy: parts.length ? `${parts.join(' · ')}${reasonCopy}` : '선택할 대기 작업이 없습니다.',
  };
}
