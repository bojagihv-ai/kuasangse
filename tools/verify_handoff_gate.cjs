const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { RUNTIME_SOURCES } = require('./regression_manifest.cjs');
const {
  captureRuntimeSourceSnapshot,
  runtimeSourceDigest,
} = require('./runtime_source_guard.cjs');
const { verifyRuntimeBundle } = require('./build_runtime_bundle.cjs');

const ROOT = path.resolve(__dirname, '..');
const ACTUAL_CHROME_EVIDENCE_PATH = path.join(
  'output',
  'debug-evidence',
  'required-fields-ab-preservation.json',
);
const REQUIRED_FIELD_IDS = [
  'product_name',
  'sale_price',
  'purchase_price',
  'stock',
  'size',
  'width_mm',
  'depth_mm',
  'weight',
  'material',
  'usage',
];

function validateActualChromeEvidence(root, evidence) {
  const reasons = [];
  if (!evidence || evidence.schema !== 'kuasangse.actual-chrome-required-fields.v1') {
    reasons.push('ACTUAL_CHROME_EVIDENCE_MISSING');
    return { ok: false, reasons };
  }
  if (evidence.browser !== 'Chrome') reasons.push('ACTUAL_CHROME_REQUIRED');
  if (evidence.manualEntry !== false) reasons.push('ACTUAL_CHROME_MANUAL_REENTRY_NOT_ALLOWED');
  if (evidence.newWorkClicked !== false) reasons.push('ACTUAL_CHROME_NEW_WORK_INVALIDATES_A');
  if (evidence.physicalCtrlF5 !== true) reasons.push('ACTUAL_CHROME_CTRL_F5_MISSING');
  if (evidence.screenReadback !== true) reasons.push('ACTUAL_CHROME_READBACK_MISSING');
  if (evidence.unchanged !== true) reasons.push('ACTUAL_CHROME_A_CHANGED');
  if (!String(evidence.tabId || '').trim()) reasons.push('ACTUAL_CHROME_TAB_MISSING');
  if (!String(evidence.scopeId || '').trim()) reasons.push('ACTUAL_CHROME_SCOPE_MISSING');
  const baseline = evidence.baseline && typeof evidence.baseline === 'object'
    ? evidence.baseline
    : null;
  const afterCtrlF5 = evidence.afterCtrlF5 && typeof evidence.afterCtrlF5 === 'object'
    ? evidence.afterCtrlF5
    : null;
  for (const fieldId of REQUIRED_FIELD_IDS) {
    if (!String(baseline?.[fieldId] ?? '').trim()) reasons.push(`ACTUAL_CHROME_BASELINE_${fieldId}_MISSING`);
    if (!String(afterCtrlF5?.[fieldId] ?? '').trim()) reasons.push(`ACTUAL_CHROME_AFTER_${fieldId}_MISSING`);
    if (String(baseline?.[fieldId] ?? '') !== String(afterCtrlF5?.[fieldId] ?? '')) {
      reasons.push(`ACTUAL_CHROME_FIELD_CHANGED_${fieldId}`);
    }
  }
  const verifiedAt = Date.parse(String(evidence.verifiedAt || ''));
  const ageMs = Date.now() - verifiedAt;
  if (!Number.isFinite(verifiedAt) || ageMs < -5 * 60 * 1000 || ageMs > 24 * 60 * 60 * 1000) {
    reasons.push('ACTUAL_CHROME_EVIDENCE_STALE');
  }
  const screenshots = Array.isArray(evidence.screenshots) ? evidence.screenshots : [];
  if (screenshots.length < 2) reasons.push('ACTUAL_CHROME_SCREENSHOTS_MISSING');
  for (const screenshot of screenshots.slice(0, 2)) {
    const screenshotPath = path.isAbsolute(String(screenshot || ''))
      ? String(screenshot)
      : path.join(root, String(screenshot || ''));
    if (!screenshot || !fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size <= 0) {
      reasons.push('ACTUAL_CHROME_SCREENSHOT_INVALID');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function readActualChromeEvidence(root, evidencePath = path.join(root, ACTUAL_CHROME_EVIDENCE_PATH)) {
  if (!fs.existsSync(evidencePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function assessHandoff({
  report,
  currentSnapshot,
  bundleVerified,
  actualChromeEvidence,
  requireActualChromeEvidence = false,
  root = ROOT,
}) {
  const reasons = [];
  const currentDigest = runtimeSourceDigest(currentSnapshot);
  if (report?.schema !== 'kuasangse.daily-regression.v1') reasons.push('REPORT_INVALID');
  if (!['daily', 'full'].includes(report?.profile)) reasons.push('FULL_PROFILE_REQUIRED');
  const results = Array.isArray(report?.results) ? report.results : [];
  const summary = report?.summary || {};
  if (
    !results.length
    || summary.total !== results.length
    || summary.passed !== results.length
    || summary.failed !== 0
    || results.some(result => result?.passed !== true)
  ) {
    reasons.push('REGRESSION_FAILED');
  }
  if (requireActualChromeEvidence || actualChromeEvidence) {
    const chromeEvidence = validateActualChromeEvidence(root, actualChromeEvidence);
    if (!chromeEvidence.ok) reasons.push(...chromeEvidence.reasons);
  }
  if (
    !report?.runtimeSourceSnapshot
    || report.runtimeSourceDigest !== runtimeSourceDigest(report.runtimeSourceSnapshot)
    || report.runtimeSourceDigest !== currentDigest
  ) {
    reasons.push('RUNTIME_SOURCE_CHANGED');
  }
  if (bundleVerified !== true) reasons.push('RUNTIME_BUNDLE_STALE');
  return { ok: reasons.length === 0, reasons, runtimeSourceDigest: currentDigest };
}

function verifyHandoff(root = ROOT, reportPath = path.join(root, 'test-results', 'daily-regression', 'latest.json')) {
  if (!fs.existsSync(reportPath)) {
    return { ok: false, reasons: ['REPORT_MISSING'], runtimeSourceDigest: '' };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return {
    ...assessHandoff({
      report,
      currentSnapshot: captureRuntimeSourceSnapshot(root, RUNTIME_SOURCES),
      bundleVerified: verifyRuntimeBundle(root),
      actualChromeEvidence: readActualChromeEvidence(root),
      requireActualChromeEvidence: true,
      root,
    }),
    report,
    reportPath,
  };
}

function writeApprovalReceipt(root, result) {
  const receiptDir = path.join(root, 'test-results', 'handoff');
  const receiptPath = path.join(receiptDir, 'approved.json');
  fs.mkdirSync(receiptDir, { recursive: true });
  const reportBytes = fs.readFileSync(result.reportPath);
  const receipt = {
    schema: 'kuasangse.handoff-approval.v1',
    approvedAt: new Date().toISOString(),
    profile: result.report.profile,
    runtimeSourceDigest: result.runtimeSourceDigest,
    reportDigest: crypto.createHash('sha256').update(reportBytes).digest('hex'),
    reportPath: path.relative(root, result.reportPath).replace(/\\/g, '/'),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receiptPath;
}

if (require.main === module) {
  const reportArgument = process.argv.indexOf('--report');
  const reportPath = reportArgument >= 0
    ? path.resolve(ROOT, process.argv[reportArgument + 1] || '')
    : undefined;
  const result = verifyHandoff(ROOT, reportPath);
  if (!result.ok) {
    console.error(`정상 앱 인계 차단: ${result.reasons.join(', ')}`);
    process.exitCode = 1;
  } else if (process.argv.includes('--check')) {
    console.log(`정상 앱 인계 가능: ${result.runtimeSourceDigest}`);
  } else {
    console.log(`정상 앱 인계 승인: ${writeApprovalReceipt(ROOT, result)}`);
  }
}

module.exports = {
  assessHandoff,
  validateActualChromeEvidence,
  readActualChromeEvidence,
  runtimeSourceDigest,
  verifyHandoff,
  writeApprovalReceipt,
};
