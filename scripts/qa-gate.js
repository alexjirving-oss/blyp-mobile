// Simple QA gate based on auditor metrics
// Fails the build if thresholds are not met

const fs = require('fs');
const path = require('path');

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function bytesHuman(n) {
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

(function main(){
  const base = path.join(process.cwd(), '_reports', 'prod_audit_v2');
  const metrics = readJSON(path.join(base, 'metrics.json'));
  if (!metrics) {
    console.error('QA GATE FAIL: metrics.json not found. Run the audit first.');
    process.exit(1);
  }

  const failures = [];
  const notes = [];

  // Overall score >= 85
  const overall = metrics.scores?.overall ?? 0;
  if (overall < 85) failures.push(`Overall score too low: ${overall} < 85`);

  // Android bundle size threshold: prefer Hermes export if present; fallback to RN CLI size
  const perf = metrics.performance || {};
  let androidBytes = 0;
  if (perf.androidBytes_export_hbc && perf.androidBytes_export_hbc > 0) {
    androidBytes = perf.androidBytes_export_hbc;
    notes.push('Using Hermes export size for Android bundle check.');
  } else if (perf.androidBytes_rncli && perf.androidBytes_rncli > 0) {
    androidBytes = perf.androidBytes_rncli;
    notes.push('Hermes export not available; using RN CLI Android bundle size.');
  } else if (perf.androidBytes_export_js && perf.androidBytes_export_js > 0) {
    androidBytes = perf.androidBytes_export_js; // fallback, but likely to fail threshold
    notes.push('Using JS export size (no Hermes hbc present).');
  }

  // Use 7 MB until CI produces Hermes HBC export consistently; tighten to 6.5 MB once export_hbc metrics are present
  const limit = 7 * 1024 * 1024; // 7 MB hard limit (temporary)
  if (!androidBytes) {
    failures.push('Android bundle size metric missing.');
  } else if (androidBytes > limit) {
    failures.push(`Android bundle too large: ${bytesHuman(androidBytes)} > ${bytesHuman(limit)}`);
  }

  // No High/Critical vulnerabilities
  const high = metrics.dependencies?.high ?? 0;
  const critical = metrics.dependencies?.critical ?? 0;
  if (high > 0 || critical > 0) {
    failures.push(`Vulnerabilities present: high=${high}, critical=${critical}`);
  }

  // P0 none approximation: tsc clean and no missing deps
  const tscErrors = metrics.code_quality?.tscErrors ?? 0;
  if (tscErrors > 0) failures.push(`TypeScript errors: ${tscErrors}`);
  const missingDeps = metrics.dependencies?.missing ?? 0;
  if (missingDeps > 0) failures.push(`Missing dependencies: ${missingDeps}`);

  if (failures.length) {
    console.error('QA GATE FAIL');
    failures.forEach(f => console.error(' - ' + f));
    if (notes.length) {
      console.error('Notes:');
      notes.forEach(n => console.error(' * ' + n));
    }
    process.exit(1);
  } else {
    console.log('QA GATE PASS');
    console.log(`Overall: ${overall}`);
    console.log(`Android bundle: ${bytesHuman(androidBytes)}`);
    if (notes.length) {
      console.log('Notes:');
      notes.forEach(n => console.log(' * ' + n));
    }
    process.exit(0);
  }
})();
