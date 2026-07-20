export function renderAutomationView(view = {}, helpers) {
  const {
    formatServerDriveMessage, renderModeEditor, renderPlacementPanel,
    makeDefaultProfile, disabledAttr, escapeHtml, escapeAttr,
  } = helpers;
  const a = view.automation;
  const connected = a.driveConnected;
  const savedClientId = view.savedClientId || '';
  const serverCfg = a.serverConfig;
  const serverDrive = serverCfg?.driveConnection || null;
  const serverDriveMessage = formatServerDriveMessage(serverDrive);
  const serverProfiles = serverCfg?.profiles || {
    'image-cuts': makeDefaultProfile('image-cuts'),
    'detail-page': makeDefaultProfile('detail-page')
  };
  const serverModeStatus = (a.serverStatus || serverCfg?.status || {}).byMode || {};
  const folderAutoBlocked = !a.inputFolderId || !a.outputFolderId;
  const folderAutoReason = '입력 폴더와 결과 출력 폴더를 먼저 지정해주세요.';

  return `<div class="fade-in">
    <h1 class="page-title">🔄 자동화 시스템</h1>
    <p class="page-desc">구글 드라이브 폴더를 연결하면 설정한 간격마다 자동으로 상세페이지를 생성합니다.</p>

    <div class="auto-card" style="border-color:var(--primary);margin-bottom:14px">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--primary)">hub</span> 서버 Drive 자동화 연결 (권장)</h3>
      <p style="font-size:12px;color:var(--text-d);margin-bottom:10px">
        로컬 앱 실행 시 자동화 API(기본: <code>http://127.0.0.1:4000/v1</code>)를 호출해 image-cuts/detail-page를 제어합니다. GitHub Pages 같은 HTTPS 배포에서는 HTTPS API 엔드포인트가 필요합니다.
      </p>
      <div class="input-group" style="margin-bottom:8px">
        <label class="label">자동화 API Base</label>
        <input class="input" id="serverAutoApiBase" value="${escapeAttr(a.serverApiBase)}" placeholder="http://127.0.0.1:4000/v1" style="font-family:monospace">
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" id="serverAutoRefreshBtn">${a.serverLoading ? '불러오는 중...' : '상태 불러오기'}</button>
        ${serverDrive ? `<span class="auto-status ${serverDrive.ready ? 'running' : 'stopped'}">${serverDrive.ready ? 'Drive 준비됨' : 'Drive 권한 필요'}</span>` : ''}
        ${serverDrive?.accountEmail ? `<span style="font-size:12px;color:var(--text-d)">${serverDrive.accountEmail}</span>` : ''}
      </div>
      ${a.serverError ? `<p style="font-size:12px;color:var(--err);margin-top:8px">${a.serverError}</p>` : ''}
      ${serverDriveMessage ? `<pre style="font-size:12px;color:${serverDrive?.ready ? 'var(--text-d)' : 'var(--warn)'};margin-top:8px;white-space:pre-wrap;line-height:1.45;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px">${escapeHtml(serverDriveMessage)}</pre>` : ''}
      ${!serverCfg && !a.serverLoading ? `<p style="font-size:12px;color:var(--text-m);margin-top:8px;padding:8px;background:var(--bg-input);border-radius:6px">⏳ API 서버 연결 대기 중 — 서버가 켜지면 자동으로 설정을 불러옵니다. 아래 프로파일은 기본값으로 표시됩니다.</p>` : ''}

      ${renderModeEditor('image-cuts', 'Image Cuts', serverProfiles['image-cuts'], serverModeStatus['image-cuts'])}
      ${renderModeEditor('detail-page', 'Detail Page', serverProfiles['detail-page'], serverModeStatus['detail-page'])}
    </div>

    ${renderPlacementPanel({
      title: '📌 자동화 출력 섹션 배치',
      desc: '자동화가 만든 출력 이미지와 현재 보관된 이미지컷/사이즈컷/색상옵션을 상세페이지 섹션에 바로 배치합니다.',
      emptyText: '자동화 출력 이미지를 불러오거나 이미지컷/옵션 결과를 만들면 여기서 섹션에 배치할 수 있습니다.'
    })}

    <!-- Drive Connection -->
    <div class="auto-card">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--primary)">cloud</span> Google Drive 연결
        ${connected ? '<span class="auto-status running">● 연결됨</span>' : '<span class="auto-status stopped">● 미연결</span>'}
      </h3>
      ${!connected ? `
        <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px">
          <p style="font-size:13px;color:var(--warn);font-weight:600;margin-bottom:8px">⚠️ 반드시 start.bat으로 실행하세요</p>
          <p style="font-size:12px;color:var(--text-d);margin-bottom:4px">Google OAuth는 <code style="background:var(--bg-card);padding:2px 6px;border-radius:4px;color:var(--cyan)">http://localhost:8081</code> 에서만 작동합니다.</p>
          <p style="font-size:11px;color:var(--text-m)">file:///로 열면 인증이 차단됩니다. start.bat 더블클릭 → 브라우저에서 localhost:8080 접속</p>
        </div>
        <p style="font-size:13px;color:var(--text-d);margin-bottom:12px">
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:var(--primary)">Google Cloud Console</a>에서 OAuth 2.0 Client ID를 발급 받으세요.
        </p>
        <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;font-size:12px;color:var(--text-d)">
          <p style="font-weight:600;margin-bottom:6px">📋 설정 방법:</p>
          <p>1. 유형: <strong>웹 애플리케이션</strong></p>
          <p>2. 승인된 JavaScript 원본 추가:</p>
          <code style="display:block;background:var(--bg-card);padding:8px 12px;border-radius:6px;margin:6px 0;color:var(--cyan);font-size:13px">http://localhost:8081</code>
          <p>3. Google Drive API 활성화 필요 (<a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" style="color:var(--primary)">여기서 활성화</a>)</p>
        </div>
        <div class="input-group" style="margin-bottom:12px">
          <label class="label">OAuth Client ID</label>
          <input type="text" class="input" id="gdClientId" value="${escapeAttr(savedClientId)}" placeholder="xxxx.apps.googleusercontent.com" style="font-size:12px;font-family:monospace">
        </div>
        <button class="btn-primary" id="connectDriveBtn">
          <span class="material-icons-outlined" style="font-size:18px">login</span>
          Google Drive 연결
        </button>
      ` : `
        <p style="font-size:13px;color:var(--ok)">✅ Google Drive가 연결되었습니다.</p>
      `}
    </div>

    ${connected ? `
    <!-- Folder Settings -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="auto-card">
        <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--orange)">folder_open</span> 입력 폴더 (제품 이미지)</h3>
        <div class="input-group" style="margin-bottom:8px">
          <label class="label">Google Drive 폴더 ID</label>
          <input type="text" class="input" id="inputFolderId" value="${a.inputFolderId}" placeholder="폴더 URL 전체 또는 ID 붙여넣기" style="font-size:12px;font-family:monospace">
        </div>
        ${a.inputFolderName ? `<p style="font-size:12px;color:var(--ok)">📁 ${a.inputFolderName}</p>` : ''}
        <button class="btn-sm" id="setInputFolder" style="margin-top:4px">
          <span class="material-icons-outlined" style="font-size:14px">check</span> 폴더 설정
        </button>
        <p style="font-size:11px;color:var(--text-m);margin-top:8px">
          💡 드라이브 폴더 열고 URL에서 <code>folders/</code> 뒤의 문자열이 ID입니다
        </p>
      </div>

      <div class="auto-card">
        <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--cyan)">drive_file_move</span> 출력 폴더 (상세페이지)</h3>
        <div class="input-group" style="margin-bottom:8px">
          <label class="label">Google Drive 폴더 ID</label>
          <input type="text" class="input" id="outputFolderId" value="${a.outputFolderId}" placeholder="폴더 URL 전체 또는 ID 붙여넣기" style="font-size:12px;font-family:monospace">
        </div>
        ${a.outputFolderName ? `<p style="font-size:12px;color:var(--ok)">📁 ${a.outputFolderName}</p>` : ''}
        <button class="btn-sm" id="setOutputFolder" style="margin-top:4px">
          <span class="material-icons-outlined" style="font-size:14px">check</span> 폴더 설정
        </button>
      </div>
    </div>

    <!-- Interval & Control -->
    <div class="auto-card">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--warn)">timer</span> 실행 간격</h3>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
        <input type="range" min="5" max="60" step="5" value="${a.intervalMin}" class="interval-slider" id="intervalSlider">
        <span style="font-size:24px;font-weight:700;color:var(--primary);min-width:60px;text-align:center" id="intervalDisplay">${a.intervalMin}분</span>
      </div>
      <p style="font-size:12px;color:var(--text-m)">입력 폴더에서 아직 처리 안 된 이미지를 1장씩 가져와 15섹션 상세페이지를 생성 후 출력 폴더에 저장합니다.</p>

      <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
        ${!a.running ? `
          <button class="btn-primary" id="startAutoBtn" ${disabledAttr(folderAutoBlocked, folderAutoReason)}>
            <span class="material-icons-outlined" style="font-size:18px">play_arrow</span>
            폴더 자동화 시작
          </button>
        ` : `
          <button class="btn-primary" id="stopAutoBtn" style="background:var(--err)">
            <span class="material-icons-outlined" style="font-size:18px">stop</span>
            자동화 중지
          </button>
        `}
        <button class="btn-sm" id="runOnceBtn" ${disabledAttr(folderAutoBlocked || a.running, a.running ? '자동화 실행 중에는 1회 실행을 시작할 수 없습니다.' : folderAutoReason)} style="padding:10px 16px">
          <span class="material-icons-outlined" style="font-size:16px">play_circle</span>
          폴더 1회 즉시 실행
        </button>
        <button class="btn-sm" id="resetProcessedBtn" style="padding:10px 16px">
          <span class="material-icons-outlined" style="font-size:16px">restart_alt</span>
          처리기록 초기화
        </button>
        ${a.running ? `<span class="auto-status running" style="margin-left:auto">● 작동 중 ${a.nextRunAt ? '| 다음 실행: '+a.nextRunAt : ''}</span>` : ''}
      </div>
    </div>

    <!-- Current Processing -->
    ${a.currentItem ? `
    <div class="auto-card" style="border-color:var(--warn)">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--warn)">hourglass_top</span> 현재 처리 중</h3>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:13px;font-weight:600">${a.currentItem.name}</span>
        <span style="font-size:12px;color:var(--text-m)">${a.currentMsg}</span>
      </div>
      <div class="progress-outer" style="max-width:100%"><div class="progress-inner" style="width:${a.currentProgress}%">${a.currentProgress}%</div></div>
    </div>
    ` : ''}

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      <div class="auto-card" style="text-align:center">
        <div style="font-size:32px;font-weight:900;color:var(--primary)">${a.totalProcessed}</div>
        <div style="font-size:12px;color:var(--text-d)">총 처리 완료</div>
      </div>
      <div class="auto-card" style="text-align:center">
        <div style="font-size:32px;font-weight:900;color:var(--warn)">${a.queue.length}</div>
        <div style="font-size:12px;color:var(--text-d)">대기 중</div>
      </div>
      <div class="auto-card" style="text-align:center">
        <div style="font-size:32px;font-weight:900;color:var(--ok)">${a.processedFileIds.size}</div>
        <div style="font-size:12px;color:var(--text-d)">누적 처리 (스킵)</div>
      </div>
    </div>

    <!-- Recent Completed -->
    ${a.completed.length ? `
    <div class="auto-card">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--ok)">check_circle</span> 최근 완료</h3>
      ${a.completed.slice(0, 10).map(c => `
        <div class="queue-item">
          <div class="q-status ${c.error?'error':'done'}"></div>
          <span style="flex:1">${c.name}</span>
          <span style="font-size:11px;color:var(--text-m)">${c.finishedAt || ''}</span>
          ${c.error ? `<span style="font-size:11px;color:var(--err)">${c.error}</span>` : '<span style="font-size:11px;color:var(--ok)">✅ 완료</span>'}
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Log -->
    <div class="auto-card">
      <h3><span class="material-icons-outlined" style="font-size:20px;color:var(--text-d)">terminal</span> 로그</h3>
      <div class="log-box" id="autoLogBox">
        ${view.logs.length === 0 ? '<div class="log-line" style="color:var(--text-m)">아직 로그가 없습니다.</div>' : ''}
        ${view.logs.slice(0, 50).map(l => `<div class="log-line ${l.type}">[${l.time}] ${l.msg}</div>`).join('')}
      </div>
    </div>
    ` : `
    <div class="auto-card" style="text-align:center;padding:40px">
      <span class="material-icons-outlined" style="font-size:48px;color:var(--text-m);margin-bottom:12px">cloud_off</span>
      <p style="color:var(--text-d)">Google Drive를 먼저 연결하세요.</p>
    </div>
    `}
  </div>`;
}
