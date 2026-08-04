#!/usr/bin/env node
/**
 * Verified-forward gate — code + optional live device smoke.
 *
 *   npm run verify:forward
 *   npm run verify:session
 *   npm run verify:live
 *   node scripts/verified-forward-gate.js --all --ci --live
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SESSION = path.join(ROOT, '.cursor', 'agent', 'session.json');
const TOUCHED = path.join(ROOT, '.cursor', 'agent', 'touched-files.json');
const LIVE_GATE = path.join(ROOT, 'tools', 'agent', 'RUN_LIVE_SMOKE_GATE.ps1');

const MOBILE_RE =
  /^(android\/|src\/|app\.json|app\.config\.(js|ts)|eas\.json|package\.json)/;

function readTouched() {
  if (fs.existsSync(SESSION)) {
    try {
      const s = JSON.parse(fs.readFileSync(SESSION, 'utf8'));
      if (Array.isArray(s.files) && s.files.length) return s.files;
    } catch (_) {}
  }
  if (!fs.existsSync(TOUCHED)) return [];
  try {
    return JSON.parse(fs.readFileSync(TOUCHED, 'utf8')).files || [];
  } catch {
    return [];
  }
}

function classify(files) {
  const areas = { client: false, functions: false, backend: false, forensic: false, mobile: false };
  const lintTargets = [];
  for (const f of files) {
    const p = f.replace(/\\/g, '/');
    if (MOBILE_RE.test(p)) areas.mobile = true;
    if (p.startsWith('functions/')) areas.functions = true;
    else if (p.startsWith('backend/blyp-live-service/')) areas.backend = true;
    else if (p.startsWith('forensic/')) areas.forensic = true;
    else if (/\.(tsx?|jsx?)$/.test(p)) {
      areas.client = true;
      if (!p.includes('node_modules')) lintTargets.push(p);
    }
  }
  return { areas, lintTargets };
}

function run(cmd, cwd = ROOT) {
  console.log(`\n> [${cwd === ROOT ? 'root' : path.basename(cwd)}] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
}

function tryRun(name, fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return name;
  }
}

function shouldRunLive({ liveFlag, strict, fromSession, areas, ci, all }) {
  if (liveFlag || process.env.BLYP_REQUIRE_LIVE === '1') return true;
  if (fromSession && strict && areas.mobile) return true;
  if (all && !ci && process.env.BLYP_LIVE_ON_FORWARD === '1') return true;
  return false;
}

function runLiveGate() {
  if (!fs.existsSync(LIVE_GATE)) {
    throw new Error('missing RUN_LIVE_SMOKE_GATE.ps1');
  }
  run(
    `powershell -ExecutionPolicy Bypass -File "${LIVE_GATE}"`,
    ROOT
  );
}

function main() {
  const all = process.argv.includes('--all');
  const ci = process.argv.includes('--ci');
  const strict = process.argv.includes('--strict');
  const fromSession = process.argv.includes('--from-session');
  const liveOnly = process.argv.includes('--live-only');
  const liveFlag = process.argv.includes('--live') || liveOnly;
  const touched = fromSession || (!all && !ci && !liveOnly) ? readTouched() : [];

  const failures = [];

  if (liveOnly) {
    failures.push(tryRun('live smoke', () => runLiveGate()));
    if (failures.filter(Boolean).length) {
      console.error('\nVERIFY-LIVE GATE FAIL');
      process.exit(1);
    }
    console.log('\nVERIFY-LIVE GATE PASS');
    return;
  }

  if (fromSession && touched.length === 0) {
    console.log('verify:session — no touched files; pass');
    process.exit(0);
  }

  let areas;
  let lintTargets;
  if (all || ci) {
    areas = { client: true, functions: true, backend: true, forensic: false, mobile: false };
    lintTargets = [];
  } else {
    ({ areas, lintTargets } = classify(touched));
    console.log('verify — touched:', touched.join(', ') || '(none)');
  }

  if (areas.client) {
    if (ci || all) {
      failures.push(tryRun('eslint', () => run('npm run lint')));
      failures.push(tryRun('client typecheck', () => run('npm run typecheck')));
      failures.push(tryRun('jest', () => run('npm test -- --ci --passWithNoTests')));
    } else {
      if (strict && lintTargets.length) {
        const chunk = lintTargets.slice(0, 25).map((f) => `"${f}"`).join(' ');
        failures.push(tryRun('eslint touched', () => run(`npx eslint ${chunk}`)));
      }
      failures.push(tryRun('client typecheck', () => run('npm run typecheck')));
      if (strict && touched.length) {
        const related = touched.filter((f) => /\.(tsx?|jsx?)$/.test(f) && !f.includes('__tests__'));
        if (related.length) {
          const args = related.slice(0, 10).map((f) => `"${f}"`).join(' ');
          failures.push(tryRun('jest related', () => run(`npm test -- --ci --findRelatedTests ${args} --passWithNoTests`)));
        }
      }
    }
  }

  if (areas.functions || ci || all) {
    failures.push(tryRun('functions tsc', () => run('npx tsc --noEmit', path.join(ROOT, 'functions'))));
  }

  if (areas.backend || ci || all) {
    failures.push(tryRun('backend typecheck', () => run('npm run typecheck', path.join(ROOT, 'backend', 'blyp-live-service'))));
  }

  if (areas.forensic && strict) {
    for (const f of touched.filter((x) => x.endsWith('.py')).slice(0, 10)) {
      const full = path.join(ROOT, f);
      if (fs.existsSync(full)) {
        failures.push(tryRun(`py_compile ${f}`, () => run(`python -m py_compile "${full}"`)));
      }
    }
  }

  const failed = failures.filter(Boolean);
  if (failed.length) {
    console.error('\nVERIFY-FORWARD GATE FAIL:', failed.join(', '));
    process.exit(1);
  }

  if (shouldRunLive({ liveFlag, strict, fromSession, areas, ci, all })) {
    const liveFail = tryRun('live smoke', () => runLiveGate());
    if (liveFail) {
      console.error('\nVERIFY-FORWARD GATE FAIL:', liveFail);
      process.exit(1);
    }
  }

  console.log('\nVERIFY-FORWARD GATE PASS');
}

main();
