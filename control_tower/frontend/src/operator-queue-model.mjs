import { deriveAssemblyWorkbench } from './production-workbench-model.mjs?currentProductTruth=5';
const text = value => String(value ?? '').trim();
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const STAGES = Object.freeze([
  ['db', 'DB 확정', 'sinhwa_db_product'],
  ['required_fields', '필수값', 'required_field_candidate'],
  ['competitors', '경쟁사', 'competitor_product'],
  ['representative', '대표 이미지', 'representative_image'],
  ['size', '사이즈', 'size_image'],
  ['option_color', '옵션·색상', 'option_image'],
  ['general', '일반 이미지컷', 'general_image'],
  ['sections', '섹션 변형', 'section_variant'],
  ['final_detail', '최종 상세페이지', 'final_detail'],
  ['cafe24', 'Cafe24', ''],
]);

function stageFor(job, current = {}) {
  const progress = record(record(current).progress || current);
  const rawStageKey = text(job.stageKey || progress.stageKey);
  const stageKey = rawStageKey === 'export' || rawStageKey === 'cafe24_preflight' || rawStageKey === 'registration'
    ? 'cafe24'
    : rawStageKey;
  if (text(job.status) === 'completed') return STAGES.at(-1);
  return STAGES.find(([key]) => key === stageKey) || STAGES[0];
}

function stageMode(job, decisionId) {
  const resolved = record(record(job.policy).resolved);
  const mode = text(resolved[decisionId] || job.mode);
  return mode === 'manual' ? 'manual' : 'auto';
}

export function buildOperatorQueueRow(jobValue, index = 0, current = {}) {
  const job = record(jobValue);
  const [stageKey, stageLabel, decisionId] = stageFor(job, current);
  const mode = stageMode(job, decisionId);
  const status = text(job.status);
  const waitingForSelection = status === 'waiting_manual';
  const approvalRequired = waitingForSelection && stageKey === 'cafe24';
  const labels = waitingForSelection
    ? { stateLabel: stageKey === 'cafe24' ? '승인 대상 확인' : '내 선택 대기', actionLabel: {
      db: 'DB 확정하기',
      required_fields: '필수값 확인',
      competitors: '경쟁사 선택',
      cafe24: '사전점검 열기',
    }[stageKey] || '컷 고르기' }
    : status === 'running'
      ? { stateLabel: mode === 'auto' ? '자동 생성 중' : '수동 처리 중', actionLabel: '진행 관찰' }
      : status === 'queued'
        ? { stateLabel: '생산 순서 대기', actionLabel: '차례 대기' }
        : status === 'blocked'
          ? { stateLabel: '복구 필요', actionLabel: '오류 확인' }
          : status === 'completed'
            ? { stateLabel: 'Cafe24 확인 대기', actionLabel: 'Cafe24 확인' }
            : { stateLabel: '상태 확인 중', actionLabel: '상태 확인' };
  const assembly = deriveAssemblyWorkbench(
    Object.hasOwn(current, 'progress') ? current : { progress: current },
    job,
  );
  const stageIndex = assembly.steps.findIndex(step => step.key === assembly.currentStep.key) + 1;

  return Object.freeze({
    orderLabel: String(index + 1).padStart(2, '0'),
    stepLabel: `${stageIndex} / ${assembly.steps.length}단계`,
    stageLabel,
    modeLabel: waitingForSelection
      ? approvalRequired ? '승인 대기' : mode === 'auto' ? '자동 진행 후 수동 선택' : '수동 선택'
      : mode === 'auto' ? '자동 진행' : '수동 진행',
    stateLabel: labels.stateLabel,
    actionLabel: labels.actionLabel,
    needsSelection: waitingForSelection && !approvalRequired,
  });
}
