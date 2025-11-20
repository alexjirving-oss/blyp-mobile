/* Production Readiness Audit - Node runner (Windows-friendly)
 * Read-only: outputs to _reports/prod_audit_v2
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = process.cwd();
const BASE = path.join(ROOT, '_reports', 'prod_audit_v2');
const LOGS = path.join(BASE, 'logs');
const INV = path.join(BASE, 'inventory');
const FIND = path.join(BASE, 'findings');
const DIAG = path.join(BASE, 'diagrams');
const TMP = path.join(BASE, 'tmp');
[BASE, LOGS, INV, FIND, DIAG, TMP].forEach((d) => {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
});

function run(cmd, opts = {}) {
  try {
    const out = cp.execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
    return { ok: true, stdout: out.toString() };
  } catch (e) {
    return { ok: false, stdout: (e.stdout||'').toString(), stderr: (e.stderr||'').toString(), error: e };
  }
}

function write(p, data) { fs.writeFileSync(p, data); }
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function jread(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function bytesOf(f){ try{ return fs.statSync(f).size } catch { return 0 } }

// Prefer Expo export Hermes bundles if available; fallback to RN CLI tmp bundles.
function readExpoExportSize(platform){
  // Typical paths:
  // 1) _reports/bundles/android/_expo/_expo/static/js/android/AppEntry-XXXX.(hbc|js)
  // 2) _reports/bundles/android/_expo/static/js/android/AppEntry-XXXX.(hbc|js)
  const bases = [
    path.join('_reports','bundles',platform,'_expo','_expo','static','js',platform),
    path.join('_reports','bundles',platform,'_expo','static','js',platform)
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const hbc = fs.readdirSync(base).filter(f => f.endsWith('.hbc'));
    if (hbc.length) return Math.max(...hbc.map(f => bytesOf(path.join(base,f))));
    const js = fs.readdirSync(base).filter(f => f.endsWith('.js'));
    if (js.length) return Math.max(...js.map(f => bytesOf(path.join(base,f))));
  }
  return 0;
}

function readExpoHbcSize(platform){
  const bases = [
    path.join('_reports','bundles',platform,'_expo','_expo','static','js',platform),
    path.join('_reports','bundles',platform,'_expo','static','js',platform)
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const hbc = fs.readdirSync(base).filter(f => f.endsWith('.hbc'));
    if (hbc.length) return Math.max(...hbc.map(f => bytesOf(path.join(base,f))));
  }
  return 0;
}

function readExpoJsSize(platform){
  const bases = [
    path.join('_reports','bundles',platform,'_expo','_expo','static','js',platform),
    path.join('_reports','bundles',platform,'_expo','static','js',platform)
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const js = fs.readdirSync(base).filter(f => f.endsWith('.js'));
    if (js.length) return Math.max(...js.map(f => bytesOf(path.join(base,f))));
  }
  return 0;
}

// Detect PKG
let PKG = 'npm';
if (run('pnpm -v').ok) PKG = 'pnpm'; else if (run('yarn -v').ok) PKG = 'yarn';

// Environment snapshot
const envLines = [];
envLines.push(`PKG=${PKG}`);
envLines.push(`Node=${(run('node -v').stdout||'').trim()||'none'}`);
envLines.push(`NPM=${(run('npm -v').stdout||'').trim()||'none'}`);
envLines.push(`Yarn=${(run('yarn -v').stdout||'').trim()||'none'}`);
envLines.push(`PNPM=${(run('pnpm -v').stdout||'').trim()||'none'}`);
envLines.push(`OS=${process.platform} ${process.arch}`);
envLines.push(`Java=${(run('java -version').stderr||'').split('\n')[0]||''}`);
if (fs.existsSync(path.join(ROOT, 'gradlew'))) {
  envLines.push(`Gradle=${(run(`${process.platform==='win32'?'./gradlew.bat':'./gradlew'} -v`).stdout||'').split('\n').slice(0,5).join(' ')}`);
} else { envLines.push('Gradle=none'); }
write(path.join(LOGS, 'environment.txt'), envLines.join('\n'));

// Inventory: tree.json, by_ext, top50
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '_reports') continue;
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p)); else out.push({ path: p, ext: path.extname(name).slice(1), bytes: st.size });
  }
  return out;
}
const files = walk(ROOT);
write(path.join(INV, 'tree.json'), JSON.stringify({ count: files.length, files }, null, 2));
const byExt = {};
files.forEach((f) => { byExt[f.ext] = (byExt[f.ext] || 0) + 1; });
write(path.join(INV, 'by_ext.json'), JSON.stringify(byExt, null, 2));
write(path.join(INV, 'top50_large_files.json'), JSON.stringify([...files].sort((a,b)=>b.bytes-a.bytes).slice(0,50), null, 2));

// Features & key configs
let pkg = {}; try { pkg = JSON.parse(read(path.join(ROOT, 'package.json')) || '{}'); } catch {}
const deps = { ...(pkg.dependencies||{}), ...(pkg.devDependencies||{}) };
const has = (k) => !!deps && Object.prototype.hasOwnProperty.call(deps, k);
const features = {
  expo: has('expo'), reactNative: has('react-native'), navigation: has('@react-navigation/native'),
  gestureHandler: has('react-native-gesture-handler'), reanimated: has('react-native-reanimated'),
  hlsLibs: ['hls.js','react-native-video','expo-av'].filter(has), auth: ['amazon-cognito-identity-js','@aws-amplify/auth','firebase'].filter(has),
  analytics: ['@react-native-firebase/analytics','@segment/analytics-react-native','sentry-expo','@sentry/react-native'].filter(has)
};
write(path.join(INV, 'features.json'), JSON.stringify(features, null, 2));
const wanted = ['package.json','pnpm-lock.yaml','yarn.lock','package-lock.json','app.json','app.config.js','app.config.ts','eas.json','babel.config.js','metro.config.js','tsconfig.json','jsconfig.json','.eslintrc','.eslintrc.js','.eslintrc.cjs','.eslintrc.json','.prettierrc','.prettierrc.js','.prettierrc.json','.editorconfig','firebase.json','firestore.rules','storage.rules','firestore.indexes.json','android/gradle.properties','android/build.gradle','android/app/build.gradle'];
write(path.join(INV, 'key_configs.json'), JSON.stringify({ found: wanted.filter((w)=>fs.existsSync(path.join(ROOT,w))) }, null, 2));

// Dependencies checks
write(path.join(LOGS, 'npm_tree.txt'), run(`${PKG} ls --all`).stdout || '');
write(path.join(FIND, 'depcheck.json'), run('npx --yes depcheck --json').stdout || '{}');
write(path.join(FIND, 'knip.json'), run('npx --yes knip --reporter json').stdout || '{}');
write(path.join(FIND, 'ncu.json'), run('npx --yes npm-check-updates --errorLevel 0 --jsonUpgraded').stdout || '{}');
let auditCmd = 'npm audit --json'; if (PKG==='pnpm') auditCmd='pnpm audit --json'; if (PKG==='yarn') auditCmd='yarn audit --json';
write(path.join(FIND, 'audit.json'), run(auditCmd).stdout || '{}');

// Lint/format/types
if (fs.existsSync(path.join(ROOT, '.eslintrc')) || fs.readdirSync(ROOT).some((f)=>f.startsWith('.eslintrc.'))) {
  write(path.join(LOGS, 'eslint.json'), run('npx --yes eslint . -f json').stdout || '[]');
}
write(path.join(LOGS, 'prettier.txt'), run('npx --yes prettier . --check').stdout || '');
if (fs.existsSync(path.join(ROOT, 'tsconfig.json'))) {
  write(path.join(LOGS, 'tsc.txt'), run('npx --yes tsc --noEmit').stdout || '');
}
// Strictness
const codeFiles = files.filter(f=>/(ts|tsx|js|jsx)$/.test(f.ext) && !/node_modules|_reports/.test(f.path)).map(f=>f.path);
let anyCount=0, tsIgnore=0, disabled=0;
codeFiles.forEach((p)=>{ const t=read(p)||''; anyCount += (t.match(/:\s*any\b/g)||[]).length; tsIgnore += (t.match(/@ts-ignore/g)||[]).length; disabled += (t.match(/eslint-disable/g)||[]).length; });
write(path.join(FIND, 'strictness.txt'), `any annotations: ${anyCount}\n@ts-ignore: ${tsIgnore}\neslint-disable: ${disabled}`);

// Performance: bundle & SME
const entry = fs.existsSync(path.join(ROOT,'index.ts'))?'index.ts':(fs.existsSync(path.join(ROOT,'index.js'))?'index.js':'App.js');
write(path.join(LOGS, 'rn_version.txt'), run('npx --yes react-native --version').stdout || '');
run(`npx --yes react-native bundle --platform android --dev false --entry-file ${entry} --bundle-output "${path.join(TMP,'index.android.bundle')}" --sourcemap-output "${path.join(TMP,'index.android.map')}" --assets-dest "${path.join(TMP,'assets')}"`);
run(`npx --yes react-native bundle --platform ios --dev false --entry-file ${entry} --bundle-output "${path.join(TMP,'index.ios.bundle')}" --sourcemap-output "${path.join(TMP,'index.ios.map')}" --assets-dest "${path.join(TMP,'assets')}"`);
run(`npx --yes source-map-explorer "${path.join(TMP,'index.android.bundle')}" "${path.join(TMP,'index.android.map')}" --json > "${path.join(FIND,'sme.android.json')}"`);
run(`npx --yes source-map-explorer "${path.join(TMP,'index.ios.bundle')}" "${path.join(TMP,'index.ios.map')}" --json > "${path.join(FIND,'sme.ios.json')}"`);
write(path.join(FIND,'hermes_notes.txt'), 'Hermes note: RN Hermes bytecode reduces JS bundle; on-device differs.');
const aBundleSize = (()=>{ try { return fs.statSync(path.join(TMP,'index.android.bundle')).size } catch { return 0 } })();
write(path.join(FIND,'perf_bundle.txt'), `Android bundle bytes: ${aBundleSize}`);

// Build & tooling
write(path.join(LOGS,'expo_doctor.json'), run('npx --yes expo-doctor --json').stdout || '{}');
if (fs.existsSync(path.join(ROOT,'gradlew'))) write(path.join(LOGS,'gradle_version.txt'), run(`${process.platform==='win32'?'./gradlew.bat':'./gradlew'} -v`).stdout || '');
let metroNotes = [];
try { const mt = read(path.join(ROOT,'metro.config.js'))||''; if (!mt) metroNotes.push('No custom metro.config.js found (OK).'); if (mt && !/inlineRequires\s*:\s*true/.test(mt)) metroNotes.push('Consider inlineRequires:true for faster startup.'); } catch {}
write(path.join(FIND,'metro.txt'), metroNotes.join('\n'));

// Security
write(path.join(FIND,'secretlint.json'), run('npx --yes @secretlint/secretlint -f json .').stdout || '{}');
write(path.join(FIND,'trufflehog.json'), run('npx --yes trufflehog filesystem --no-update --json .').stdout || '');
// If available locally, prefer gitleaks JSON output. Safe no-op if binary not found.
const gl = run('npx --yes gitleaks detect --no-git --log-opts= --redact -f json');
if (gl.ok && (gl.stdout||'').trim()) write(path.join(FIND,'gitleaks.json'), gl.stdout);
// Grep-like
// Secrets grep: treat EXPO_PUBLIC_* as non-secret identifiers by design (Expo public env)
const secretPattern = /(api[_-]?key|secret|token|bearer|Authorization:|GOOGLE_|AWS_|FIREBASE_)/i;
const ignorePattern = /EXPO_PUBLIC_/i;
const secretHits = codeFiles.filter(pth=>{ const t=read(pth)||''; return secretPattern.test(t) && !ignorePattern.test(t); });
write(path.join(FIND,'secret_grep.txt'), secretHits.join('\n'));
// Android/iOS permissions
let permsA='Manifest not found'; try { const t=read(path.join(ROOT,'android','app','src','main','AndroidManifest.xml'))||''; permsA=(t.match(/uses-permission[^>]+/g)||[]).join('\n') } catch {}
write(path.join(FIND,'permissions_android.txt'), permsA);
let permsI='Info.plist not found';
function findPlist(dir) { for (const n of fs.readdirSync(dir)) { const p=path.join(dir,n); const st=fs.statSync(p); if (st.isDirectory()) { const f=findPlist(p); if (f) return f; } else if (/Info\.plist$/.test(n)) return p; } return null; }
const iosDir = path.join(ROOT,'ios'); if (fs.existsSync(iosDir)) { const p = findPlist(iosDir); if (p) { const t=read(p)||''; permsI=(t.match(/NS[A-Za-z]+UsageDescription/g)||[]).join('\n'); } }
write(path.join(FIND,'permissions_ios.txt'), permsI);

// Privacy: tighten PII heuristic to actual API usage/permissions rather than generic words
const piiPattern = /(expo-location|PermissionsAndroid|\bLocation\.|expo-contacts|\bContacts\.|react-native-device-info|getAdvertisingId|\bIDFA\b|\bGAID\b|getUniqueId|getDeviceId|ACCESS_FINE_LOCATION|ACCESS_BACKGROUND_LOCATION|NSLocationWhenInUseUsageDescription)/i;
const piiHits = codeFiles.filter(pth=>piiPattern.test(read(pth)||''));
write(path.join(FIND,'pii_scan.txt'), piiHits.join('\n'));
const envFiles = fs.readdirSync(ROOT).filter(n=>/^\.env/.test(n)); write(path.join(FIND,'env_keys.txt'), envFiles.join('\n'));
let rulesReport=''; try { const r=read(path.join(ROOT,'firestore.rules'))||''; if (/allow\s+read,\s*write:\s*if\s*true\s*;/.test(r)) rulesReport+='DANGER: open read/write in firestore.rules\n'; if (!/request\.auth/.test(r)) rulesReport+='No request.auth checks detected.'; } catch {}
write(path.join(FIND,'firebase_rules_report.txt'), rulesReport);
const lifecycle = codeFiles.filter(pth=>/(TTL|expire|retention|cleanup|prune|delete)/i.test(read(pth)||''));
write(path.join(FIND,'data_lifecycle.txt'), lifecycle.join('\n'));

// Streaming & media
const hlsRefs = codeFiles.filter(pth=>/\.m3u8|HLS|hls|segment|manifest|playlist|\bts\b/i.test(read(pth)||''));
write(path.join(FIND,'hls_pipeline.txt'), hlsRefs.join('\n') || 'No HLS references detected');
// Large assets > 20MB
function walkFiles(dir){ const out=[]; for(const n of fs.readdirSync(dir)){ if(n==='node_modules'||n==='_reports') continue; const p=path.join(dir,n); const st=fs.statSync(p); if(st.isDirectory()) out.push(...walkFiles(p)); else out.push(p);} return out; }
const largeAssets = walkFiles(ROOT).filter(pth=>{ try { const s=fs.statSync(pth).size; return s > 20*1024*1024; } catch { return false; } }).filter(p=>!p.includes('node_modules')&&!p.includes('_reports'));
write(path.join(FIND,'assets_large.txt'), largeAssets.join('\n'));
const assetFiles = fs.existsSync(path.join(ROOT,'assets')) ? walkFiles(path.join(ROOT,'assets')):[];
const allCode = codeFiles.map(read).join('\n');
const unrefAssets = assetFiles.filter(a=>!allCode.includes(a.replace(/\\/g,'/')));
write(path.join(FIND,'assets_unreferenced.txt'), unrefAssets.join('\n'));

// Tests / Observability
if (run('npx --yes jest --version').ok) {
  write(path.join(LOGS,'jest.json'), run('npx --yes jest --ci --reporters=json --reporters=default').stdout || '');
  write(path.join(LOGS,'jest_coverage.txt'), run('npx --yes jest --coverage').stdout || '');
}
const testTools = ['e2e','__tests__','.github/workflows'].filter((p)=>fs.existsSync(path.join(ROOT,p)));
write(path.join(INV,'test_tools.txt'), testTools.join('\n'));
const obsNotes=[]; if (!has('sentry-expo') && !has('@sentry/react-native')) obsNotes.push('No Sentry deps detected.'); if (!has('@react-native-firebase/analytics') && !has('@segment/analytics-react-native')) obsNotes.push('No analytics SDK detected.');
write(path.join(FIND,'observability.txt'), obsNotes.join('\n'));
let crash='No crash reporting hints detected'; try { const aj = JSON.parse(read(path.join(ROOT,'app.json'))||'{}'); if (JSON.stringify(aj).match(/sentry|crashlytics/i)) crash='Crash reporting hints present'; } catch {}
write(path.join(FIND,'crash_reporting.txt'), crash);

// I18N / A11Y
const jsxFiles = files.filter(f=>/(tsx|jsx)$/.test(f.ext) && !/node_modules|_reports/.test(f.path)).map(f=>f.path);
let hard=0; jsxFiles.forEach(pth=>{ const t=read(pth)||''; const m=t.match(/>([^<]{10,})</g)||[]; hard += m.filter(s=>/[A-Za-z]/.test(s)).length; });
write(path.join(FIND,'i18n.txt'), `Hard-coded string chunks (rough): ${hard}`);
write(path.join(INV,'i18n_tools.txt'), has('react-i18next')? 'react-i18next present' : 'No i18n framework detected');
let a11yCount=0; jsxFiles.forEach(pth=>{ const t=read(pth)||''; a11yCount += (t.match(/accessibility(Label|Role|Hint)=/g)||[]).length; });
write(path.join(FIND,'a11y.txt'), `Accessibility props occurrences: ${a11yCount}`);

// Architecture & diagrams
write(path.join(FIND,'madge.json'), run('npx --yes madge --extensions ts,tsx,js,jsx --warning --json .').stdout || '{}');
write(path.join(FIND,'dpdm.json'), run('npx --yes dpdm --exit-code circular --reporter json .').stdout || '{}');
const boundariesCounts = { feature:0, shared:0, infra:0 };
codeFiles.forEach(f=>{ if(/src[\/](screens|components|features)/.test(f)) boundariesCounts.feature++; else if(/src[\/](lib|utils|hooks)/.test(f)) boundariesCounts.shared++; else if(/src[\/](config|services)/.test(f)) boundariesCounts.infra++; });
write(path.join(FIND,'boundaries.txt'), `Feature: ${boundariesCounts.feature}\nShared: ${boundariesCounts.shared}\nInfra: ${boundariesCounts.infra}`);

// Feature flags & store risks
const flagHits = codeFiles.filter(pth=>/(FLAG|FeatureFlag|enable|BUILD_ENABLE|EXPO_PUBLIC_)/.test(read(pth)||''));
write(path.join(FIND,'feature_flags.txt'), flagHits.join('\n'));
let storeRisks=''; try { const aj = JSON.parse(read(path.join(ROOT,'app.json'))||'{}'); const perms=((aj.expo||{}).android||{}).permissions||[]; const risks=[]; if (perms.includes('android.permission.ACCESS_BACKGROUND_LOCATION')) risks.push('Background location'); if (perms.includes('android.permission.RECORD_AUDIO')) risks.push('Microphone'); if (perms.includes('android.permission.CAMERA')) risks.push('Camera'); storeRisks = risks.join('\n'); } catch { storeRisks='app.json not parseable'; }
write(path.join(FIND,'store_policy_risks.txt'), storeRisks);

// Metrics & STATUS
const metrics = { env:{}, architecture:{}, dependencies:{}, code_quality:{}, performance:{}, build:{}, security:{}, privacy:{}, media:{}, testing_observability:{}, i18n_a11y:{}, liveops:{}, release:{}, scores:{per_area:{}} };
metrics.env.text = read(path.join(LOGS,'environment.txt'))||'';
const depcheck = jread(path.join(FIND,'depcheck.json'))||{}; const knip=jread(path.join(FIND,'knip.json'))||{}; const audit=jread(path.join(FIND,'audit.json'))||{}; const ncu=jread(path.join(FIND,'ncu.json'))||{};
let high=0,critical=0; if (audit && audit.vulnerabilities) { for (const k of Object.keys(audit.vulnerabilities)) { const v=audit.vulnerabilities[k]; const sev=(v.severity||'').toLowerCase(); if(sev==='high') high+=(v.via?.length||1); if(sev==='critical') critical+=(v.via?.length||1); } }
metrics.dependencies = { unused:(depcheck.dependencies||[]).length||0, missing:Object.keys(depcheck.missing||{}).length||0, deadExports:(knip.issues?.files?Object.keys(knip.issues.files).length:0), upgrades:Object.keys(ncu||{}).length||0, high, critical };
let eslintErr=0, eslintWarn=0; try { const arr=JSON.parse(read(path.join(LOGS,'eslint.json'))||'[]'); for (const f of arr) { eslintErr+=f.errorCount||0; eslintWarn+=f.warningCount||0; } } catch {}
const tscTxt = read(path.join(LOGS,'tsc.txt'))||''; const tscErrors=(tscTxt.match(/error TS/g)||[]).length; const strictTxt=read(path.join(FIND,'strictness.txt'))||'';
metrics.code_quality = { eslintErr, eslintWarn, tscErrors, strictness:strictTxt.trim() };
function fsize(p){ try { return fs.statSync(p).size } catch { return 0 } }
// Prefer Expo export (Hermes .hbc), else fall back to RN CLI JS bundle
const aExpoAny = readExpoExportSize('android');
const iExpoAny = readExpoExportSize('ios');
const aExpoHbc = readExpoHbcSize('android');
const iExpoHbc = readExpoHbcSize('ios');
const aExpoJs = readExpoJsSize('android');
const iExpoJs = readExpoJsSize('ios');
const aRN = fsize(path.join(TMP,'index.android.bundle'));
const iRN = fsize(path.join(TMP,'index.ios.bundle'));
// For primary display and scoring: prefer Hermes export if present, else RN CLI bundle
const aSize = (aExpoHbc || aRN || 0);
const iSize = (iExpoHbc || iRN || 0);
metrics.performance = {
  androidBytes: aSize,
  iosBytes: iSize,
  androidBytes_export: aExpoAny || 0,
  iosBytes_export: iExpoAny || 0,
  androidBytes_export_hbc: aExpoHbc || 0,
  iosBytes_export_hbc: iExpoHbc || 0,
  androidBytes_export_js: aExpoJs || 0,
  iosBytes_export_js: iExpoJs || 0,
  androidBytes_rncli: aRN || 0,
  iosBytes_rncli: iRN || 0
};
const doctor = jread(path.join(LOGS,'expo_doctor.json'))||{}; metrics.build = { expoDoctorIssues: Array.isArray(doctor.issues)?doctor.issues.length:0 };
const secretlint = jread(path.join(FIND,'secretlint.json'))||{};
const truffle = read(path.join(FIND,'trufflehog.json'))||'';
const gitleaks = jread(path.join(FIND,'gitleaks.json')) || {};
const gitleaksCount = Array.isArray(gitleaks) ? gitleaks.length : (Array.isArray(gitleaks.findings) ? gitleaks.findings.length : 0);
const truffleCount = truffle.split('\n').filter(Boolean).length;
const grep = read(path.join(FIND,'secret_grep.txt'))||'';
metrics.security = {
  secretlintFindings: Array.isArray(secretlint.results)?secretlint.results.length:0,
  gitleaksFindings: gitleaksCount,
  trufflehogLines: truffleCount,
  grepHits: grep.split('\n').filter(Boolean).length
};
const pii = read(path.join(FIND,'pii_scan.txt'))||''; const rules = read(path.join(FIND,'firebase_rules_report.txt'))||''; const dataLife = read(path.join(FIND,'data_lifecycle.txt'))||'';
metrics.privacy = { piiHits: pii.split('\n').filter(Boolean).length, rulesFindings: rules?1:0, lifecycleHints: dataLife.split('\n').filter(Boolean).length };
const largeTxt = read(path.join(FIND,'assets_large.txt'))||''; const unrefTxt = read(path.join(FIND,'assets_unreferenced.txt'))||'';
metrics.media = { largeAssets: largeTxt.split('\n').filter(Boolean).length, unreferenced: unrefTxt.split('\n').filter(Boolean).length };
const jestJson = read(path.join(LOGS,'jest.json'))||'';
const jestCov = read(path.join(LOGS,'jest_coverage.txt'))||'';
const jestRun = (jestJson.trim().length>0) || (jestCov.trim().length>0);
const obsText = read(path.join(FIND,'observability.txt'))||'';
metrics.testing_observability = { jestRun, observability: obsText.trim() };
const i18nText = read(path.join(FIND,'i18n.txt'))||''; const a11yText = read(path.join(FIND,'a11y.txt'))||''; const i18nTools = read(path.join(INV,'i18n_tools.txt'))||'';
metrics.i18n_a11y = { i18n: i18nText.trim(), a11y: a11yText.trim(), i18nTools: i18nTools.trim() };
const madge = jread(path.join(FIND,'madge.json'))||{}; const dpdm=jread(path.join(FIND,'dpdm.json'))||{}; const cycles=(dpdm?.circular?.length)||0; const boundaries = read(path.join(FIND,'boundaries.txt'))||'';
metrics.architecture = { cycles, modulesAnalyzed:Object.keys(madge).length, boundaries:boundaries.trim() };
const flagsCount = (read(path.join(FIND,'feature_flags.txt'))||'').split('\n').filter(Boolean).length; metrics.liveops = { flagsCount };
const storeRisk = read(path.join(FIND,'store_policy_risks.txt'))||''; metrics.release = { storeRisks: storeRisk.trim() };
const clamp = (v)=>Math.max(0,Math.min(100,Math.round(v)));
function lerp(x, x0, x1, y0, y1){ if (x<=x0) return y0; if (x>=x1) return y1; return y0 + (y1-y0)*((x-x0)/(x1-x0)); }
function perfScore(bytes){
  if (!bytes || bytes<=0) return 50; // unknown
  // Piecewise curve with sensitivity in 5.5–7MB band
  const MB = 1024*1024;
  if (bytes <= 4*MB) return 100;
  if (bytes <= 4.5*MB) return lerp(bytes, 4*MB, 4.5*MB, 100, 95);
  if (bytes <= 5.5*MB) return lerp(bytes, 4.5*MB, 5.5*MB, 95, 90);
  if (bytes <= 7*MB) return lerp(bytes, 5.5*MB, 7*MB, 90, 75);
  if (bytes <= 9*MB) return lerp(bytes, 7*MB, 9*MB, 75, 55);
  return Math.max(20, Math.round(55 - ((bytes - 9*MB)/(5*MB))*35));
}
const s = {};
s.Architecture = clamp((cycles===0?100:Math.max(20,100-20*cycles)));
// Score against measured initial payload using Export (Hermes) for fairness, with nuanced curve.
s.Performance = clamp(perfScore(aExpoHbc || aRN));
// SecurityPrivacy scoring: rely on deterministic scanners (gitleaks, secretlint); grepHits is informational only
const secPenalty = ((metrics.security.secretlintFindings||0)*10 + (metrics.security.gitleaksFindings||0)*25);
// Privacy penalty: focus on concrete rules misconfigurations; treat piiHits as informational
const privPenalty = (metrics.privacy.rulesFindings*50);
s.SecurityPrivacy = clamp(100 - (secPenalty + privPenalty));
s.Build = clamp(100 - (metrics.build.expoDoctorIssues*15));
const depPenalty = (metrics.dependencies.unused*2 + metrics.dependencies.missing*20 + metrics.dependencies.high*5 + metrics.dependencies.critical*15);
s.Dependencies = clamp(100 - depPenalty);
s.Media = clamp(100 - (metrics.media.largeAssets*10 + metrics.media.unreferenced*2));
s.TestsObs = clamp( (jestRun?90:60) - (obsText?0:10) );
s.I18nA11y = clamp(70);
s.LiveOps = clamp( flagsCount>0 ? 85 : 60 );
const weights = { Architecture:20, Performance:20, SecurityPrivacy:20, Build:10, Dependencies:10, Media:5, TestsObs:10, I18nA11y:3, LiveOps:2 };
let overall=0, wsum=0; Object.keys(weights).forEach((k)=>{ overall += (s[k]||0)*weights[k]; wsum += weights[k]; metrics.scores.per_area[k]=s[k]; });
metrics.scores.overall = clamp(overall/wsum);
const P0=[],P1=[],P2=[];
if(gitleaksCount>0 || (!fs.existsSync(path.join(FIND,'gitleaks.json')) && truffleCount>0)) {
  P0.push('Potential secrets in repo (secrets scan).');
}
if(metrics.privacy.rulesFindings>0) P0.push('Firestore rules may allow unsafe access.');
if(metrics.dependencies.critical>0) P0.push('Critical dependency vulnerabilities.');
if(((aExpoHbc||aRN)||0)>2000000) P1.push('Bundle above target (export)');
if(metrics.dependencies.unused>10) P2.push('High unused dependency count.');
if(metrics.build.expoDoctorIssues>0) P1.push('Expo Doctor reported issues');
if(!jestRun) P2.push('No Jest test run detected');
const GO = (metrics.scores.overall>=85 && P0.length===0) ? 'GO' : 'NO-GO';
write(path.join(BASE,'metrics.json'), JSON.stringify(metrics,null,2));
const status = [
  '# Production Readiness - STATUS','',
  `Overall Score: ${metrics.scores.overall} / 100`,
  `Decision: **${GO}**`,'',
  '## P0 - Stop-Ship', P0.length?P0.map(x=>`- ${x}`).join('\n'):'- None detected','',
  '## P1 - Next Sprint', P1.length?P1.map(x=>`- ${x}`).join('\n'):'- Minimal','',
  '## P2 - Backlog', P2.length?P2.map(x=>`- ${x}`).join('\n'):'- Minimal','',
  '## Notable Metrics',
  `- Android bundle bytes (export-preferred): ${aSize||0}`,
  `- iOS bundle bytes (export-preferred): ${iSize||0}`,
  `- ESLint errors: ${metrics.code_quality.eslintErr}, warnings: ${metrics.code_quality.eslintWarn}`,
  `- TS errors: ${metrics.code_quality.tscErrors}`,
  `- Unused deps: ${metrics.dependencies.unused}, Missing deps: ${metrics.dependencies.missing}`,
  `- Vulnerabilities (H/C): ${metrics.dependencies.high}/${metrics.dependencies.critical}`,'',
  '## Performance (bytes)',
  `- Export (Hermes bytecode): Android=${aExpoHbc||0}, iOS=${iExpoHbc||0}`,
  `- Export (JS): Android=${aExpoJs||0}, iOS=${iExpoJs||0}`,
  `- RN CLI: Android=${aRN||0}, iOS=${iRN||0}`,
  '## Evidence Paths',
  '- Logs: _reports/prod_audit_v2/logs',
  '- Inventory: _reports/prod_audit_v2/inventory',
  '- Findings: _reports/prod_audit_v2/findings',
  '- Diagrams: _reports/prod_audit_v2/diagrams'
].join('\n');
write(path.join(BASE, 'STATUS.md'), status);

console.log('Audit complete. See _reports/prod_audit_v2/STATUS.md');
