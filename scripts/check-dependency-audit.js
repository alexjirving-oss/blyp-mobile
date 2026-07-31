const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'config', 'dependency-audit-baseline.json');
const OUTPUT_DIR = process.env.BLYP_AUDIT_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.BLYP_AUDIT_OUTPUT_DIR)
  : path.join(ROOT, '.artifacts', 'production-integrity');
const REPORT_PATH = path.join(OUTPUT_DIR, 'dependency-audit-ratchet.json');
const SEVERITIES = ['low', 'moderate', 'high', 'critical', 'total'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read dependency audit baseline: ${error.message}`);
  }
}

function auditProject(name, config) {
  const cwd = path.resolve(ROOT, config.directory);
  const result = spawnSync(npmCommand, ['audit', '--omit=dev', '--json'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    maxBuffer: 25 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${name}: npm audit could not start (${result.error.message})`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout || '');
  } catch (error) {
    const diagnostic = String(result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`${name}: npm audit did not return valid JSON (${error.message}). ${diagnostic}`);
  }

  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || !SEVERITIES.every((severity) => Number.isInteger(vulnerabilities[severity]))) {
    throw new Error(`${name}: npm audit response is missing integer vulnerability metadata`);
  }

  return {
    npmExitCode: result.status,
    vulnerabilities: Object.fromEntries(
      SEVERITIES.map((severity) => [severity, vulnerabilities[severity]])
    ),
  };
}

function main() {
  const baseline = readBaseline();
  const failures = [];
  const improvements = [];
  const current = {};

  for (const [name, project] of Object.entries(baseline.projects || {})) {
    const result = auditProject(name, project);
    current[name] = result;

    for (const severity of SEVERITIES) {
      const baselineCount = project.vulnerabilities?.[severity];
      const currentCount = result.vulnerabilities[severity];
      if (!Number.isInteger(baselineCount)) {
        failures.push(`${name}: baseline ${severity} count is missing or invalid`);
      } else if (currentCount > baselineCount) {
        failures.push(
          `${name}: ${severity} vulnerabilities increased from ${baselineCount} to ${currentCount}`
        );
      } else if (currentCount < baselineCount) {
        improvements.push(
          `${name}: ${severity} vulnerabilities decreased from ${baselineCount} to ${currentCount}`
        );
      }
    }
  }

  const output = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    baselineCapturedAt: baseline.capturedAt,
    current,
    failures,
    improvements,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  for (const [name, result] of Object.entries(current)) {
    const counts = SEVERITIES.map(
      (severity) => `${severity}=${result.vulnerabilities[severity]}`
    ).join(' ');
    console.log(`${name}: ${counts}`);
  }
  for (const improvement of improvements) console.log(`Improvement: ${improvement}`);

  if (failures.length > 0) {
    console.error('Dependency audit ratchet failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    'Dependency audit ratchet passed. Existing baseline findings remain release debt; no severity count increased.'
  );
}

try {
  main();
} catch (error) {
  console.error(`Dependency audit ratchet failed: ${error.message}`);
  process.exit(1);
}
