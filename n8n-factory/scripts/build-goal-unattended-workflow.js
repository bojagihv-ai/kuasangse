/**
 * Build workflows/11-goal-factory-unattended.json from decision-policy.json
 * Unattended: Manual Trigger → policy bus → same auto steps as HITL, Wait replaced by Policy Code.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'goal', 'decision-policy.json'), 'utf8'));

const backendBase = policy.backendBase || 'http://127.0.0.1:5050';
const apiHubBase = policy.apiHubBase || 'http://127.0.0.1:4321';
// Docker n8n on Windows often needs host.docker.internal to reach host services
const backendForDocker = backendBase.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
const apiHubForDocker = apiHubBase.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
const imageUrl = (policy.imageUrl || '').replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');

function code(id, name, x, y, jsCode, notes = '') {
  return {
    parameters: { jsCode },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [x, y],
    notes,
  };
}
function exec(id, name, wfId, x, y, notes = '') {
  return {
    parameters: {
      source: 'database',
      workflowId: { __rl: true, value: wfId, mode: 'id' },
      options: { waitForSubWorkflow: true },
    },
    id,
    name,
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [x, y],
    notes,
  };
}
function httpGet(id, name, urlExpr, x, y) {
  return {
    parameters: {
      url: urlExpr,
      options: { timeout: 120000 },
    },
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [x, y],
  };
}

const loadPolicyCode = `// Embedded decision-policy (goal unattended)
const policy = ${JSON.stringify(policy, null, 2)};
const backendBase = ${JSON.stringify(backendForDocker)};
const apiHubBase = ${JSON.stringify(apiHubForDocker)};
const imageUrl = ${JSON.stringify(imageUrl)};
const productName = String(policy.productName || '').trim();
if (!productName) throw new Error('policy.productName 필수');
if (!imageUrl) throw new Error('policy.imageUrl 필수 — goal/decision-policy.json 확인');
return [{
  json: {
    goalMode: true,
    backendBase,
    apiHubBase,
    productName,
    imageUrl,
    query: productName,
    autoApplyTopDb: !!policy.autoApplyTopDb,
    sinhwaIndex: Number(policy.sinhwaIndex ?? 0),
    cafe24Index: Number(policy.cafe24Index ?? 0),
    selectedVmIndexes: String(policy.selectedVmIndexes || '0'),
    vmTopK: Number(policy.vmTopK || 2),
    fieldDefaults: policy.fieldDefaults || {},
    assetSelect: policy.assetSelect || { mode: 'all_images' },
    approveDetail: policy.approveDetail !== false,
    runCafe24DryRun: policy.runCafe24DryRun !== false,
    cafe24: policy.cafe24 || { display: 'F', selling: 'F', register: true },
    generatePollSeconds: Number(policy.generatePollSeconds || 15),
    generatePollMax: Number(policy.generatePollMax || 120),
    project_id: '',
    stage: 'goal-start',
    bus: 'factory-goal-v1'
  }
}];`;

const nodes = [];
const connections = {};
let x = 0;

nodes.push({
  parameters: {
    content: '## GOAL UNATTENDED\\nPolicy-driven. No Form waits.\\nCafe24: 진열안함+판매안함 only.\\nSee goal/GOAL_ACTIVE.md',
    height: 200,
    width: 320,
    color: 5,
  },
  id: 'g-note',
  name: 'Sticky Note',
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position: [-240, -260],
});

nodes.push({
  parameters: {},
  id: 'g-trig',
  name: 'Manual Trigger',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [x, 0],
});
x += 240;

nodes.push(code('g-load', 'Load Goal Policy', x, 0, loadPolicyCode, 'decision-policy.json embedded at build time'));
connections['Manual Trigger'] = { main: [[{ node: 'Load Goal Policy', type: 'main', index: 0 }]] };
x += 280;

nodes.push(exec('g-01', 'Run 01 Health', 'pdp-01-health-gate', x, 0));
connections['Load Goal Policy'] = { main: [[{ node: 'Run 01 Health', type: 'main', index: 0 }]] };
x += 260;

nodes.push(code('g-a01', 'After 01', x, 0, `const bus = $('Load Goal Policy').first().json;
const health = $input.first().json || {};
if (health.ready === false) throw new Error('Health fail: ' + (health.message || ''));
return [{ json: { ...bus, health, stage: 'm0-health-ok' } }];`));
connections['Run 01 Health'] = { main: [[{ node: 'After 01', type: 'main', index: 0 }]] };
x += 260;

nodes.push(exec('g-02', 'Run 02 Analyze', 'pdp-02-input-analyze', x, 0));
connections['After 01'] = { main: [[{ node: 'Run 02 Analyze', type: 'main', index: 0 }]] };
x += 260;

nodes.push(code('g-a02', 'After 02 + Policy Name', x, 0, `const bus = $('After 01').first().json;
const child = $input.first().json || {};
const project_id = child.project_id || child.projectId || '';
if (!project_id) throw new Error('no project_id after analyze');
return [{ json: { ...bus, ...child, project_id, productName: bus.productName, query: bus.productName, stage: 'g0-analyzed' } }];`));
connections['Run 02 Analyze'] = { main: [[{ node: 'After 02 + Policy Name', type: 'main', index: 0 }]] };
x += 280;

nodes.push(exec('g-07', 'Run 07 DB Candidates', 'pdp-07-db-candidates-sinhwa-cafe24', x, 0));
connections['After 02 + Policy Name'] = { main: [[{ node: 'Run 07 DB Candidates', type: 'main', index: 0 }]] };
x += 280;

nodes.push(code('g-g1', 'Policy G1 DB Select', x, 0, `const bus = $('After 02 + Policy Name').first().json;
const child = $input.first().json || {};
const sinhwa = Array.isArray(child.sinhwaTop) ? child.sinhwaTop : [];
const cafe = Array.isArray(child.cafe24Top) ? child.cafe24Top : [];
const si = Number(bus.sinhwaIndex ?? 0);
const ci = Number(bus.cafe24Index ?? 0);
const confirmedSinhwa = sinhwa[si] || sinhwa[0] || null;
const confirmedCafe24 = cafe[ci] || cafe[0] || null;
return [{ json: { ...bus, dbChild: child, sinhwaCandidates: sinhwa, cafe24Candidates: cafe, confirmedSinhwa, confirmedCafe24, stage: 'g1-policy' } }];`, 'autoApplyTop / policy index'));
connections['Run 07 DB Candidates'] = { main: [[{ node: 'Policy G1 DB Select', type: 'main', index: 0 }]] };
x += 280;

nodes.push(code('g-g2', 'Policy G2 Fields', x, 0, `const bus = $input.first().json;
const analysis = bus.analysis || {};
const d = bus.fieldDefaults || {};
const productFields = {
  productName: bus.productName || analysis.product_name || '',
  category: analysis.category || d.category || '',
  material: (analysis.materials && analysis.materials[0]) || analysis.material || d.material || '',
  width_mm: analysis.width_mm || analysis.size_width || d.width_mm || '',
  height_mm: analysis.height_mm || analysis.size_height || d.height_mm || '',
  weight_g: analysis.weight_g || d.weight_g || '',
  price: analysis.price_range_estimate || d.price || '',
  origin: analysis.origin || d.origin || '대한민국',
};
const required = ['productName','category','material','width_mm','height_mm'];
const missingFields = required.filter(k => !String(productFields[k]||'').trim());
if (missingFields.length) throw new Error('G2 still missing after policy: ' + missingFields.join(','));
return [{ json: { ...bus, productFields, missingFields: [], stage: 'g2-policy' } }];`));
connections['Policy G1 DB Select'] = { main: [[{ node: 'Policy G2 Fields', type: 'main', index: 0 }]] };
x += 280;

nodes.push(exec('g-03', 'Run 03 Competitors', 'pdp-03-competitors', x, 0));
connections['Policy G2 Fields'] = { main: [[{ node: 'Run 03 Competitors', type: 'main', index: 0 }]] };
x += 260;

nodes.push(code('g-g3', 'Policy G3 VM Select', x, 0, `const bus = $('Policy G2 Fields').first().json;
const child = $input.first().json || {};
let list = [];
if (Array.isArray(child.competitor_data?.similar_products)) list = child.competitor_data.similar_products;
else if (Array.isArray(child.similar_products)) list = child.similar_products;
else if (Array.isArray(child.competitors)) list = child.competitors;
const raw = String(bus.selectedVmIndexes || '0');
const idxs = raw.split(/[,\\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0).slice(0, Number(bus.vmTopK||2));
const selectedVm = idxs.map(i => list[i]).filter(Boolean);
return [{ json: { ...bus, vmCandidates: list, selectedVmIndexes: idxs, selectedVm, stage: 'g3-policy' } }];`));
connections['Run 03 Competitors'] = { main: [[{ node: 'Policy G3 VM Select', type: 'main', index: 0 }]] };
x += 280;

nodes.push(exec('g-04', 'Run 04 Generate All', 'pdp-04-generate-all-sections', x, 0));
connections['Policy G3 VM Select'] = { main: [[{ node: 'Run 04 Generate All', type: 'main', index: 0 }]] };
x += 280;

nodes.push(httpGet('g-full', 'Fetch Project Full', "={{$('Policy G3 VM Select').item.json.backendBase}}/api/projects/{{$('Policy G3 VM Select').item.json.project_id}}/full", x, 0));
connections['Run 04 Generate All'] = { main: [[{ node: 'Fetch Project Full', type: 'main', index: 0 }]] };
x += 280;

nodes.push(code('g-g4', 'Policy G4 Asset Select', x, 0, `const bus = $('Policy G3 VM Select').first().json;
const full = $input.first().json || {};
const gen = (() => { try { return $('Run 04 Generate All').first().json; } catch(e) { return {}; } })();
const base = String(bus.backendBase||'').replace(/\\/+$/,'');
function absUrl(u){ const s=String(u||'').trim(); if(!s)return''; if(/^https?:\\/\\//i.test(s))return s; return base+(s.startsWith('/')?s:'/'+s); }
const assets = [];
if (full.product_image_url || bus.imageUrl) {
  assets.push({ id:'input:product', stage:'input', label:'입력 제품', url: absUrl(full.product_image_url||bus.imageUrl), kind:'image' });
}
const sections = full.sections || {};
for (const sid of Object.keys(sections)) {
  const s = sections[sid]||{};
  const imageUrl = s.image_url || s.imageUrl || '';
  const title = s.section_name || s.name || sid;
  if (imageUrl) assets.push({ id:'section:'+sid, stage:'section', sectionId:sid, label:title, url:absUrl(imageUrl), kind:'image' });
}
const mode = (bus.assetSelect && bus.assetSelect.mode) || 'all_images';
let selected = assets;
if (mode === 'all_images') selected = assets.filter(a => a.kind==='image');
const selectedAssetIds = selected.map(a => a.id);
const selectedAssetUrls = selected.map(a => a.url).filter(Boolean);
const sectionImageCount = assets.filter(a => a.id.startsWith('section:') && a.kind==='image').length;
return [{ json: {
  ...bus,
  generateResult: gen,
  projectFullStatus: full.status,
  generatedAssets: assets,
  selectedAssetIds,
  selectedAssets: selected,
  selectedAssetUrls,
  selectedCount: selected.length,
  sectionImageCount,
  sectionCount: Object.keys(sections).length,
  stage: 'g4-policy'
} }];`));
connections['Fetch Project Full'] = { main: [[{ node: 'Policy G4 Asset Select', type: 'main', index: 0 }]] };
x += 300;

nodes.push(exec('g-05', 'Run 05 Export', 'pdp-05-export', x, 0));
connections['Policy G4 Asset Select'] = { main: [[{ node: 'Run 05 Export', type: 'main', index: 0 }]] };
x += 260;

nodes.push(code('g-final', 'Goal Run Summary', x, 0, `const bus = $('Policy G4 Asset Select').first().json;
const exp = $input.first().json || {};
const checklist = {
  A1_analyze: !!bus.project_id,
  A2_db: !!(bus.confirmedSinhwa || bus.confirmedCafe24),
  A3_fields: Array.isArray(bus.missingFields) && bus.missingFields.length === 0,
  A4_vm: true,
  A5_hero: (bus.sectionImageCount||0) > 0,
  A6_size: 'pending-m1-stage-split',
  A7_options: 'pending-m1-or-skip',
  A8_cuts: (bus.sectionImageCount||0) > 0,
  A9_sections15: (bus.sectionCount||0) >= 15 && (bus.sectionImageCount||0) >= 15,
  A10_export: !!exp,
  A11_cafe24_product_no: false,
  A12_cafe24_safe_flags: false
};
const hardFail = !checklist.A1_analyze;
if (hardFail) throw new Error('Goal run hard-fail: no project_id');
return [{ json: {
  ok: true,
  goalMode: true,
  milestone: 'M0-unattended-skeleton',
  project_id: bus.project_id,
  productName: bus.productName,
  sectionCount: bus.sectionCount,
  sectionImageCount: bus.sectionImageCount,
  selectedCount: bus.selectedCount,
  selectedAssetIds: bus.selectedAssetIds,
  selectedAssetUrls: bus.selectedAssetUrls,
  checklist,
  cafe24: bus.cafe24,
  exportResult: exp,
  nextMilestone: 'M1 stage-separated hero/size/cuts/detail15 + Cafe24 safe register',
  finishedAt: new Date().toISOString(),
  note: 'M0: unattended path works. A9/A11/A12 need M1–M3. Do not mark Goal SUCCESS yet.'
} }];`));
connections['Run 05 Export'] = { main: [[{ node: 'Goal Run Summary', type: 'main', index: 0 }]] };

const wf = {
  name: 'PDP GOAL 11 - Unattended Factory Line',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: true },
  tags: [{ name: 'pdp-factory' }, { name: 'goal' }],
};

const out = path.join(root, 'workflows', '11-goal-factory-unattended.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2), 'utf8');
console.log('wrote', out, 'nodes', nodes.length);
console.log('imageUrl', imageUrl);
console.log('backend', backendForDocker);
