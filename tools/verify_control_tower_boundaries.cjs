const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'control_tower');
const forbidden = [
  /sqlite/i,
  /app-core-0[56]/i,
  /window\.(?:state|factoryState)/i,
];
const files = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory() && !["tests", "evidence"].includes(entry.name)) visit(target);
    else if (/\.(?:py|mjs|cjs|html|css|json)$/.test(entry.name)) files.push(target);
  }
}
visit(root);
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(source)) violations.push(`${path.relative(process.cwd(), file)}: ${pattern}`);
}
if (violations.length) throw new Error(`control tower boundary violation:\n${violations.join('\n')}`);
console.log(`CONTROL_TOWER_BOUNDARIES_OK files=${files.length}`);
