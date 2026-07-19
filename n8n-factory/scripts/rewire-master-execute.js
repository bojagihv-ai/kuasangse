/**
 * Rewire PDP Factory:
 * - 01~09: Execute Workflow Trigger + Config Ready (parent-safe)
 * - 00: Master chains 01→02→07→03→04→05→08→09 via Execute Workflow
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wfDir = path.join(root, 'workflows');

function readWf(name) {
  return JSON.parse(fs.readFileSync(path.join(wfDir, name), 'utf8'));
}
function writeWf(name, data) {
  fs.writeFileSync(path.join(wfDir, name), JSON.stringify(data, null, 2), 'utf8');
  console.log('wrote', name, 'nodes=', data.nodes.length);
}

function deepReplace(obj, from, to) {
  if (typeof obj === 'string') return obj.split(from).join(to);
  if (Array.isArray(obj)) return obj.map((x) => deepReplace(x, from, to));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepReplace(v, from, to);
    return out;
  }
  return obj;
}

const PARENT_MERGE_CODE = `const input = $input.first().json || {};
const d = {
  backendBase: 'http://127.0.0.1:5050',
  apiHubBase: 'http://127.0.0.1:4321',
  productName: '테스트 상품',
  imageUrl: '',
  imageFilePath: '',
  project_id: '',
  llmModel: 'gpt-5.3-codex-spark',
  generatePollSeconds: 15,
  generatePollMax: 120,
  mode: 'image-cuts',
  imageModel: 'gemini-3.1-flash-image-preview',
  outputImageSize: '1K',
  maxFilesPerRun: 1,
  maxImagesPerRun: 8,
  enableProfile: false,
  pollSeconds: 10,
  maxPolls: 36,
  actuallyRun: false,
  driveMode: 'image-cuts',
  driveImageModel: 'gemini-3.1-flash-image-preview',
  driveOutputImageSize: '1K',
  driveActuallyRun: false,
  channelId: 'smartstore',
  channelLabels: '스마트스토어,쿠팡',
  productNo: '',
  productCode: '',
  debugPort: 9224,
  candidatesLimit: 8,
  sinhwaDirectBase: 'http://127.0.0.1:8200',
  sinhwaConnectorId: 'db_7db4f9f8f4074c80',
  sinhwaSearchEndpointId: 'api-search-api-v1-search-get_0cd83217e9d84714',
  cafe24ConnectorId: 'cafe24_control_tower',
  cafe24ProductsEndpointId: 'products',
  tryStartSinhwa: true,
  query: '',
};
const out = { ...d, ...input };
if (!out.query && out.productName) out.query = out.productName;
if (!out.project_id && (input.project_id || input.projectId)) out.project_id = input.project_id || input.projectId;
if (out.driveActuallyRun && out.actuallyRun === false) out.actuallyRun = true;
return [{ json: out }];`;

function patchChild(fileName) {
  let wf = readWf(fileName);

  // Reset previous rewire attempts
  wf.nodes = wf.nodes.filter(
    (n) =>
      n.name !== 'When Executed by Another Workflow' &&
      n.name !== 'Apply Parent Config' &&
      n.name !== 'Config Ready'
  );
  delete wf.connections['When Executed by Another Workflow'];
  delete wf.connections['Apply Parent Config'];
  delete wf.connections['Config Ready'];

  if (!wf.connections['Manual Trigger']?.main?.[0]?.[0]) {
    throw new Error(`${fileName}: Manual Trigger connection missing`);
  }

  // Manual Trigger currently → Set Config (usually)
  const afterManual = wf.connections['Manual Trigger'].main[0][0].node;
  let nextNodes = [];
  if (afterManual === 'Set Config' && wf.connections['Set Config']?.main?.[0]) {
    nextNodes = wf.connections['Set Config'].main[0].map((c) => c.node);
  } else {
    nextNodes = [afterManual];
  }

  // Insert Config Ready after Set Config (manual path)
  wf.nodes.push({
    parameters: {
      jsCode: `// Manual path: Set Config 결과 패스스루
return [{ json: { ...($input.first().json || {}) } }];`,
    },
    id: `cfg-ready-${fileName.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`,
    name: 'Config Ready',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [360, 0],
    notes: 'Manual/Parent 공통 설정 노드. 하위는 $("Config Ready") 또는 $json 사용',
  });

  wf.nodes.push({
    parameters: {},
    id: `extrig-${fileName.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`,
    name: 'When Executed by Another Workflow',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [0, 280],
  });

  wf.nodes.push({
    parameters: { jsCode: PARENT_MERGE_CODE },
    id: `apply-${fileName.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`,
    name: 'Apply Parent Config',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, 280],
  });

  // Manual: Trigger → Set Config → Config Ready → old next of Set Config
  if (afterManual === 'Set Config') {
    wf.connections['Set Config'] = {
      main: [[{ node: 'Config Ready', type: 'main', index: 0 }]],
    };
  } else {
    // Manual pointed elsewhere — insert Config Ready in between
    wf.connections['Manual Trigger'] = {
      main: [[{ node: 'Config Ready', type: 'main', index: 0 }]],
    };
  }

  wf.connections['Config Ready'] = {
    main: [nextNodes.map((node) => ({ node, type: 'main', index: 0 }))],
  };

  // Parent: Execute Trigger → Apply Parent → Config Ready
  wf.connections['When Executed by Another Workflow'] = {
    main: [[{ node: 'Apply Parent Config', type: 'main', index: 0 }]],
  };
  wf.connections['Apply Parent Config'] = {
    main: [[{ node: 'Config Ready', type: 'main', index: 0 }]],
  };

  // Prefer Config Ready over Set Config in expressions
  wf = deepReplace(wf, "$('Set Config').item.json", "$('Config Ready').item.json");
  wf = deepReplace(wf, '$("Set Config").item.json', '$("Config Ready").item.json');
  wf = deepReplace(wf, "$('Set Config').first().json", "$('Config Ready').first().json");
  wf = deepReplace(wf, '$("Set Config").first().json', '$("Config Ready").first().json');

  writeWf(fileName, wf);
}

const children = [
  '01-health-gate.json',
  '02-input-analyze.json',
  '03-competitors.json',
  '04-generate-all-sections.json',
  '05-export.json',
  '06-spark-analyze-optional.json',
  '07-db-candidates-sinhwa-cafe24.json',
  '08-drive-image-cuts-automation.json',
  '09-cafe24-openmarket-dry-run.json',
];

for (const f of children) patchChild(f);

// ---- Master 00 ----
function execNode(id, name, workflowId, x, y, notes = '') {
  return {
    parameters: {
      source: 'database',
      workflowId: { __rl: true, value: workflowId, mode: 'id' },
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

function ifNode(id, name, flagPath, x, y) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [
          {
            id: `${id}-c`,
            leftValue: `={{$json.${flagPath}}}`,
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [x, y],
  };
}

function codeNode(id, name, x, y, jsCode, notes = '') {
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

const masterNodes = [];
const masterConns = {};

masterNodes.push({
  parameters: {},
  id: 'm-trig',
  name: 'Manual Trigger',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
});

masterNodes.push({
  parameters: {
    assignments: {
      assignments: [
        { id: 'c1', name: 'backendBase', value: 'http://127.0.0.1:5050', type: 'string' },
        { id: 'c2', name: 'apiHubBase', value: 'http://127.0.0.1:4321', type: 'string' },
        { id: 'c3', name: 'productName', value: '테스트 상품', type: 'string' },
        { id: 'c4', name: 'imageUrl', value: '', type: 'string' },
        { id: 'c5', name: 'runAnalyze', value: true, type: 'boolean' },
        { id: 'c6', name: 'runDbCandidates', value: true, type: 'boolean' },
        { id: 'c7', name: 'runCompetitors', value: true, type: 'boolean' },
        { id: 'c8', name: 'runGenerateAll', value: true, type: 'boolean' },
        { id: 'c9', name: 'runExport', value: true, type: 'boolean' },
        { id: 'c10', name: 'runDriveCheck', value: false, type: 'boolean' },
        { id: 'c11', name: 'driveActuallyRun', value: false, type: 'boolean' },
        { id: 'c12', name: 'runCafe24DryRun', value: false, type: 'boolean' },
        { id: 'c13', name: 'llmModel', value: 'gpt-5.3-codex-spark', type: 'string' },
        { id: 'c14', name: 'generatePollSeconds', value: 15, type: 'number' },
        { id: 'c15', name: 'generatePollMax', value: 120, type: 'number' },
        { id: 'c16', name: 'candidatesLimit', value: 8, type: 'number' },
        { id: 'c17', name: 'tryStartSinhwa', value: true, type: 'boolean' },
        { id: 'c18', name: 'mode', value: 'image-cuts', type: 'string' },
        { id: 'c19', name: 'imageModel', value: 'gemini-3.1-flash-image-preview', type: 'string' },
        { id: 'c20', name: 'outputImageSize', value: '1K', type: 'string' },
        { id: 'c21', name: 'actuallyRun', value: false, type: 'boolean' },
        { id: 'c22', name: 'driveMode', value: 'image-cuts', type: 'string' },
        { id: 'c23', name: 'channelId', value: 'smartstore', type: 'string' },
        { id: 'c24', name: 'channelLabels', value: '스마트스토어,쿠팡', type: 'string' },
        { id: 'c25', name: 'productNo', value: '', type: 'string' },
        { id: 'c26', name: 'productCode', value: '', type: 'string' },
        { id: 'c27', name: 'debugPort', value: 9224, type: 'number' },
        { id: 'c28', name: 'project_id', value: '', type: 'string' },
        { id: 'c29', name: 'sinhwaDirectBase', value: 'http://127.0.0.1:8200', type: 'string' },
        { id: 'c30', name: 'sinhwaConnectorId', value: 'db_7db4f9f8f4074c80', type: 'string' },
        { id: 'c31', name: 'sinhwaSearchEndpointId', value: 'api-search-api-v1-search-get_0cd83217e9d84714', type: 'string' },
        { id: 'c32', name: 'cafe24ConnectorId', value: 'cafe24_control_tower', type: 'string' },
        { id: 'c33', name: 'cafe24ProductsEndpointId', value: 'products', type: 'string' },
      ],
    },
    options: {},
  },
  id: 'm-set',
  name: 'Set Config',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [220, 0],
  notes: '00만 실행하면 01→02→07→03→04→05→(08)→(09) 순서로 Execute Workflow 호출. imageUrl 필수.',
});

masterNodes.push(
  codeNode(
    'm-assert',
    'Assert Config',
    440,
    0,
    `const cfg = $input.first().json;
if (!cfg.imageUrl) throw new Error('Set Config.imageUrl 이 비어 있습니다.');
if (cfg.driveActuallyRun && !cfg.runDriveCheck) throw new Error('driveActuallyRun=true 이면 runDriveCheck=true 필요');
const out = {
  ...cfg,
  actuallyRun: !!cfg.driveActuallyRun,
  query: cfg.productName,
  mode: cfg.driveMode || cfg.mode || 'image-cuts',
};
return [{ json: out }];`
  )
);

masterConns['Manual Trigger'] = { main: [[{ node: 'Set Config', type: 'main', index: 0 }]] };
masterConns['Set Config'] = { main: [[{ node: 'Assert Config', type: 'main', index: 0 }]] };

// sticky note
masterNodes.push({
  parameters: {
    content:
      '## PDP Factory Master\n01 Health → 02 Analyze → 07 DB후보 → 03 경쟁사 → 04 생성(폴링) → 05 Export → (opt) 08 Drive → (opt) 09 Cafe24 dry-run\n\n하위 워크플로는 단독 Manual 실행도 가능.',
    height: 220,
    width: 420,
  },
  id: 'm-note',
  name: 'Sticky Note',
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position: [-40, -280],
});

let x = 700;
let prev = 'Assert Config';

// Always run 01
masterNodes.push(execNode('m-e01', 'Run 01 Health', 'pdp-01-health-gate', x, 0, '필수 게이트'));
masterNodes.push(
  codeNode(
    'm-a01',
    'After 01',
    x + 260,
    0,
    `const cfg = $('Assert Config').first().json;
const child = $input.first().json;
if (child && child.ready === false) throw new Error('01 Health 실패: ' + (child.message || ''));
return [{ json: { ...cfg, health: child, stage: '01' } }];`
  )
);
masterConns[prev] = { main: [[{ node: 'Run 01 Health', type: 'main', index: 0 }]] };
masterConns['Run 01 Health'] = { main: [[{ node: 'After 01', type: 'main', index: 0 }]] };
prev = 'After 01';
x += 560;

function addOptional(key, flag, execName, wfId, label) {
  const ifN = `If ${key}`;
  const skipN = `Skip ${key}`;
  const afterN = `After ${key}`;
  const baseX = x;

  masterNodes.push(ifNode(`m-if-${key}`, ifN, flag, baseX, 0));
  masterNodes.push(execNode(`m-e-${key}`, execName, wfId, baseX + 280, -140, label));
  masterNodes.push(
    codeNode(
      `m-a-${key}`,
      afterN,
      baseX + 560,
      0,
      `const prev = $('${prev}').first().json;
const child = $input.first().json || {};
const project_id = child.project_id || child.projectId || prev.project_id || '';
return [{ json: { ...prev, ...child, project_id, ['result_${key}']: child, stage: '${key}' } }];`
    )
  );
  masterNodes.push(
    codeNode(
      `m-s-${key}`,
      skipN,
      baseX + 280,
      160,
      `return [{ json: { ...$input.first().json, skipped_${key}: true } }];`
    )
  );

  masterConns[prev] = { main: [[{ node: ifN, type: 'main', index: 0 }]] };
  masterConns[ifN] = {
    main: [
      [{ node: execName, type: 'main', index: 0 }],
      [{ node: skipN, type: 'main', index: 0 }],
    ],
  };
  masterConns[execName] = { main: [[{ node: afterN, type: 'main', index: 0 }]] };
  masterConns[skipN] = { main: [[{ node: afterN, type: 'main', index: 0 }]] };

  prev = afterN;
  x = baseX + 900;
}

// 02 special: if skip, require project_id
{
  const key = '02';
  const ifN = 'If 02 Analyze';
  const execName = 'Run 02 Analyze';
  const skipN = 'Skip 02 Analyze';
  const afterN = 'After 02';
  const baseX = x;
  masterNodes.push(ifNode('m-if-02', ifN, 'runAnalyze', baseX, 0));
  masterNodes.push(execNode('m-e-02', execName, 'pdp-02-input-analyze', baseX + 280, -140, '업로드+분석'));
  masterNodes.push(
    codeNode(
      'm-a-02',
      afterN,
      baseX + 560,
      0,
      `const prev = $('${prev}').first().json;
const child = $input.first().json || {};
const project_id = child.project_id || child.projectId || '';
if (!project_id) throw new Error('02 분석 결과 project_id 없음');
return [{ json: { ...prev, ...child, project_id, stage: '02' } }];`
    )
  );
  masterNodes.push(
    codeNode(
      'm-s-02',
      skipN,
      baseX + 280,
      160,
      `const prev = $input.first().json;
if (!prev.project_id) throw new Error('runAnalyze=false 이면 project_id 를 Set Config에 넣으세요');
return [{ json: { ...prev, skipped_02: true } }];`
    )
  );
  masterConns[prev] = { main: [[{ node: ifN, type: 'main', index: 0 }]] };
  masterConns[ifN] = {
    main: [
      [{ node: execName, type: 'main', index: 0 }],
      [{ node: skipN, type: 'main', index: 0 }],
    ],
  };
  masterConns[execName] = { main: [[{ node: afterN, type: 'main', index: 0 }]] };
  masterConns[skipN] = { main: [[{ node: afterN, type: 'main', index: 0 }]] };
  prev = afterN;
  x = baseX + 900;
}

addOptional('07', 'runDbCandidates', 'Run 07 DB Candidates', 'pdp-07-db-candidates-sinhwa-cafe24', '신화사+Cafe24 후보');
addOptional('03', 'runCompetitors', 'Run 03 Competitors', 'pdp-03-competitors', '경쟁사 검색');
addOptional('04', 'runGenerateAll', 'Run 04 Generate All', 'pdp-04-generate-all-sections', '전체 생성+폴링');
addOptional('05', 'runExport', 'Run 05 Export', 'pdp-05-export', 'export JSON');
addOptional('08', 'runDriveCheck', 'Run 08 Drive', 'pdp-08-drive-image-cuts-automation', 'Drive 조회/실행');
addOptional('09', 'runCafe24DryRun', 'Run 09 Cafe24 DryRun', 'pdp-09-cafe24-openmarket-dry-run', 'dry-run only');

masterNodes.push(
  codeNode(
    'm-final',
    'Final Summary',
    x,
    0,
    `const cfg = $('Assert Config').first().json;
const last = $input.first().json;
const projectId = last.project_id || '';
const base = String(cfg.backendBase || '').replace(/\\/+$/, '');
return [{
  json: {
    ok: true,
    stage: 'master-complete',
    orchestration: 'execute-workflow-chain',
    project_id: projectId,
    productName: cfg.productName,
    imageUrl: cfg.imageUrl,
    healthReady: last.health?.ready ?? null,
    flags: {
      runAnalyze: !!cfg.runAnalyze,
      runDbCandidates: !!cfg.runDbCandidates,
      runCompetitors: !!cfg.runCompetitors,
      runGenerateAll: !!cfg.runGenerateAll,
      runExport: !!cfg.runExport,
      runDriveCheck: !!cfg.runDriveCheck,
      driveActuallyRun: !!cfg.driveActuallyRun,
      runCafe24DryRun: !!cfg.runCafe24DryRun,
    },
    urls: projectId ? {
      project: base + '/api/projects/' + projectId,
      full: base + '/api/projects/' + projectId + '/full',
      export: base + '/api/projects/' + projectId + '/export',
    } : null,
    note: '00 Master → Execute Workflow(01~09). 하위는 단독 실행 가능.',
    finishedAt: new Date().toISOString(),
  }
}];`,
    '마스터 최종 요약'
  )
);
masterConns[prev] = { main: [[{ node: 'Final Summary', type: 'main', index: 0 }]] };

const master = {
  name: 'PDP Factory 00 - Master Orchestrator',
  nodes: masterNodes,
  connections: masterConns,
  active: false,
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: true },
  tags: [{ name: 'pdp-factory' }],
};

writeWf('00-master-orchestrator.json', master);
console.log('OK master connections from', Object.keys(masterConns).length, 'sources');
