const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPAIR_TOOL = path.join(ROOT, 'tools', 'repair_factory_registration_identity_drift_v225.cjs');
const RESULT_PATH = path.join(ROOT, 'output', 'debug-evidence', 'factory-registration-current-work-repair-v225.json');

execFileSync(process.execPath, [REPAIR_TOOL], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const result = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
const checks = [
  [result.before?.sectionImages >= 1, `현재 섹션 이미지가 없습니다: ${JSON.stringify(result.before)}`],
  [result.source?.sectionImages === 15, `정상 백업 섹션 이미지가 15개가 아닙니다: ${JSON.stringify(result.source)}`],
  [result.after?.sectionImages === 15, `복구 후 섹션 이미지가 15개가 아닙니다: ${JSON.stringify(result.after)}`],
  [result.after?.sectionContents === 15, `복구 후 섹션 콘텐츠가 15개가 아닙니다: ${JSON.stringify(result.after)}`],
];
const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) throw new Error(failures.join('\n'));
console.log(JSON.stringify({ ok: true, before: result.before, source: result.source, after: result.after }, null, 2));
