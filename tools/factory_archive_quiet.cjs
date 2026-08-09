const fs = require('fs');
const path = require('path');

function archiveSignature(root) {
  const indexPath = path.join(root, 'index.json');
  if (!fs.existsSync(indexPath)) return 'missing';
  const stat = fs.statSync(indexPath);
  return `${stat.size}:${stat.mtimeMs}`;
}

async function waitForArchiveQuiet(root, { stableMs = 2500, timeoutMs = 30000 } = {}) {
  const started = Date.now();
  let signature = archiveSignature(root);
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const next = archiveSignature(root);
    if (next !== signature) {
      signature = next;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= stableMs) return { signature, waitedMs: Date.now() - started };
  }
  throw new Error(`archive_not_quiet:${root}`);
}

module.exports = { waitForArchiveQuiet };
