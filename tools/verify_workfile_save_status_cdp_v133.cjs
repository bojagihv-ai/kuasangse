const fs = require('fs');
const path = require('path');
const { assertChecks, connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9343';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'workfile-save-modes-v139.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'workfile-save-modes-v139.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let proof;
  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && document.getElementById("saveCurrentProjectFileBtn") && document.getElementById("saveProjectFileAsBtn"))', 60000);
    proof = await evaluate(cdp, `(() => {
      const waitFor = (predicate, timeoutMs = 10000, label = 'save status') => new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const tick = () => {
          if (predicate()) return resolve();
          if (Date.now() > deadline) return reject(new Error(label + ' wait timeout'));
          setTimeout(tick, 20);
        };
        tick();
      });
      return (async () => {
        window.state.currentProjectName = '저장상태검증';
        const originalPicker = window.showSaveFilePicker;
        const writes = { initial: [], current: [], saveAs: [], newDocument: [] };
        let pickerCalls = 0;
        let currentWriteStarted = false;
        let releaseCurrentWrite;
        const currentWriteGate = new Promise(resolve => { releaseCurrentWrite = resolve; });
        let initialWriteCount = 0;
        const initialHandle = {
          name: '현재상태저장.kuasangse',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async blob => {
              initialWriteCount += 1;
              if (initialWriteCount === 1) {
                writes.initial.push(await blob.text());
                return;
              }
              currentWriteStarted = true;
              writes.current.push(await blob.text());
              await currentWriteGate;
            },
            close: async () => {},
          }),
        };
        const saveAsHandle = {
          name: '다른이름저장.kuasangse',
          createWritable: async () => ({
            write: async blob => { writes.saveAs.push(await blob.text()); },
            close: async () => {},
          }),
        };
        const newDocumentHandle = {
          name: '새작업저장.kuasangse',
          createWritable: async () => ({
            write: async blob => { writes.newDocument.push(await blob.text()); },
            close: async () => {},
          }),
        };
        window.showSaveFilePicker = async () => {
          pickerCalls += 1;
          if (pickerCalls === 1) return initialHandle;
          if (pickerCalls === 2) return saveAsHandle;
          return newDocumentHandle;
        };
        document.getElementById('saveProjectFileAsBtn')?.click();
        await waitFor(
          () => (writes.initial.length === 1 && window.state.projectBusy === false)
            || (window.state.projectBusy === false && window.state.workfileSaveState === 'saved'),
          30000,
          'initial save',
        );
        if (writes.initial.length !== 1) {
          throw new Error('initial workfile replica write was skipped after a reported save');
        }
        document.getElementById('saveCurrentProjectFileBtn')?.click();
        await waitFor(
          () => currentWriteStarted && document.getElementById('workfileSaveStatus')?.textContent?.includes('현재 상태 저장 중'),
          30000,
          'current save start',
        );
        const savingText = document.getElementById('workfileSaveStatus')?.textContent?.trim() || '';
        releaseCurrentWrite();
        await waitFor(
          () => window.state.projectBusy === false && document.getElementById('workfileSaveStatus')?.textContent?.includes('저장 완료'),
          30000,
          'current save completion',
        );
        const currentSavedText = document.getElementById('workfileSaveStatus')?.textContent?.trim() || '';
        const pickerCallsAfterCurrentSave = pickerCalls;
        document.getElementById('saveProjectFileAsBtn')?.click();
        await waitFor(
          () => writes.saveAs.length === 1 && window.state.projectBusy === false && document.getElementById('workfileSaveStatus')?.textContent?.includes('저장 완료'),
          30000,
          'save as completion',
        );
        const savedText = document.getElementById('workfileSaveStatus')?.textContent?.trim() || '';
        await window.startNewProjectDraft();
        const newWorkStatusText = document.getElementById('workfileSaveStatus')?.textContent?.trim() || '';
        document.getElementById('saveCurrentProjectFileBtn')?.click();
        await waitFor(
          () => (writes.newDocument.length === 1 && window.state.projectBusy === false && document.getElementById('workfileSaveStatus')?.textContent?.includes('저장 완료'))
            || (window.state.projectBusy === false && ['saved', 'error'].includes(window.state.workfileSaveState)),
          30000,
          'new document save completion',
        );
        if (writes.newDocument.length !== 1) {
          throw new Error([
            'new document workfile write failed',
            window.state.workfileSaveState || 'unknown',
            window.state.storageWarning || '',
            document.getElementById('workfileSaveStatus')?.textContent?.trim() || '',
          ].join(' | '));
        }
        const newDocumentSavedText = document.getElementById('workfileSaveStatus')?.textContent?.trim() || '';
        const newDocumentWarning = window.state.storageWarning || '';
        const statusClass = document.getElementById('workfileSaveStatus')?.className || '';
        window.showSaveFilePicker = originalPicker;
        const parsePayload = value => {
          try { return JSON.parse(value).project?.payload || {}; } catch (_) { return {}; }
        };
        return {
          buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
          savingText,
          currentSavedText,
          savedText,
          statusClass,
          lastSavedAt: window.state.workfileLastSavedAt || null,
          projectBusy: window.state.projectBusy,
          buildLabel: document.getElementById('workfileBuildLabel')?.textContent?.trim() || '',
          pickerCalls,
          pickerCallsAfterCurrentSave,
          newWorkStatusText,
          newDocumentSavedText,
          newDocumentWarning,
          currentWriteCount: writes.current.length,
          saveAsWriteCount: writes.saveAs.length,
          newDocumentWriteCount: writes.newDocument.length,
          initialWriteCount,
          currentPayloadName: parsePayload(writes.current[0]).currentProjectName || '',
          saveAsPayloadName: parsePayload(writes.saveAs[0]).currentProjectName || '',
          currentJsonCompact: String(writes.current[0] || '').indexOf(String.fromCharCode(10)) === -1,
          saveAsJsonCompact: String(writes.saveAs[0] || '').indexOf(String.fromCharCode(10)) === -1,
        };
      })();
    })()`, true, 120000);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup();
  }
  const checks = [
    { ok: /현재 상태 저장 중/.test(proof.savingText), message: `현재 상태 저장 중 문구가 없습니다: ${proof.savingText}` },
    { ok: /저장 완료.*마지막 저장:/.test(proof.savedText), message: `저장 완료 시각 문구가 없습니다: ${proof.savedText}` },
    { ok: /saved/.test(proof.statusClass), message: `저장 완료 상태 스타일이 없습니다: ${proof.statusClass}` },
    { ok: Number(proof.lastSavedAt) > 0, message: '마지막 저장 시각이 상태에 기록되지 않았습니다.' },
    { ok: proof.projectBusy === false, message: '파일 저장 완료 뒤 projectBusy가 남아 있습니다.' },
    { ok: proof.pickerCallsAfterCurrentSave === 1 && proof.pickerCalls === 3, message: `현재 상태 저장에서 파일 선택기가 열렸거나 새 작업 저장에서 새 위치를 묻지 않았습니다: 현재 저장 뒤 ${proof.pickerCallsAfterCurrentSave}, 전체 ${proof.pickerCalls}` },
    { ok: proof.currentWriteCount === 1 && proof.saveAsWriteCount === 1 && proof.newDocumentWriteCount === 1 && proof.initialWriteCount === 2, message: `파일 쓰기 횟수가 맞지 않거나 새 작업이 이전 파일을 덮어썼습니다: ${JSON.stringify(proof)}` },
    { ok: proof.newWorkStatusText === '저장 전', message: `새 작업 뒤 이전 저장 완료 상태가 남았습니다: ${proof.newWorkStatusText}` },
    { ok: /저장 완료/.test(proof.newDocumentSavedText) && proof.newDocumentWarning === '', message: `새 작업파일 저장이 완료되지 않았거나 거짓 저장 경고가 남았습니다: ${proof.newDocumentSavedText} / ${proof.newDocumentWarning}` },
    { ok: proof.currentPayloadName === '현재상태저장' && proof.saveAsPayloadName === '다른이름저장', message: `실제 작업파일명이 payload의 단일 기준으로 보존되지 않았습니다: ${proof.currentPayloadName} / ${proof.saveAsPayloadName}` },
    { ok: proof.currentJsonCompact && proof.saveAsJsonCompact, message: '저장 파일이 압축 JSON으로 기록되지 않았습니다.' },
    { ok: /^빌드 v\d+$/.test(proof.buildLabel), message: `상단 빌드 표기가 없습니다: ${proof.buildLabel}` },
  ];
  fs.writeFileSync(RESULT_PATH, JSON.stringify({ ok: checks.every(check => check.ok), proof, checks, screenshotPath: SCREENSHOT_PATH }, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify({ ok: true, resultPath: RESULT_PATH, screenshotPath: SCREENSHOT_PATH, proof }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
