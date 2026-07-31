/**
 * Deterministic lightweight secret scan for CI and local validation.
 * High-confidence patterns only; public Firebase/Expo identifiers are intentionally excluded.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = process.env.BLYP_AUDIT_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.BLYP_AUDIT_OUTPUT_DIR)
  : path.join(ROOT, '.artifacts', 'production-integrity');
const OUT = path.join(OUTPUT_DIR, 'secret-scan.json');
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  '.manus-work',
  '.artifacts',
  'dist',
  'web-build',
  '_reports',
  'backup',
  '#1',
  '.vscode',
]);
const TEXT_EXT = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.txt',
  '.sh',
  '.ps1',
  '.yml',
  '.yaml',
]);

const PATTERNS = [
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private Key', regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH)? ?PRIVATE KEY-----/g },
  { name: 'Google OAuth Client Secret', regex: /"client_secret"\s*:\s*"[A-Za-z0-9._-]{16,}"/g },
  { name: 'Slack Token', regex: /xox[baprs]-[A-Za-z0-9-]{16,}/g },
  { name: 'GitHub Token', regex: /gh[oprsu]_[A-Za-z0-9]{36,255}/g },
  { name: 'Stripe Live Secret Key', regex: /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { name: 'OpenAI Secret Key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
];

function isTextFile(file) {
  return TEXT_EXT.has(path.extname(file).toLowerCase());
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    if (entry.isFile()) {
      const filePath = path.join(dir, entry.name);
      if (isTextFile(filePath)) yield filePath;
    }
  }
}

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const findings = [];
  for (const rule of PATTERNS) {
    for (const match of content.matchAll(rule.regex)) {
      const index = match.index || 0;
      const line = content.slice(0, index).split(/\r?\n/).length;
      findings.push({
        rule: rule.name,
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        line,
        redactedMatch: `${String(match[0]).slice(0, 4)}...REDACTED`,
      });
    }
  }
  return findings;
}

function main() {
  const findings = [];
  for (const file of walk(ROOT)) {
    try {
      findings.push(...scanFile(file));
    } catch (error) {
      console.warn(`Secret scan skipped unreadable file: ${path.relative(ROOT, file)} (${error.message})`);
    }
  }

  const report = {
    tool: 'blyp-lightweight-secret-scan',
    scannedAt: new Date().toISOString(),
    findings,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  if (findings.length > 0) {
    console.error(`Secret scan failed with ${findings.length} high-confidence finding(s).`);
    for (const finding of findings) {
      console.error(`  - ${finding.rule}: ${finding.file}:${finding.line}`);
    }
    process.exit(1);
  }

  console.log(`Secret scan passed. Report: ${path.relative(ROOT, OUT).replace(/\\/g, '/')}`);
}

main();
