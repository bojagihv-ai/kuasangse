const path = require('node:path');
const { coverageHasFailures, verifyCoverage } = require('./lib/control_tower_plan_coverage.cjs');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
}

function main() {
  const root = path.resolve(__dirname, '..');
  const plan = argument('--plan') || path.join(root, '.omo', 'plans', 'batch-production-control-tower.md');
  const evidenceRoot = argument('--evidence-root');
  const mappingManifest = argument('--mapping-manifest');
  const reportDir = argument('--report-dir');
  if (!reportDir) throw new Error('--report-dir is required so coverage artifacts stay in an explicit evidence directory');
  const result = verifyCoverage({
    root,
    plan: path.resolve(root, plan),
    evidenceRoot: evidenceRoot ? path.resolve(root, evidenceRoot) : '',
    mapping: mappingManifest ? JSON.parse(require('node:fs').readFileSync(path.resolve(root, mappingManifest), 'utf8')) : undefined,
    ledger: path.join(root, '.omo', 'start-work', 'ledger.jsonl'),
    reportDir: path.resolve(root, reportDir),
  });
  console.log(JSON.stringify(result.summary));
  if (coverageHasFailures(result.summary)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = require('./lib/control_tower_plan_coverage.cjs');
