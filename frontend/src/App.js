import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '/api';
const PDP_SYNC_QUEUE_KEY = 'kuasangse_pdp_sync_queue_v1';

// ─── Section Icons ─────────────────────────────────────────────
const SECTION_ICONS = {
  header: '🎯', hook: '🪝', key_features: '⭐', specifications: '📐',
  use_scenarios: '🏠', competitive_edge: '🏆', material_tech: '🔬',
  certifications: '🏅', reviews: '💬', size_color: '🎨',
  promotion: '🎁', shipping: '📦', faq: '❓', brand_story: '📖', cta_footer: '🛒',
};

// ─── API Helpers ────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API Error');
  }
  return res.json();
}

async function apiUpload(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload Error');
  }
  return res.json();
}

function normalizeSinhwaJcode(value) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function buildPdpSyncPayload(projectId, projectData) {
  const entries = Object.entries(projectData?.sections || {});
  return {
    idempotencyKey: `automation:${projectId}:output`,
    sections: entries.map(([sectionKey, section], sortOrder) => ({
      idempotencyKey: `automation:${projectId}:section:${sectionKey}`,
      payload: {
        sectionKey,
        sectionType: sectionKey,
        title: section?.content?.headline || sectionKey,
        copyText: section?.content?.body_text || null,
        structuredData: section?.content || {},
        sortOrder,
      },
    })),
    composition: {
      payload: {
        name: `자동화 결과 ${projectId}`,
        sectionOrder: entries.map(([sectionKey]) => sectionKey),
        stitchedDetailAssetId: null,
      },
    },
  };
}

function readPdpSyncQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PDP_SYNC_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePdpSyncQueue(entries) {
  localStorage.setItem(PDP_SYNC_QUEUE_KEY, JSON.stringify(entries));
}

function enqueuePdpSync(jcode, payload, projectId) {
  const entries = readPdpSyncQueue();
  const next = entries.filter(entry => entry.idempotencyKey !== payload.idempotencyKey);
  next.push({
    jcode,
    projectId,
    idempotencyKey: payload.idempotencyKey,
    payload,
    queuedAt: new Date().toISOString(),
  });
  writePdpSyncQueue(next);
  return next.length;
}

async function replayPdpSyncQueue() {
  const entries = readPdpSyncQueue();
  if (!entries.length) return { attempted: false, remaining: 0 };
  const remaining = [];
  let attempted = false;
  for (const entry of entries) {
    attempted = true;
    try {
      await api(`/sinhwa-pdp/products/${entry.jcode}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      });
    } catch {
      remaining.push(entry);
    }
  }
  writePdpSyncQueue(remaining);
  return { attempted, remaining: remaining.length };
}

// ─── Main App ───────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState('upload'); // upload | analyzing | sections | generating | preview
  const [projectId, setProjectId] = useState(null);
  const [productName, setProductName] = useState('');
  const [sinhwaJcode, setSinhwaJcode] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [competitorData, setCompetitorData] = useState(null);
  const [sections, setSections] = useState([]);
  const [sectionInstructions, setSectionInstructions] = useState({});
  const [projectData, setProjectData] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [pdpSaveState, setPdpSaveState] = useState('not-configured');
  const [activeSectionEdit, setActiveSectionEdit] = useState(null);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  // Load section definitions
  useEffect(() => {
    api('/sections').then(setSections).catch(() => {});
    replayPdpSyncQueue().catch(() => {});
  }, []);

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Handle drag & drop
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Poll project status
  const startPolling = useCallback((pid, jcode) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await api(`/projects/${pid}`);
        setProgress(data.progress);
        setProgressMsg(data.progress_message);
        if (data.status === 'completed' || data.status === 'error') {
          clearInterval(pollRef.current);
          if (data.status === 'completed') {
            const full = await api(`/projects/${pid}/full`);
            if (jcode) {
              try {
                setPdpSaveState('saving');
                const syncPayload = buildPdpSyncPayload(pid, full);
                await api(`/sinhwa-pdp/products/${jcode}/sync`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(syncPayload),
                });
                setPdpSaveState('authoritative');
              } catch {
                try { enqueuePdpSync(jcode, buildPdpSyncPayload(pid, full), pid); } catch { }
                setPdpSaveState('local-fallback');
              }
            }
            setProjectData(full);
            setStep('preview');
          }
        }
      } catch { }
    }, 2000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Upload & Start Analysis ──────────────────────────────────
  const handleStartProject = async () => {
    if (!imageFile) { setError('제품 이미지를 업로드해주세요.'); return; }
    setError('');
    setStep('analyzing');
    setProgress(5);
    setProgressMsg('프로젝트 생성 중...');

    try {
      // 1. Create project
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('product_name', productName);
      const proj = await apiUpload('/projects', formData);
      setProjectId(proj.project_id);

      const normalizedJcode = normalizeSinhwaJcode(sinhwaJcode);
      if (normalizedJcode) {
        setPdpSaveState('loading');
        try {
          const context = await api(`/sinhwa-pdp/products/${normalizedJcode}/context`);
          setAnalysis(current => ({ ...(current || {}), sinhwa_pdp: context }));
          setPdpSaveState('local-only');
        } catch {
          setPdpSaveState('local-fallback');
        }
      } else {
        setPdpSaveState('not-configured');
      }

      // 2. Analyze
      setProgressMsg('제품 이미지 AI 분석 중...');
      setProgress(10);
      const analysisRes = await api(`/projects/${proj.project_id}/analyze`, { method: 'POST' });
      setAnalysis(current => ({ ...(current || {}), ...analysisRes.analysis }));
      setProgress(25);

      // 3. Competitor search
      setProgressMsg('유사 제품 검색 중...');
      const compRes = await api(`/projects/${proj.project_id}/search-competitors`, { method: 'POST' });
      setCompetitorData(compRes.competitor_data);
      setProgress(35);

      setStep('sections');
      setProgressMsg('분석 완료! 섹션별 지시사항을 입력하세요.');
    } catch (e) {
      setError(e.message);
      setStep('upload');
    }
  };

  // ── Generate All Sections ─────────────────────────────────────
  const handleGenerateAll = async () => {
    setStep('generating');
    setProgress(35);
    setProgressMsg('15개 섹션 생성 시작...');

    try {
      await api(`/projects/${projectId}/generate-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section_instructions: sectionInstructions }),
      });
      startPolling(projectId, normalizeSinhwaJcode(sinhwaJcode));
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Generate Single Section ───────────────────────────────────
  const handleGenerateSection = async (sectionId) => {
    setProgressMsg(`${sectionId} 섹션 생성 중...`);
    try {
      const content = await api(`/projects/${projectId}/sections/${sectionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_instructions: sectionInstructions[sectionId] || '' }),
      });

      // Also generate image
      await api(`/projects/${projectId}/sections/${sectionId}/generate-image`, { method: 'POST' });

      // Refresh project data
      const full = await api(`/projects/${projectId}/full`);
      setProjectData(full);
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Export HTML ───────────────────────────────────────────────
  const handleExportHTML = () => {
    window.open(`${API_BASE}/projects/${projectId}/export-html`, '_blank');
  };

  // ── Render Sections ───────────────────────────────────────────
  return (
    <div style={styles.app}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>✦</span>
          <span style={styles.logoText}>상세페이지<br/><small style={{fontWeight:400,fontSize:12,color:'var(--text-dim)'}}>Auto Generator</small></span>
        </div>
        <nav style={styles.nav}>
          <NavItem icon="upload_file" label="이미지 업로드" active={step === 'upload'} onClick={() => step !== 'generating' && setStep('upload')} />
          <NavItem icon="analytics" label="AI 분석" active={step === 'analyzing'} disabled={!projectId} />
          <NavItem icon="dashboard_customize" label="섹션 설정" active={step === 'sections'} onClick={() => analysis && setStep('sections')} disabled={!analysis} />
          <NavItem icon="auto_fix_high" label="자동 생성" active={step === 'generating'} disabled={!analysis} />
          <NavItem icon="preview" label="미리보기" active={step === 'preview'} onClick={() => projectData && setStep('preview')} disabled={!projectData} />
        </nav>
        {projectId && (
          <div style={styles.projectInfo}>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>프로젝트</div>
            <div style={{fontSize:13,color:'var(--text-dim)',fontFamily:'monospace'}}>{projectId}</div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main style={styles.main}>
        {error && <ErrorBar message={error} onClose={() => setError('')} />}

        {step === 'upload' && (
          <UploadStep
            imagePreview={imagePreview}
            sinhwaJcode={sinhwaJcode}
            onSinhwaJcodeChange={setSinhwaJcode}
            productName={productName}
            onProductNameChange={setProductName}
            onFileSelect={handleFileSelect}
            onDrop={handleDrop}
            onStart={handleStartProject}
            fileInputRef={fileInputRef}
          />
        )}

        {step === 'analyzing' && (
          <AnalyzingStep progress={progress} message={progressMsg} />
        )}

        {step === 'sections' && (
          <SectionsStep
            sections={sections}
            analysis={analysis}
            competitorData={competitorData}
            sectionInstructions={sectionInstructions}
            onInstructionChange={(id, val) => setSectionInstructions(prev => ({...prev, [id]: val}))}
            onGenerateAll={handleGenerateAll}
            activeSectionEdit={activeSectionEdit}
            setActiveSectionEdit={setActiveSectionEdit}
            imagePreview={imagePreview}
          />
        )}

        {step === 'generating' && (
          <GeneratingStep progress={progress} message={progressMsg} />
        )}

        {step === 'preview' && (
          <PreviewStep
            projectData={projectData}
            projectId={projectId}
            sections={sections}
            sectionInstructions={sectionInstructions}
            onRegenerateSection={handleGenerateSection}
            onExportHTML={handleExportHTML}
            onInstructionChange={(id, val) => setSectionInstructions(prev => ({...prev, [id]: val}))}
            pdpSaveState={pdpSaveState}
          />
        )}
      </main>
    </div>
  );
}

// ─── Upload Step ────────────────────────────────────────────────
function UploadStep({ imagePreview, productName, onProductNameChange, sinhwaJcode, onSinhwaJcodeChange, onFileSelect, onDrop, onStart, fileInputRef }) {
  return (
    <div style={styles.stepContainer} className="fade-in">
      <h1 style={styles.pageTitle}>상세페이지 자동 생성</h1>
      <p style={styles.pageDesc}>제품 이미지를 업로드하면 AI가 분석하여 15개 섹션의 상세페이지를 자동으로 생성합니다.</p>

      <div style={styles.uploadArea}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}>
        {imagePreview ? (
          <img src={imagePreview} alt="preview" style={styles.previewImg} />
        ) : (
          <div style={styles.uploadPlaceholder}>
            <span className="material-icons-outlined" style={{fontSize:48,color:'var(--primary)',marginBottom:12}}>cloud_upload</span>
            <p style={{fontSize:16,fontWeight:500}}>클릭 또는 드래그하여 이미지 업로드</p>
            <p style={{fontSize:13,color:'var(--text-muted)',marginTop:6}}>JPG, PNG, WEBP 지원 (최대 50MB)</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileSelect} style={{display:'none'}} />
      </div>

      <div style={styles.inputGroup}>
        <label style={styles.label}>제품명 (선택사항)</label>
        <input
          type="text"
          value={productName}
          onChange={e => onProductNameChange(e.target.value)}
          placeholder="AI가 자동 감지하지만, 직접 입력하면 더 정확합니다"
          style={styles.input}
        />
      </div>

      <div style={styles.inputGroup}>
        <label style={styles.label}>신화사 제품코드 (선택사항)</label>
        <input
          type="text"
          inputMode="numeric"
          value={sinhwaJcode}
          onChange={e => onSinhwaJcodeChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="예: 920001, 입력하면 기존 자산과 결과를 연결합니다"
          style={styles.input}
        />
      </div>

      <button onClick={onStart} style={styles.primaryBtn} disabled={!imagePreview}>
        <span className="material-icons-outlined" style={{fontSize:20,marginRight:8}}>auto_fix_high</span>
        AI 분석 시작
      </button>

      <div style={styles.featureGrid}>
        <FeatureCard icon="visibility" title="이미지 분석" desc="Gemini AI가 제품 특징을 자동 분석" />
        <FeatureCard icon="search" title="경쟁 분석" desc="유사 제품의 상세페이지 참조 검색" />
        <FeatureCard icon="dashboard" title="15섹션 자동생성" desc="헤더부터 CTA까지 풀 상세페이지" />
        <FeatureCard icon="image" title="이미지 생성" desc="각 섹션에 맞는 이미지 AI 생성" />
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }) {
  return (
    <div style={styles.featureCard}>
      <span className="material-icons-outlined" style={{fontSize:28,color:'var(--primary)',marginBottom:8}}>{icon}</span>
      <div style={{fontWeight:600,fontSize:14,marginBottom:4}}>{title}</div>
      <div style={{fontSize:12,color:'var(--text-dim)'}}>{desc}</div>
    </div>
  );
}

// ─── Analyzing Step ─────────────────────────────────────────────
function AnalyzingStep({ progress, message }) {
  return (
    <div style={{...styles.stepContainer, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'60vh'}}>
      <div style={styles.spinner} />
      <h2 style={{fontSize:22,marginTop:24,marginBottom:8}}>AI 분석 진행 중</h2>
      <p style={{color:'var(--text-dim)',marginBottom:24}}>{message}</p>
      <ProgressBar value={progress} />
    </div>
  );
}

// ─── Sections Step ──────────────────────────────────────────────
function SectionsStep({ sections, analysis, competitorData, sectionInstructions, onInstructionChange, onGenerateAll, activeSectionEdit, setActiveSectionEdit, imagePreview }) {
  return (
    <div style={styles.stepContainer} className="fade-in">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={styles.pageTitle}>섹션별 설정</h1>
          <p style={styles.pageDesc}>각 섹션에 원하는 지시사항을 입력하세요. 비워두면 AI가 자동으로 최적의 콘텐츠를 생성합니다.</p>
        </div>
        <button onClick={onGenerateAll} style={styles.primaryBtn}>
          <span className="material-icons-outlined" style={{fontSize:20,marginRight:8}}>rocket_launch</span>
          전체 생성 시작
        </button>
      </div>

      {/* Analysis Summary */}
      {analysis && (
        <div style={styles.analysisSummary}>
          <div style={{display:'flex',gap:20,alignItems:'center'}}>
            {imagePreview && <img src={imagePreview} alt="product" style={{width:80,height:80,objectFit:'cover',borderRadius:10,border:'1px solid var(--border)'}} />}
            <div>
              <h3 style={{fontSize:18,fontWeight:700}}>{analysis.product_name || '분석된 제품'}</h3>
              <p style={{fontSize:13,color:'var(--text-dim)',marginTop:4}}>{analysis.category} | {analysis.mood}</p>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                {(analysis.key_features || []).slice(0, 4).map((f, i) => (
                  <span key={i} style={styles.tag}>{f}</span>
                ))}
              </div>
            </div>
          </div>
          {competitorData?.market_summary && (
            <div style={{marginTop:16,padding:'12px 16px',background:'var(--bg-dark)',borderRadius:8,fontSize:13}}>
              <span style={{color:'var(--text-muted)'}}>경쟁 분석:</span>{' '}
              <span style={{color:'var(--accent-cyan)'}}>
                {competitorData.market_summary.total_competitors_found}개 유사 제품 발견
              </span>
              {competitorData.market_summary.price_range !== 'N/A' && (
                <> | 가격대 {competitorData.market_summary.price_range}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section Cards */}
      <div style={styles.sectionGrid}>
        {sections.map(s => (
          <div key={s.section_id} style={styles.sectionCard}
            onClick={() => setActiveSectionEdit(activeSectionEdit === s.section_id ? null : s.section_id)}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <span style={{fontSize:28}}>{SECTION_ICONS[s.section_id] || '📄'}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:14}}>{s.section_number}. {s.section_name}</div>
                <div style={{fontSize:12,color:'var(--text-dim)',marginTop:2}}>{s.description}</div>
              </div>
              <span className="material-icons-outlined" style={{color:'var(--text-muted)',fontSize:20}}>
                {activeSectionEdit === s.section_id ? 'expand_less' : 'expand_more'}
              </span>
            </div>
            {activeSectionEdit === s.section_id && (
              <div style={{marginTop:12}} onClick={e => e.stopPropagation()}>
                <textarea
                  value={sectionInstructions[s.section_id] || ''}
                  onChange={e => onInstructionChange(s.section_id, e.target.value)}
                  placeholder={`이 섹션에 원하는 내용을 입력하세요...\n예: "${s.purpose}"`}
                  style={styles.textarea}
                  rows={3}
                />
              </div>
            )}
            {sectionInstructions[s.section_id] && activeSectionEdit !== s.section_id && (
              <div style={{marginTop:8,padding:'6px 10px',background:'var(--primary-dim)',borderRadius:6,fontSize:12,color:'var(--primary-hover)'}}>
                ✎ 커스텀 지시사항 입력됨
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{textAlign:'center',marginTop:32}}>
        <button onClick={onGenerateAll} style={{...styles.primaryBtn, padding:'16px 48px', fontSize:16}}>
          <span className="material-icons-outlined" style={{fontSize:22,marginRight:8}}>rocket_launch</span>
          15개 섹션 일괄 생성 시작
        </button>
      </div>
    </div>
  );
}

// ─── Generating Step ────────────────────────────────────────────
function GeneratingStep({ progress, message }) {
  return (
    <div style={{...styles.stepContainer, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'70vh'}}>
      <div style={styles.spinnerLarge} />
      <h2 style={{fontSize:24,marginTop:32,marginBottom:8}}>상세페이지 생성 중</h2>
      <p style={{color:'var(--text-dim)',marginBottom:24,textAlign:'center'}}>{message}</p>
      <ProgressBar value={progress} />
      <p style={{fontSize:12,color:'var(--text-muted)',marginTop:16}}>
        15개 섹션 × (콘텐츠 + 이미지) 생성 중 — Gemini API 호출 중
      </p>

      <div style={{marginTop:40,display:'grid',gridTemplateColumns:'repeat(5, 1fr)',gap:8}}>
        {Object.entries(SECTION_ICONS).map(([id, icon], i) => (
          <div key={id} style={{
            width:48, height:48, display:'flex', alignItems:'center', justifyContent:'center',
            background: progress > (35 + (i / 15) * 60) ? 'var(--primary-dim)' : 'var(--bg-card)',
            borderRadius:10, fontSize:22,
            border: `1px solid ${progress > (35 + (i / 15) * 60) ? 'var(--primary)' : 'var(--border)'}`,
            transition: 'all 0.3s ease',
          }}>
            {icon}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Preview Step ───────────────────────────────────────────────
function PreviewStep({ projectData, projectId, sections, sectionInstructions, onRegenerateSection, onExportHTML, onInstructionChange, pdpSaveState }) {
  const [editingSection, setEditingSection] = useState(null);
  const [regeneratingSection, setRegeneratingSection] = useState(null);

  if (!projectData) return null;

  const handleRegenerate = async (sectionId) => {
    setRegeneratingSection(sectionId);
    await onRegenerateSection(sectionId);
    setRegeneratingSection(null);
  };

  return (
    <div style={styles.stepContainer} className="fade-in">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={styles.pageTitle}>상세페이지 미리보기</h1>
          <p style={styles.pageDesc}>생성된 상세페이지를 확인하고 개별 섹션을 수정할 수 있습니다.</p>
        </div>
        <div style={{fontSize:12,color:pdpSaveState === 'authoritative' ? 'var(--ok)' : 'var(--text-dim)'}}>
          신화사 DB 저장 상태: {pdpSaveState === 'authoritative' ? '기준 저장 완료' : pdpSaveState === 'local-fallback' ? '로컬 안전망 보관' : pdpSaveState === 'saving' ? '저장 중' : '제품코드 연결 전'}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onExportHTML} style={styles.primaryBtn}>
            <span className="material-icons-outlined" style={{fontSize:18,marginRight:6}}>download</span>
            HTML 내보내기
          </button>
        </div>
      </div>

      {/* Preview Container */}
      <div style={styles.previewContainer}>
        {sections.map(sectionDef => {
          const sid = sectionDef.section_id;
          const sectionData = projectData.sections?.[sid];
          const content = sectionData?.content || {};
          const colors = content.color_scheme || {};
          const imageUrl = sectionData?.image_url;
          const isEditing = editingSection === sid;
          const isRegenerating = regeneratingSection === sid;

          return (
            <div key={sid} style={{position:'relative',marginBottom:2}}>
              {/* Section Control Bar */}
              <div style={styles.sectionControlBar}>
                <span style={{fontSize:16}}>{SECTION_ICONS[sid]}</span>
                <span style={{fontWeight:600,fontSize:13}}>{sectionDef.section_number}. {sectionDef.section_name}</span>
                <div style={{flex:1}} />
                <button style={styles.smallBtn} onClick={() => setEditingSection(isEditing ? null : sid)}>
                  <span className="material-icons-outlined" style={{fontSize:16}}>edit</span>
                  수정
                </button>
                <button style={styles.smallBtn} onClick={() => handleRegenerate(sid)} disabled={isRegenerating}>
                  <span className="material-icons-outlined" style={{fontSize:16, animation: isRegenerating ? 'spin 1s linear infinite' : 'none'}}>
                    {isRegenerating ? 'hourglass_empty' : 'refresh'}
                  </span>
                  재생성
                </button>
              </div>

              {/* Edit Panel */}
              {isEditing && (
                <div style={styles.editPanel}>
                  <textarea
                    value={sectionInstructions[sid] || ''}
                    onChange={e => onInstructionChange(sid, e.target.value)}
                    placeholder="이 섹션에 대한 수정 지시사항..."
                    style={{...styles.textarea, marginBottom:8}}
                    rows={2}
                  />
                  <button style={styles.smallBtn} onClick={() => { handleRegenerate(sid); setEditingSection(null); }}>
                    지시사항 적용 후 재생성
                  </button>
                </div>
              )}

              {/* Section Preview */}
              <div style={{
                background: colors.background || '#FFFFFF',
                padding: '48px 20px',
                textAlign: 'center',
              }}>
                <div style={{maxWidth:860,margin:'0 auto'}}>
                  <h2 style={{
                    fontSize: content.font_suggestion?.headline_size || '36px',
                    color: colors.text_primary || '#333',
                    fontWeight: 700,
                    marginBottom: 10,
                  }}>
                    {content.headline || `[${sectionDef.section_name}]`}
                  </h2>
                  <h3 style={{
                    fontSize: 18,
                    color: colors.text_secondary || '#666',
                    fontWeight: 400,
                    marginBottom: 20,
                  }}>
                    {content.subheadline || ''}
                  </h3>
                  {imageUrl && (
                    <img src={imageUrl} alt={sectionDef.section_name}
                      style={{maxWidth:'100%',borderRadius:12,marginBottom:20}} />
                  )}
                  <p style={{
                    fontSize: content.font_suggestion?.body_size || '16px',
                    color: colors.text_secondary || '#666',
                    lineHeight: 1.8,
                    maxWidth: 680,
                    margin: '0 auto',
                  }}>
                    {content.body_text || ''}
                  </p>
                  {content.cta_text && (
                    <div style={{
                      display:'inline-block', marginTop:20, padding:'12px 36px',
                      background: colors.accent || '#6366f1', color:'#fff',
                      borderRadius:8, fontWeight:600, fontSize:16,
                    }}>
                      {content.cta_text}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────
function ProgressBar({ value }) {
  return (
    <div style={styles.progressBarOuter}>
      <div style={{...styles.progressBarInner, width: `${value}%`}}>
        <span style={{fontSize:11,fontWeight:600}}>{value}%</span>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, disabled, onClick }) {
  return (
    <div
      style={{
        ...styles.navItem,
        ...(active ? styles.navItemActive : {}),
        ...(disabled ? styles.navItemDisabled : {}),
      }}
      onClick={!disabled ? onClick : undefined}
    >
      <span className="material-icons-outlined" style={{fontSize:20}}>{icon}</span>
      <span style={{fontSize:13}}>{label}</span>
    </div>
  );
}

function ErrorBar({ message, onClose }) {
  return (
    <div style={styles.errorBar}>
      <span className="material-icons-outlined" style={{fontSize:18}}>error_outline</span>
      <span style={{flex:1}}>{message}</span>
      <span className="material-icons-outlined" style={{fontSize:18,cursor:'pointer'}} onClick={onClose}>close</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const styles = {
  app: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220, background: 'var(--bg-card)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', padding: '0', flexShrink: 0,
    position: 'sticky', top: 0, height: '100vh',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '20px 16px',
    borderBottom: '1px solid var(--border)',
  },
  logoIcon: { fontSize: 28, color: 'var(--primary)', fontWeight: 900 },
  logoText: { fontWeight: 700, fontSize: 15, lineHeight: 1.3 },
  nav: { padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s ease',
    color: 'var(--text-dim)',
  },
  navItemActive: {
    background: 'var(--primary-dim)', color: 'var(--primary-hover)',
  },
  navItemDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  projectInfo: {
    padding: '12px 16px', borderTop: '1px solid var(--border)',
  },
  main: { flex: 1, minWidth: 0, padding: '24px 32px', overflowY: 'auto' },
  stepContainer: { maxWidth: 1100, margin: '0 auto' },
  pageTitle: { fontSize: 26, fontWeight: 800, marginBottom: 6 },
  pageDesc: { fontSize: 14, color: 'var(--text-dim)', marginBottom: 24 },

  uploadArea: {
    border: '2px dashed var(--border)', borderRadius: 16, padding: 40,
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s ease',
    background: 'var(--bg-card)', marginBottom: 24, minHeight: 240,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  uploadPlaceholder: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  previewImg: { maxHeight: 300, maxWidth: '100%', borderRadius: 12, objectFit: 'contain' },

  inputGroup: { marginBottom: 20 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--text-dim)' },
  input: {
    width: '100%', padding: '10px 14px', background: 'var(--bg-input)',
    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
    fontSize: 14, outline: 'none', transition: 'border 0.2s',
  },
  textarea: {
    width: '100%', padding: '10px 14px', background: 'var(--bg-input)',
    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
    fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
    lineHeight: 1.5,
  },

  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', padding: '12px 28px',
    background: 'var(--primary)', color: '#fff', border: 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    transition: 'all 0.15s ease', fontFamily: 'inherit',
  },
  smallBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    background: 'var(--bg-card)', color: 'var(--text-dim)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  featureGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 40,
  },
  featureCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 20, textAlign: 'center',
  },

  analysisSummary: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 20, marginBottom: 24,
  },
  tag: {
    display: 'inline-block', padding: '3px 10px', background: 'var(--primary-dim)',
    color: 'var(--primary-hover)', borderRadius: 20, fontSize: 11, fontWeight: 500,
  },

  sectionGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10,
  },
  sectionCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s ease',
  },

  previewContainer: {
    background: '#fff', borderRadius: 12, overflow: 'hidden',
    border: '1px solid var(--border)',
  },
  sectionControlBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
    background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
  },
  editPanel: {
    padding: '12px 16px', background: 'var(--bg-dark)',
    borderBottom: '1px solid var(--border)',
  },

  progressBarOuter: {
    width: '100%', maxWidth: 400, height: 24, background: 'var(--bg-card)',
    borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)',
  },
  progressBarInner: {
    height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--accent-cyan))',
    borderRadius: 12, transition: 'width 0.5s ease',
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
    minWidth: 40,
  },

  spinner: {
    width: 40, height: 40, border: '3px solid var(--border)',
    borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },
  spinnerLarge: {
    width: 64, height: 64, border: '4px solid var(--border)',
    borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },

  errorBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8, color: 'var(--error)', fontSize: 13, marginBottom: 16,
  },
};
