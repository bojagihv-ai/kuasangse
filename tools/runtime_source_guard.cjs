const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeSourceList(sources) {
  return [...new Set((sources || []).map(file => String(file).replace(/\\/g, '/')))].sort();
}

function captureRuntimeSourceSnapshot(root, sources) {
  const files = {};
  for (const file of normalizeSourceList(sources)) {
    const absolutePath = path.resolve(root, file);
    if (!fs.existsSync(absolutePath)) {
      files[file] = null;
      continue;
    }
    const content = fs.readFileSync(absolutePath);
    files[file] = {
      bytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  }
  return { files };
}

function compareRuntimeSourceSnapshots(before, after) {
  const previous = before?.files || {};
  const current = after?.files || {};
  const changed = [];
  for (const file of normalizeSourceList([...Object.keys(previous), ...Object.keys(current)])) {
    const left = previous[file];
    const right = current[file];
    if (left?.sha256 !== right?.sha256 || left?.bytes !== right?.bytes) changed.push(file);
  }
  return { stable: changed.length === 0, changed };
}

function runtimeSourceDigest(snapshot) {
  const files = snapshot?.files || {};
  const canonical = Object.keys(files).sort().map(file => [file, files[file]]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

module.exports = {
  captureRuntimeSourceSnapshot,
  compareRuntimeSourceSnapshots,
  runtimeSourceDigest,
};
