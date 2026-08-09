function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function helper(helpers, name, fallback) {
  const candidate = helpers?.[name];
  return typeof candidate === 'function' ? candidate : fallback;
}

function escapeHtmlFallback(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttrFallback(value) {
  return escapeHtmlFallback(value);
}

function disabledAttrFallback(disabled, reason = '') {
  return disabled ? `disabled${reason ? ` title="${escapeAttrFallback(reason)}"` : ''}` : '';
}

function statusToneFallback(status) {
  if (status === 'done') return { label: '완료', color: 'var(--ok)', border: 'rgba(34,197,94,.42)', bg: 'rgba(34,197,94,.075)', icon: 'check_circle' };
  if (status === 'missing') return { label: '채우기 필요', color: 'var(--danger)', border: 'rgba(239,68,68,.52)', bg: 'rgba(127,29,29,.16)', icon: 'error' };
  if (status === 'running') return { label: '진행 중', color: 'var(--warn)', border: 'rgba(245,158,11,.48)', bg: 'rgba(245,158,11,.085)', icon: 'sync' };
  return { label: '선택 대기', color: 'var(--warn)', border: 'rgba(245,158,11,.40)', bg: 'rgba(245,158,11,.06)', icon: 'pending' };
}

function statusCardFallback(label, value, detail, done = false, escapeHtml = escapeHtmlFallback) {
  return `<div class="factory-automation-status-card ${done ? 'done' : 'warn'}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(String(value))}</strong>
    <span>${escapeHtml(detail)}</span>
  </div>`;
}

function taskChecklistFallback(tasks, tabId, helpers) {
  const rows = Array.isArray(tasks) ? tasks.filter(task => !tabId || task?.tab === tabId) : [];
  const escapeHtml = helpers.escapeHtml;
  const escAttr = helpers.escAttr;
  const tone = helpers.factoryAutomationStatusTone;
  return `<div class="factory-automation-step-list">
    ${rows.map(task => {
      const taskTone = tone(task?.displayStatus);
      const title = String(task?.title || '');
      const desc = task?.skipped ? `넘김 처리됨 · ${task?.desc || ''}` : String(task?.desc || '');
      const label = task?.actionLabel || '이 작업 열기';
      return `<div class="factory-automation-step" style="border-color:${taskTone.border};background:${taskTone.bg}">
        <span class="material-icons-outlined" style="color:${taskTone.color}">${escapeHtml(task?.skipped ? 'skip_next' : taskTone.icon)}</span>
        <div><div class="factory-automation-step-title">${escapeHtml(title)}</div><div class="factory-automation-step-desc">${escapeHtml(desc)}</div></div>
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end">
          <span class="factory-pill" style="border-color:${taskTone.border};color:${taskTone.color};background:${taskTone.bg}">${escapeHtml(taskTone.label)}</span>
          <button class="btn-sm" data-factory-guide-action="${escAttr(task?.action || '')}">${escapeHtml(label)}</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function fieldCard(item, helpers) {
  const escapeHtml = helpers.escapeHtml;
  const escAttr = helpers.escAttr;
  const tone = helpers.factoryAutomationStatusTone(item?.status);
  const inputValue = item?.hasDraft ? item.draftValue : (item?.value || '');
  if (item?.readonly) return `<div class="factory-automation-status-card ${item.status === 'done' ? 'done' : 'warn'}" style="border-color:${tone.border};background:${tone.bg}">
    <span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value || '선택 필요')}</strong>
    <span>${escapeHtml(item.status === 'done' ? `확인됨 · ${item.source || '선택 완료'}` : (item.source || '옵션 없음/있음 여부를 선택하세요.'))}</span>
  </div>`;
  const isConfirmed = item?.status === 'done' && !item?.hasDraft;
  const sourceText = item?.hasDraft
    ? '수정 중입니다. 수정 적용을 눌러야 확정값에 반영됩니다.'
    : isConfirmed ? `확인됨 · ${item.source || '직접 확인'}` : (item?.source || '값을 입력한 뒤 확인을 누르면 확정됩니다.');
  if (isConfirmed) return `<div class="factory-automation-status-card done" style="display:block;border-color:${tone.border};background:${tone.bg}">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span style="color:${tone.color};font-weight:900">${escapeHtml(item.label)}${item.required ? ' · 필수' : ''}</span><span style="font-size:11px;color:var(--ok);font-weight:950">✓ 확인됨</span></div>
    <input class="input" data-factory-wizard-field="${escAttr(item.id)}" data-factory-wizard-label="${escAttr(item.label)}" data-factory-wizard-previous-value="${escAttr(inputValue || item.value || '')}" value="${escAttr(inputValue)}" readonly aria-label="${escAttr(item.label)} 확정값" style="margin-top:7px;min-height:34px;opacity:.88">
    <div class="factory-automation-actions" style="margin-top:7px"><button class="btn-sm" type="button" data-factory-wizard-edit="${escAttr(item.id)}" data-factory-wizard-commit="${escAttr(item.id)}">값 수정</button></div>
    <span>${escapeHtml(sourceText)}</span>
  </div>`;
  return `<div class="factory-automation-status-card" style="display:block;border-color:${tone.border};background:${tone.bg}">
    <span style="color:${tone.color};font-weight:900">${escapeHtml(item.label)}${item.required ? ' · 필수' : ''}</span>
    <input class="input" data-factory-wizard-field="${escAttr(item.id)}" data-factory-wizard-label="${escAttr(item.label)}" data-factory-wizard-previous-value="${escAttr(inputValue || item.value || '')}" value="${escAttr(inputValue)}" placeholder="${escAttr(item.placeholder || '')}" style="margin-top:7px;min-height:34px">
    <div class="factory-automation-actions" style="margin-top:7px"><button class="btn-sm primary" type="button" data-factory-wizard-commit="${escAttr(item.id)}">${item.hasDraft ? '수정 적용' : '확인'}</button></div>
    <span>${escapeHtml(sourceText)}</span>
  </div>`;
}

function sizeNotice(factory, helpers) {
  const hint = helpers.factoryBojagiSquareSizeOptionSuggestion(factory);
  const savedNotice = String(factory.automation?.sizeAutofillNotice || '').trim();
  if (!hint?.notice && !savedNotice) return '';
  const values = Array.isArray(hint?.optionValues) && hint.optionValues.length ? `옵션 후보: ${hint.optionValues.slice(0, 8).join(', ')}` : '';
  return `<div class="factory-card" style="border-color:rgba(34,197,94,.36);background:rgba(16,185,129,.08);margin-bottom:14px">
    <div style="font-size:13px;font-weight:950;color:var(--ok)">보자기 정사각형 사이즈 자동채움</div>
    <div class="factory-small" style="margin-top:5px;color:var(--text)">${helpers.escapeHtml(hint?.notice || savedNotice)}</div>
    ${values ? `<div class="factory-small" style="margin-top:4px">${helpers.escapeHtml(values)}</div>` : ''}
    <div class="factory-small" style="margin-top:4px">근거: ${helpers.escapeHtml(hint?.sourceLabel || '선택 상품')}</div>
  </div>`;
}

function missingPanel(summary, helpers) {
  const missing = [...(summary.missingRegister || []), ...(summary.missingGenerate || [])];
  const autoDone = Array.isArray(summary.autoDone) ? summary.autoDone : [];
  const autoDoneText = autoDone.length ? `자동/선택 상품 기준으로 통과한 필수값 ${autoDone.length}개: ${autoDone.slice(0, 6).map(item => item.label).join(', ')}${autoDone.length > 6 ? ' 외' : ''}` : '';
  const notice = String(summary.fieldCommitNotice || '').trim();
  const ready = missing.length === 0;
  const escapeHtml = helpers.escapeHtml;
  const escAttr = helpers.escAttr;
  const groups = ['상품등록 필수', '생성 필수'];
  return `<div class="factory-card" id="factoryWizardMissingFieldsPanel" style="border-color:${ready ? 'rgba(34,197,94,.34)' : 'rgba(239,68,68,.46)'};background:${ready ? 'rgba(34,197,94,.07)' : 'rgba(127,29,29,.12)'};margin-bottom:14px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap"><div>
      <div style="font-size:13px;font-weight:950;color:${ready ? 'var(--ok)' : 'var(--danger)'}">필수값 확인판 · ${ready ? '준비 완료' : `직접 확인할 필수값 ${missing.length}개`}</div>
      <div class="factory-small" style="margin-top:4px">초록색은 현재 확정된 값입니다. 바꾸려면 <b>값 수정</b>을 누른 뒤 <b>수정 적용</b>을 눌러야 합니다.</div>
      ${autoDoneText ? `<div class="factory-small" style="margin-top:4px;color:var(--ok)">${escapeHtml(autoDoneText)}</div>` : ''}
      ${notice ? `<div data-factory-field-commit-notice class="factory-small" style="margin-top:7px;padding:7px 9px;border-radius:7px;border:1px solid rgba(34,197,94,.45);background:rgba(34,197,94,.10);color:var(--ok);font-weight:900">✓ ${escapeHtml(notice)}</div>` : ''}
    </div><div class="factory-automation-actions" style="justify-content:flex-end">
      ${missing.length ? '<button class="btn-sm primary" type="button" data-factory-wizard-commit-all>입력값 확인 적용</button>' : ''}
      <button class="btn-sm" data-factory-guide-action="focus-missing-field-source"><span class="material-icons-outlined" style="font-size:14px">vertical_align_bottom</span>직접기입하러가기</button>
    </div></div>
    ${groups.map(group => `<div style="margin-top:12px"><div style="font-size:12px;font-weight:950;color:var(--text);margin-bottom:8px">${escapeHtml(group)}</div><div class="factory-automation-status-grid">${(summary.fields || []).filter(item => item.group === group).map(item => fieldCard(item, helpers)).join('')}</div></div>`).join('')}
  </div>`;
}

function transferPanel(factory, summary, helpers) {
  const rows = helpers.factoryFieldTransferRows(factory, summary);
  const transfer = record(helpers.factoryFieldTransferState(factory));
  const selected = new Set(Array.isArray(transfer.selectedFieldIds) ? transfer.selectedFieldIds : []);
  const selectableRows = rows.filter(row => row.value && (row.sinhwa || row.cafe24));
  const selectedRows = selectableRows.filter(row => selected.has(row.id));
  const sinhwaRows = selectedRows.filter(row => row.sinhwa);
  const cafe24Rows = selectedRows.filter(row => row.cafe24);
  const sinhwaTarget = helpers.factorySinhwaSelectedTransferTarget(factory);
  const cafe24Target = helpers.factoryCafe24SelectedTransferTarget(factory);
  const running = transfer.status === 'running';
  const statusTone = transfer.status === 'done'
    ? { color: 'var(--ok)', border: 'rgba(34,197,94,.42)', bg: 'rgba(34,197,94,.08)' }
    : transfer.status === 'error' ? { color: 'var(--danger)', border: 'rgba(239,68,68,.46)', bg: 'rgba(127,29,29,.14)' }
      : transfer.status === 'running' ? { color: 'var(--warn)', border: 'rgba(245,158,11,.46)', bg: 'rgba(245,158,11,.08)' }
        : { color: 'var(--text-m)', border: 'rgba(99,102,241,.28)', bg: 'rgba(99,102,241,.05)' };
  const targetText = (target, kind) => target ? (kind === 'sinhwa' ? `확정 상품 #${target.jcode}${target.name ? ` · ${target.name}` : ''}` : `확정 상품 #${target.productNo}${target.name ? ` · ${target.name}` : ''}`) : '확정 대상 없음';
  const disabledAttr = helpers.disabledAttr;
  const escapeHtml = helpers.escapeHtml;
  const escAttr = helpers.escAttr;
  return `<section class="factory-card" data-factory-field-transfer-panel style="margin-bottom:14px;border-color:rgba(99,102,241,.38);background:rgba(99,102,241,.055)">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap"><div style="min-width:240px;flex:1"><div style="font-size:13px;font-weight:950;color:var(--text)">선택한 값만 외부로 전송</div><div class="factory-small" style="margin-top:5px;color:var(--text)">자동 실시간 동기화는 하지 않습니다. 체크한 값만 대상별 확인창을 거쳐 전송하고, 저장 응답을 다시 확인합니다.</div></div><div class="factory-automation-actions" style="margin:0"><button class="btn-sm" type="button" data-factory-field-transfer-select-all ${disabledAttr(!selectableRows.length || running, running ? '전송 작업이 진행 중입니다.' : '전송 가능한 값이 없습니다.')}>전송 가능 전체 선택</button><button class="btn-sm" type="button" data-factory-field-transfer-clear ${disabledAttr(!selectedRows.length || running, running ? '전송 작업이 진행 중입니다.' : '선택한 값이 없습니다.')}>선택 해제</button></div></div>
    <div class="factory-field-transfer-grid">${rows.map(row => { const supported = row.sinhwa || row.cafe24; const disabled = !row.value || !supported || running; const badges = [row.sinhwa ? '<span class="factory-pill" style="color:var(--ok)">신화사DB</span>' : '', row.cafe24 ? '<span class="factory-pill" style="color:#a5b4fc">Cafe24</span>' : ''].filter(Boolean).join(''); return `<label style="display:flex;align-items:flex-start;gap:8px;border:1px solid ${selected.has(row.id) ? 'rgba(99,102,241,.58)' : 'var(--border)'};border-radius:8px;padding:9px;background:${selected.has(row.id) ? 'rgba(99,102,241,.12)' : 'rgba(0,0,0,.12)'};min-width:0;${disabled ? 'opacity:.56' : 'cursor:pointer'}"><input type="checkbox" value="${escAttr(row.id)}" data-factory-field-transfer-id="${escAttr(row.id)}" ${selected.has(row.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="margin-top:3px"><span style="min-width:0;flex:1"><span style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap"><b style="font-size:12px;color:var(--text)">${escapeHtml(row.label)}</b><span style="display:flex;gap:4px;flex-wrap:wrap">${badges || '<span class="factory-small">전송 미지원</span>'}</span></span><span class="factory-small" style="display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(row.value || '')}">${escapeHtml(row.value || '값 없음')}</span></span></label>`; }).join('')}</div>
    <div class="factory-field-transfer-target-grid"><div style="border-top:1px solid rgba(34,197,94,.28);padding-top:10px;min-width:0"><div class="factory-small" style="color:${sinhwaTarget ? 'var(--ok)' : 'var(--warn)'}">신화사DB · ${escapeHtml(targetText(sinhwaTarget, 'sinhwa'))}</div><button class="btn-primary" type="button" data-factory-field-transfer-target="sinhwa" ${disabledAttr(running || !sinhwaTarget || !sinhwaRows.length, running ? '다른 전송이 진행 중입니다.' : !sinhwaTarget ? '2번 DB 확정에서 신화사DB 상품을 먼저 고르세요.' : '신화사DB로 전송할 값을 체크하세요.')} style="margin-top:7px;width:100%;justify-content:center">${running && transfer.target === 'sinhwa' ? '<span class="spinner" style="width:13px;height:13px;margin-right:5px"></span>신화사DB 전송 중...' : `선택 ${sinhwaRows.length}개 신화사DB로 전송`}</button></div><div style="border-top:1px solid rgba(99,102,241,.32);padding-top:10px;min-width:0"><div class="factory-small" style="color:${cafe24Target ? '#a5b4fc' : 'var(--warn)'}">Cafe24 · ${escapeHtml(targetText(cafe24Target, 'cafe24'))}</div><button class="btn-primary" type="button" data-factory-field-transfer-target="cafe24" ${disabledAttr(running || !cafe24Target || !cafe24Rows.length, running ? '다른 전송이 진행 중입니다.' : !cafe24Target ? '2번 DB 확정에서 Cafe24 상품을 먼저 고르세요.' : 'Cafe24로 전송할 값을 체크하세요.')} style="margin-top:7px;width:100%;justify-content:center">${running && transfer.target === 'cafe24' ? '<span class="spinner" style="width:13px;height:13px;margin-right:5px"></span>Cafe24 전송 중...' : `선택 ${cafe24Rows.length}개 Cafe24로 전송`}</button></div></div>
    ${transfer.message ? `<div style="margin-top:11px;border:1px solid ${statusTone.border};background:${statusTone.bg};border-radius:8px;padding:9px 10px;color:${statusTone.color};font-size:12px;font-weight:900">${running ? '<span class="spinner" style="width:12px;height:12px;margin-right:6px;vertical-align:-2px"></span>' : ''}${escapeHtml(transfer.message)}</div>` : ''}
    <div class="factory-small" style="margin-top:9px">가격·재고처럼 신화사DB의 안전한 부분 수정 계약이 없는 값은 신화사DB 버튼에서 제외됩니다. Cafe24 옵션·재고·상세 HTML도 이 기본값 전송판에서 제외됩니다.</div>
  </section>`;
}

export function renderFieldsFactoryTab(view, injectedHelpers = {}) {
  const helpers = {
    escapeHtml: helper(injectedHelpers, 'escapeHtml', escapeHtmlFallback),
    escAttr: helper(injectedHelpers, 'escAttr', escapeAttrFallback),
    disabledAttr: helper(injectedHelpers, 'disabledAttr', disabledAttrFallback),
    factoryAutomationStatusTone: helper(injectedHelpers, 'factoryAutomationStatusTone', statusToneFallback),
    factoryAutomationCounts: helper(injectedHelpers, 'factoryAutomationCounts', () => ({})),
    factoryAutomationReviewSummary: helper(injectedHelpers, 'factoryAutomationReviewSummary', () => ({ fields: [], missingRegister: [], missingGenerate: [], autoDone: [] })),
    factoryBojagiSquareSizeOptionSuggestion: helper(injectedHelpers, 'factoryBojagiSquareSizeOptionSuggestion', () => null),
    factoryFieldTransferRows: helper(injectedHelpers, 'factoryFieldTransferRows', () => []),
    factoryFieldTransferState: helper(injectedHelpers, 'factoryFieldTransferState', () => ({})),
    factorySinhwaSelectedTransferTarget: helper(injectedHelpers, 'factorySinhwaSelectedTransferTarget', () => null),
    factoryCafe24SelectedTransferTarget: helper(injectedHelpers, 'factoryCafe24SelectedTransferTarget', () => null),
  };
  const source = record(view);
  const factory = record(source.factory || source);
  const counts = record(source.counts || helpers.factoryAutomationCounts(factory));
  const summary = record(source.summary || helpers.factoryAutomationReviewSummary(factory, counts));
  const tasks = Array.isArray(source.tasks) ? source.tasks : (Array.isArray(factory.automation?.tasks) ? factory.automation.tasks : []);
  const auto = record(factory.automation);
  const hasSizeImageCandidate = Number(counts.sizeSelected || 0) > 0 || Number(counts.sizeAssets || 0) > 0;
  const checklist = typeof injectedHelpers.renderFactoryAutomationTaskChecklist === 'function'
    ? injectedHelpers.renderFactoryAutomationTaskChecklist(tasks, 'fields')
    : taskChecklistFallback(tasks, 'fields', helpers);
  const renderStatusCard = helper(injectedHelpers, 'renderFactoryAutomationStatusCard', (label, value, detail, done) => statusCardFallback(label, value, detail, done, helpers.escapeHtml));
  return `<div>
    <div class="factory-automation-grid"><div class="factory-automation-panel"><h4>3. 필수값</h4><p>빨간 칸은 지금 채워야 하는 값입니다. 사이즈값이 채워지면 사이즈이미지 생성 버튼이 바로 활성화됩니다.</p>
      ${sizeNotice(factory, helpers)}${missingPanel(summary, helpers)}
      <div class="factory-automation-actions">${hasSizeImageCandidate ? `<button class="btn-primary" data-factory-guide-action="go-tab:assets">생성컷 선택으로 이동</button><button class="btn-sm" data-factory-guide-action="run-size-now" ${helpers.disabledAttr(!summary.sizeReady, '가로/세로 값을 먼저 채워주세요.')}>사이즈이미지 다시 생성</button>` : `<button class="btn-primary" data-factory-guide-action="run-size-now" ${helpers.disabledAttr(!summary.sizeReady, '가로/세로 값을 먼저 채워주세요.')}>사이즈이미지 생성</button><button class="btn-sm" data-factory-guide-action="go-tab:assets">생성컷 선택으로 이동</button>`}</div>
    </div><div class="factory-automation-panel"><h4>옵션 여부</h4><p>옵션표와 색상 판단은 기존 옵션분류기 흐름을 사용합니다. 여기서는 어떤 경로로 갈지만 확정합니다.</p><div class="factory-automation-status-grid">${renderStatusCard('현재 선택', auto.optionMode === 'none' ? '옵션 없음' : auto.optionMode === 'provided' ? '옵션 있음' : '미결정', '색상옵션 섹션과 옵션표 생성 기준으로 사용됩니다.', auto.optionMode !== 'pending')}${renderStatusCard('옵션 결과', `${Number(counts.optionAssets || 0)}개`, '옵션분류기 최종 결과가 있으면 색상옵션 섹션 기본 이미지로 사용합니다.', Number(counts.optionAssets || 0) > 0)}</div><div class="factory-automation-actions"><button class="btn-sm" data-factory-guide-action="mark-no-options">옵션 없음</button><button class="btn-sm primary" type="button" data-factory-option-color-upload>옵션 있음 - 색상이미지 직접넣기</button><button class="btn-sm" data-factory-guide-action="mark-options-match">옵션 있음 - 옵션분류기에서 매칭</button><input type="file" data-factory-option-color-file accept="image/*" multiple style="display:none"></div>${checklist}</div></div>
    ${transferPanel(factory, summary, { ...helpers, factoryFieldTransferRows: helper(injectedHelpers, 'factoryFieldTransferRows', () => []), factoryFieldTransferState: helper(injectedHelpers, 'factoryFieldTransferState', () => ({})), factorySinhwaSelectedTransferTarget: helper(injectedHelpers, 'factorySinhwaSelectedTransferTarget', () => null), factoryCafe24SelectedTransferTarget: helper(injectedHelpers, 'factoryCafe24SelectedTransferTarget', () => null) })}
  </div>`;
}
