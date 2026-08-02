// Fail-closed QA gate based on auditor metrics + local evidence receipts.
// Missing, malformed, or indeterminate evidence is a FAIL — never a soft pass.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function bytesHuman(n) {
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireShape(metrics, failures) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    failures.push('metrics.json is missing or not an object');
    return false;
  }

  const requiredObjects = [
    'dependencies',
    'code_quality',
    'performance',
    'build',
    'security',
    'privacy',
    'architecture',
    'scores',
  ];
  for (const key of requiredObjects) {
    if (!metrics[key] || typeof metrics[key] !== 'object') {
      failures.push(`metrics.${key} missing or invalid`);
    }
  }

  if (!isFiniteNumber(metrics.scores?.overall)) {
    failures.push('metrics.scores.overall missing or not a number');
  }

  const requiredNumbers = [
    ['dependencies', 'high'],
    ['dependencies', 'critical'],
    ['dependencies', 'missing'],
    ['code_quality', 'tscErrors'],
    ['build', 'expoDoctorIssues'],
    ['architecture', 'modulesAnalyzed'],
    ['architecture', 'cycles'],
    ['performance', 'androidBytes'],
  ];
  for (const [group, field] of requiredNumbers) {
    if (!isFiniteNumber(metrics[group]?.[field])) {
      failures.push(`metrics.${group}.${field} missing or not a number`);
    }
  }

  return failures.length === 0;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

(function main() {
  const base = path.join(process.cwd(), '_reports', 'prod_audit_v2');
  const metricsPath = path.join(base, 'metrics.json');
  const doctorPath = path.join(base, 'logs', 'expo_doctor.json');
  const rulesPath = path.join(process.cwd(), 'firestore.rules');
  const statusPath = path.join(base, 'STATUS.md');

  const failures = [];
  const notes = [];
  const metrics = readJSON(metricsPath);

  if (!metrics) {
    console.error('QA GATE FAIL: metrics.json not found or unreadable. Run the audit first.');
    process.exit(1);
  }

  requireShape(metrics, failures);

  // Evidence integrity: STATUS and metrics must exist together.
  if (!fs.existsSync(statusPath)) {
    failures.push('STATUS.md missing beside metrics.json');
  } else {
    notes.push(`metrics.json sha256=${sha256File(metricsPath)}`);
    notes.push(`STATUS.md sha256=${sha256File(statusPath)}`);
  }

  // Expo Doctor: invalid/empty JSON must not score as zero issues.
  const doctorRaw = readText(doctorPath);
  const doctor = doctorRaw ? readJSON(doctorPath) : null;
  if (!doctorRaw || doctorRaw.trim() === '' || doctorRaw.trim() === '{}') {
    failures.push('Expo Doctor evidence missing/empty (fail closed)');
  } else if (!doctor || typeof doctor !== 'object') {
    failures.push('Expo Doctor JSON invalid (fail closed)');
  } else if (
    !Array.isArray(doctor.issues) &&
    !Array.isArray(doctor.failures) &&
    typeof doctor.success !== 'boolean' &&
    typeof doctor.ok !== 'boolean'
  ) {
    failures.push('Expo Doctor JSON lacks issues/failures/success schema (fail closed)');
  } else {
    const issueCount = Array.isArray(doctor.issues)
      ? doctor.issues.length
      : Array.isArray(doctor.failures)
        ? doctor.failures.length
        : doctor.success === false || doctor.ok === false
          ? Math.max(1, Number(metrics.build?.expoDoctorIssues || 0))
          : Number(metrics.build?.expoDoctorIssues || 0);
    if (issueCount > 0) {
      failures.push(`Expo Doctor reported ${issueCount} issue(s)`);
    }
    if (isFiniteNumber(metrics.build?.expoDoctorIssues) && metrics.build.expoDoctorIssues !== issueCount) {
      // Prefer live doctor evidence over stale metrics when they diverge.
      notes.push(
        `Expo Doctor issue count mismatch: metrics=${metrics.build.expoDoctorIssues}, evidence=${issueCount}`,
      );
    }
  }

  // Architecture: zero modules analyzed cannot earn a passing architecture score.
  if ((metrics.architecture?.modulesAnalyzed ?? 0) <= 0) {
    failures.push('Architecture evidence incomplete: modulesAnalyzed=0');
  }
  if ((metrics.scores?.per_area?.Architecture ?? 0) >= 100 && (metrics.architecture?.modulesAnalyzed ?? 0) <= 0) {
    failures.push('Architecture scored 100 with zero modules analyzed (invalid)');
  }

  // Overall score threshold
  const overall = metrics.scores?.overall ?? 0;
  if (overall < 85) failures.push(`Overall score too low: ${overall} < 85`);

  // Android bundle size: require a real measured artifact, not an unknown zero.
  const perf = metrics.performance || {};
  let androidBytes = 0;
  let bundleSource = 'none';
  if (perf.androidBytes_export_hbc > 0) {
    androidBytes = perf.androidBytes_export_hbc;
    bundleSource = 'export_hbc';
    notes.push('Using Hermes export size for Android bundle check.');
  } else if (perf.androidBytes_rncli > 0) {
    androidBytes = perf.androidBytes_rncli;
    bundleSource = 'rncli';
    notes.push('Hermes export not available; using RN CLI Android bundle size.');
  } else if (perf.androidBytes_export_js > 0) {
    androidBytes = perf.androidBytes_export_js;
    bundleSource = 'export_js';
    notes.push('Using JS export size (no Hermes hbc present).');
  } else if (perf.androidBytes > 0) {
    androidBytes = perf.androidBytes;
    bundleSource = 'androidBytes';
  }

  const limit = 7 * 1024 * 1024;
  if (!androidBytes) {
    failures.push('Android bundle size evidence missing (fail closed)');
  } else if (androidBytes > limit) {
    failures.push(`Android bundle too large: ${bytesHuman(androidBytes)} > ${bytesHuman(limit)} (${bundleSource})`);
  }

  // Dependencies
  const high = metrics.dependencies?.high ?? 0;
  const critical = metrics.dependencies?.critical ?? 0;
  if (high > 0 || critical > 0) {
    failures.push(`Vulnerabilities present: high=${high}, critical=${critical}`);
  }
  const tscErrors = metrics.code_quality?.tscErrors ?? 0;
  if (tscErrors > 0) failures.push(`TypeScript errors: ${tscErrors}`);
  const missingDeps = metrics.dependencies?.missing ?? 0;
  if (missingDeps > 0) failures.push(`Missing dependencies: ${missingDeps}`);

  // Firestore rules: detect open or authenticated-global catch-alls directly from source.
  const rules = readText(rulesPath);
  if (!rules) {
    failures.push('firestore.rules missing (fail closed)');
  } else {
    if (/allow\s+read\s*,\s*write\s*:\s*if\s*true\s*;/i.test(rules)) {
      failures.push('firestore.rules allows open read/write if true');
    }
    if (
      /match\s+\/\{document=\*\*\}[\s\S]{0,400}?allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null/i.test(
        rules,
      )
    ) {
      failures.push('firestore.rules has authenticated-global catch-all write');
    }
  }

  // Emit a compact gate receipt for CI artifacts.
  const receipt = {
    schema: 'blyp.qa-gate-receipt',
    version: 1,
    generatedAt: new Date().toISOString(),
    verdict: failures.length ? 'FAIL' : 'PASS',
    overall,
    androidBytes,
    bundleSource,
    failures,
    notes,
  };
  const receiptDir = path.join(base, 'gate');
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, 'qa-gate-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);

  if (failures.length) {
    console.error('QA GATE FAIL');
    failures.forEach((f) => console.error(' - ' + f));
    if (notes.length) {
      console.error('Notes:');
      notes.forEach((n) => console.error(' * ' + n));
    }
    process.exit(1);
  }

  console.log('QA GATE PASS');
  console.log(`Overall: ${overall}`);
  console.log(`Android bundle: ${bytesHuman(androidBytes)} (${bundleSource})`);
  if (notes.length) {
    console.log('Notes:');
    notes.forEach((n) => console.log(' * ' + n));
  }
  process.exit(0);
})();
