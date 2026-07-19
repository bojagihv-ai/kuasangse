/**
 * Build one-shot n8n import bundle from workflows/*.json
 * Output: import/ALL-pdp-factory.json (array) + import/<same files with stable id>
 */
const fs = require('fs');
const path = require('path');

const factoryRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(factoryRoot, 'workflows');
const bundleDir = path.join(factoryRoot, 'import');

fs.mkdirSync(bundleDir, { recursive: true });
for (const f of fs.readdirSync(bundleDir)) {
  if (f.endsWith('.json')) fs.unlinkSync(path.join(bundleDir, f));
}

const files = fs
  .readdirSync(sourceDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const bundle = [];
for (const file of files) {
  const src = path.join(sourceDir, file);
  const w = JSON.parse(fs.readFileSync(src, 'utf8'));
  const base = path.basename(file, '.json');
  const id = 'pdp-' + base.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  w.id = id;
  w.active = false;
  if (!w.name) w.name = base;
  if (!w.settings) w.settings = { executionOrder: 'v1' };
  if (!w.meta) w.meta = { templateCredsSetupCompleted: true };
  // tags 제거: CLI bulk import 시 tag_entity.name UNIQUE 충돌 방지
  // (여러 워크플로가 동일 {name:"pdp-factory"} 를 각각 INSERT 하려 함)
  delete w.tags;
  bundle.push(w);
  fs.writeFileSync(path.join(bundleDir, file), JSON.stringify(w, null, 0), 'utf8');
}

const allPath = path.join(bundleDir, 'ALL-pdp-factory.json');
fs.writeFileSync(allPath, JSON.stringify(bundle, null, 0), 'utf8');
console.log(`OK: ${bundle.length} workflows -> ${allPath}`);
bundle.forEach((w) => console.log(`  - ${w.id}  ${w.name}`));
