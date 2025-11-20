/**
 * Deterministic secrets scan (lightweight) for CI on Windows without external binaries.
 * Scans text files for common credential patterns and writes JSON report.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_reports', 'prod_audit_v2', 'findings', 'gitleaks.json');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.expo', 'dist', 'web-build', '_reports', 'backup', '#1', '.vscode'
]);
const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.sh', '.ps1', '.yml', '.yaml']);

// Common secret-ish patterns (avoid over-flagging identifiers)
const PATTERNS = [
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private Key', regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g },
  { name: 'Google OAuth Client Secret', regex: /"client_secret"\s*:\s*"[A-Za-z0-9-_\.]+"/g },
  { name: 'Slack Token', regex: /xox[baprs]-[A-Za-z0-9-]+/g },
  { name: 'GitHub Token', regex: /gh[oprsu]_[A-Za-z0-9]{36,255}/g },
  // Firebase Web API key is intentionally not flagged (public identifier by design)
];

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  return TEXT_EXT.has(ext);
}

function shouldSkipDir(name) {
  return IGNORE_DIRS.has(name);
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      const filePath = path.join(dir, entry.name);
      if (!isTextFile(filePath)) continue;
      yield filePath;
    }
  }
}

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const findings = [];
  for (const rule of PATTERNS) {
    const matches = content.matchAll(rule.regex);
    for (const m of matches) {
      // Find line number
      const idx = m.index || 0;
      const prefix = content.slice(0, idx);
      const line = prefix.split(/\r?\n/).length;
      findings.push({ rule: rule.name, file, line, match: String(m[0]).slice(0, 80) });
    }
  }
  return findings;
}

function main() {
  const allFindings = [];
  for (const file of walk(ROOT)) {
    try {
      const f = scanFile(file);
      if (f.length) allFindings.push(...f);
    } catch (e) {
      // ignore unreadable files
    }
  }
  const report = { tool: 'lightweight-scan', findings: allFindings };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Secrets scan complete. Findings: ${allFindings.length}. Report: ${OUT}`);
}

main();
