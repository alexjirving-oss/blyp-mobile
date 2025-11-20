#!/usr/bin/env bash
set -euo pipefail

# Production Readiness Audit (read-only). Outputs to _reports/prod_audit_v2
# Never writes to package.json or app sources. Continues on errors.

ROOT="$(pwd)"
BASE_DIR="${ROOT}/_reports/prod_audit_v2"
LOGS="${BASE_DIR}/logs"
INV="${BASE_DIR}/inventory"
FIND="${BASE_DIR}/findings"
DIAG="${BASE_DIR}/diagrams"
TMP="${BASE_DIR}/tmp"
mkdir -p "$LOGS" "$INV" "$FIND" "$DIAG" "$TMP"

# Helper to run commands without failing the whole audit
run() { echo -e "\n>>> $*"; (eval "$*") || true; }

# Detect package manager
if command -v pnpm >/dev/null 2>&1; then PKG=pnpm
elif command -v yarn >/dev/null 2>&1; then PKG=yarn
else PKG=npm
fi

# Environment snapshot
{
  echo "PKG=$PKG"
  echo "Node=$(node -v 2>/dev/null || echo none)"
  echo "NPM=$(npm -v 2>/dev/null || echo none)"
  echo "Yarn=$(yarn -v 2>/dev/null || echo none)"
  echo "PNPM=$(pnpm -v 2>/dev/null || echo none)"
  echo "OS=$(uname -a 2>/dev/null || echo Windows)"
  echo "Java=$(java -version 2>&1 | head -n1 || true)"
  echo "Gradle=$([ -f ./gradlew ] && ./gradlew -v 2>/dev/null | head -n5 | tr -d '\r' || echo none)"
} > "$LOGS/environment.txt"

# 1) INVENTORY
node > "$INV/tree.json" << 'NODE'
const fs=require("fs"),path=require("path");
function walk(dir){
  const out=[];
  for(const f of fs.readdirSync(dir,{withFileTypes:true})){
    if(f.name==="_reports"||f.name==="node_modules") continue;
    const p=path.join(dir,f.name);
    try{
      const s=fs.statSync(p);
      if(s.isDirectory()) out.push(...walk(p));
      else out.push({path:p,ext:path.extname(f.name).slice(1),bytes:s.size});
    }catch(e){}
  }
  return out;
}
const list=walk(process.cwd());
fs.writeFileSync(1,JSON.stringify({count:list.length,files:list},null,2));
NODE

node << "NODE" > "$INV/by_ext.json"
const fs=require('fs');
const inv=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const byExt={}; inv.files.forEach(f=>byExt[f.ext]=(byExt[f.ext]||0)+1);
fs.writeFileSync(process.argv[2],JSON.stringify(byExt,null,2));
NODE "$INV/tree.json" "$INV/by_ext.json"

node << "NODE" > "$INV/top50_large_files.json"
const fs=require('fs');
const inv=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const top=[...inv.files].sort((a,b)=>b.bytes-a.bytes).slice(0,50);
fs.writeFileSync(process.argv[2],JSON.stringify(top,null,2));
NODE "$INV/tree.json" "$INV/top50_large_files.json"

node << "NODE" > "$INV/features.json"
const fs=require('fs'); let pkg={};
try{pkg=JSON.parse(fs.readFileSync('package.json','utf8'))}catch{}
const deps={...pkg.dependencies,...pkg.devDependencies};
function has(k){return !!deps && Object.prototype.hasOwnProperty.call(deps,k)}
const features={
  expo: has('expo'),
  reactNative: has('react-native'),
  navigation: has('@react-navigation/native'),
  gestureHandler: has('react-native-gesture-handler'),
  reanimated: has('react-native-reanimated'),
  hlsLibs: ['hls.js','react-native-video','expo-av'].filter(has),
  auth: ['amazon-cognito-identity-js','@aws-amplify/auth','firebase'].filter(has),
  analytics: ['@react-native-firebase/analytics','@segment/analytics-react-native','sentry-expo','@sentry/react-native'].filter(has)
};
fs.writeFileSync(1,JSON.stringify(features,null,2));
NODE

node << "NODE" > "$INV/key_configs.json"
const fs=require('fs');
const wanted=[
 'package.json','pnpm-lock.yaml','yarn.lock','package-lock.json',
 'app.json','app.config.js','app.config.ts','eas.json',
 'babel.config.js','metro.config.js','tsconfig.json','jsconfig.json',
 '.eslintrc','.eslintrc.js','.eslintrc.cjs','.eslintrc.json',
 '.prettierrc','.prettierrc.js','.prettierrc.json','.editorconfig',
 'firebase.json','firestore.rules','storage.rules','firestore.indexes.json',
 'android/gradle.properties','android/build.gradle','android/app/build.gradle'
];
const found=wanted.filter(p=>{try{return fs.existsSync(p)}catch{return false}});
fs.writeFileSync(1,JSON.stringify({found},null,2));
NODE

# 2) DEPENDENCIES
run "npx --yes depcheck --json > '$FIND/depcheck.json'"
run "npx --yes knip --reporter json > '$FIND/knip.json'"
run "npx --yes npm-check-updates --errorLevel 0 --jsonUpgraded > '$FIND/ncu.json'"
case "$PKG" in
  pnpm) run "pnpm audit --json > '$FIND/audit.json'";;
  yarn) run "yarn audit --json > '$FIND/audit.json'";;
  npm)  run "npm audit --json > '$FIND/audit.json'";;
esac
run "$PKG ls --all > '$LOGS/npm_tree.txt'"

# 3) CODE QUALITY & TYPES
if [ -f ".eslintrc" ] || ls .eslintrc.* >/dev/null 2>&1; then
  run "npx --yes eslint . -f json > '$LOGS/eslint.json'"
fi
if [ -f "package.json" ]; then
  run "npx --yes prettier . --check > '$LOGS/prettier.txt'"
fi
if [ -f "tsconfig.json" ]; then
  run "npx --yes tsc --noEmit > '$LOGS/tsc.txt'"
else
  if [ -f "jsconfig.json" ]; then run "npx --yes tsc --allowJs --checkJs --noEmit > '$LOGS/tsc_checkjs.txt'"; fi
fi
node << 'NODE' > "$FIND/strictness.txt"
const fs=require('fs'),globs=require('glob');
const files=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
let anyCount=0, tsIgnore=0, disabled=0;
for(const f of files){const t=fs.readFileSync(f,'utf8'); anyCount+=(t.match(/:\s*any\b/g)||[]).length; tsIgnore+=(t.match(/@ts-ignore/g)||[]).length; disabled+=(t.match(/eslint-disable/g)||[]).length; }
console.log(`any annotations: ${anyCount}\n@ts-ignore: ${tsIgnore}\neslint-disable: ${disabled}`);
NODE

# 4) PERFORMANCE (BUNDLE)
ENTRY="App.js"; [ -f "index.js" ] && ENTRY="index.js"; [ -f "index.ts" ] && ENTRY="index.ts"
run "npx --yes react-native --version > '$LOGS/rn_version.txt'"
run "npx --yes react-native bundle --platform android --dev false --entry-file $ENTRY --bundle-output '$TMP/index.android.bundle' --sourcemap-output '$TMP/index.android.map' --assets-dest '$TMP/assets'"
run "npx --yes react-native bundle --platform ios --dev false --entry-file $ENTRY --bundle-output '$TMP/index.ios.bundle' --sourcemap-output '$TMP/index.ios.map' --assets-dest '$TMP/assets'"
run "npx --yes source-map-explorer '$TMP/index.android.bundle' '$TMP/index.android.map' --json > '$FIND/sme.android.json'"
run "npx --yes source-map-explorer '$TMP/index.ios.bundle' '$TMP/index.ios.map' --json > '$FIND/sme.ios.json'"

# Perf heuristics
node << 'NODE' > "$FIND/perf_bundle.txt"
const fs=require('fs');
function note(p){try{return fs.statSync(p).size}catch{return 0}}
const a=note(process.cwd()+"/_reports/prod_audit_v2/tmp/index.android.bundle");
const i=note(process.cwd()+"/_reports/prod_audit_v2/tmp/index.ios.bundle");
console.log(`Android bundle bytes: ${a}`);
console.log(`iOS bundle bytes: ${i}`);
console.log(a>1200000?"Android bundle exceeds 1.2MB target (pre-Hermes).":"Android bundle within target or unavailable.");
NODE
echo "Hermes note: RN Hermes bytecode reduces JS bundle; actual on-device size differs." > "$FIND/hermes_notes.txt"

# 5) BUILD & TOOLING HEALTH
run "npx --yes expo-doctor --json > '$LOGS/expo_doctor.json'"
run "[ -f ./gradlew ] && ./gradlew -v > '$LOGS/gradle_version.txt' || echo 'No gradle wrapper' > '$LOGS/gradle_version.txt'"
node << 'NODE' > "$FIND/metro.txt"
const fs=require('fs'); let t=''; try{t=fs.readFileSync('metro.config.js','utf8')}catch{}
const notes=[]; if(!t) notes.push('No custom metro.config.js found (OK).');
if(t && !/inlineRequires\s*:\s*true/.test(t)) notes.push('Consider inlineRequires:true for faster startup.');
console.log(notes.join("\n"));
NODE

# 6) SECURITY & SECRETS
run "npx --yes @secretlint/secretlint -f json . > '$FIND/secretlint.json'"
run "npx --yes trufflehog filesystem --no-update --json . > '$FIND/trufflehog.json'"
node << 'NODE' > "$FIND/secret_grep.txt"
const fs=require('fs'),globs=require('glob');
const pats=/(api[_-]?key|secret|token|bearer|Authorization:|GOOGLE_|AWS_|EXPO_PUBLIC_|FIREBASE_)/i;
const files=globs.sync('**/*',{ignore:['node_modules/**','_reports/**'],nodir:true});
for(const f of files){try{const s=fs.statSync(f); if(s.size>2*1024*1024) continue; const t=fs.readFileSync(f,'utf8'); if(pats.test(t)) console.log(f);}catch{}}
NODE
node << 'NODE' > "$FIND/permissions_android.txt"
const fs=require('fs'); try{const t=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8'); console.log((t.match(/uses-permission[^>]+/g)||[]).join("\n"))}catch{console.log('Manifest not found')}
NODE
node << 'NODE' > "$FIND/permissions_ios.txt"
const fs=require('fs'),glob=require('glob'); const p=glob.sync('ios/**/*Info.plist')[0]; if(!p){console.log('Info.plist not found');process.exit(0)} const t=fs.readFileSync(p,'utf8'); console.log((t.match(/NS[A-Za-z]+UsageDescription/g)||[]).join('\n'))
NODE

# 7) PRIVACY
node << 'NODE' > "$FIND/pii_scan.txt"
const fs=require('fs'),globs=require('glob'); const pii=/(email|phone|gps|location|contacts|deviceId|advertisingId|idfa|gaid)/i;
const files=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
for(const f of files){const t=fs.readFileSync(f,'utf8'); if(pii.test(t)) console.log(f)}
NODE
node << 'NODE' > "$FIND/env_keys.txt"
const fs=require('fs'),globs=require('glob'); const files=globs.sync('.env*',{nodir:true}); for(const f of files){console.log(f)}
NODE
node << 'NODE' > "$FIND/firebase_rules_report.txt"
const fs=require('fs'); try{ const r=fs.readFileSync('firestore.rules','utf8'); if(/allow\s+read,\s*write:\s*if\s*true\s*;/.test(r)) console.log('DANGER: open read/write in firestore.rules'); if(!/request\.auth/.test(r)) console.log('No request.auth checks detected.')}catch{}
NODE
node << 'NODE' > "$FIND/data_lifecycle.txt"
const fs=require('fs'),globs=require('glob'); const files=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
let hits=[]; for(const f of files){const t=fs.readFileSync(f,'utf8'); if(/TTL|expire|retention|cleanup|prune|delete/i.test(t)) hits.push(f)}
console.log(hits.join('\n'))
NODE

# 8) STREAMING & MEDIA
node << 'NODE' > "$FIND/hls_pipeline.txt"
const fs=require('fs'),globs=require('glob');
const files=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
const hits=files.filter(f=>/\.m3u8|HLS|hls|segment|manifest|playlist|ts\b/i.test(fs.readFileSync(f,'utf8')));
console.log(hits.join('\n')||'No HLS references detected')
NODE
run "find . -type f -size +20M -not -path '*/node_modules/*' -not -path '*/_reports/*' > '$FIND/assets_large.txt'"
node << 'NODE' > "$FIND/assets_unreferenced.txt"
const fs=require('fs'),globs=require('glob'); const assets=globs.sync('assets/**/*',{nodir:true});
const code=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']}).map(f=>fs.readFileSync(f,'utf8')).join('\n');
for(const a of assets){ if(!code.includes(a.replace(/\\/g,'/'))) console.log(a) }
NODE

# 9) TESTS / OBSERVABILITY
if npx --yes jest --version >/dev/null 2>&1; then
  run "npx --yes jest --ci --reporters=json --reporters=default > '$LOGS/jest.json'"
  run "npx --yes jest --coverage > '$LOGS/jest_coverage.txt'"
fi
node << 'NODE' > "$INV/test_tools.txt"
const fs=require('fs'); const paths=['e2e','__tests__','.github/workflows'];
console.log(paths.filter(p=>{try{return fs.existsSync(p)}catch{return false}}).join('\n'))
NODE
node << 'NODE' > "$FIND/observability.txt"
const fs=require('fs'); let pkg={}; try{pkg=require('./package.json')}catch{}
const deps={...pkg.dependencies,...pkg.devDependencies};
const observ=[]; if(!deps||(!deps['sentry-expo']&&!deps['@sentry/react-native'])) observ.push('No Sentry deps detected.');
if(!deps||(!deps['@react-native-firebase/analytics']&&!deps['@segment/analytics-react-native'])) observ.push('No analytics SDK detected.');
console.log(observ.join('\n'))
NODE
node << 'NODE' > "$FIND/crash_reporting.txt"
const fs=require('fs'); let t=''; try{t=fs.readFileSync('app.json','utf8')}catch{}
console.log(/sentry|crashlytics/i.test(t)?'Crash reporting hints present':'No crash reporting hints detected')
NODE

# 10) I18N / A11Y
node << 'NODE' > "$FIND/i18n.txt"
const fs=require('fs'),globs=require('glob');
const files=globs.sync('**/*.{tsx,jsx}',{ignore:['node_modules/**','_reports/**']});
let hard=0; for(const f of files){const t=fs.readFileSync(f,'utf8'); const m=t.match(/>([^<]{10,})</g)||[]; hard+=m.filter(s=>/[A-Za-z]/.test(s)).length;}
console.log(`Hard-coded string chunks (rough): ${hard}`)
NODE
node << 'NODE' > "$INV/i18n_tools.txt"
const fs=require('fs'); let pkg={}; try{pkg=require('./package.json')}catch{}
const deps={...pkg.dependencies,...pkg.devDependencies};
console.log(deps&&deps['react-i18next']? 'react-i18next present':'No i18n framework detected');
NODE
node << 'NODE' > "$FIND/a11y.txt"
const fs=require('fs'),globs=require('glob'); const files=globs.sync('**/*.{tsx,jsx}',{ignore:['node_modules/**','_reports/**']});
let lbl=0; for(const f of files){const t=fs.readFileSync(f,'utf8'); lbl += (t.match(/accessibility(Label|Role|Hint)=/g)||[]).length;}
console.log(`Accessibility props occurrences: ${lbl}`)
NODE

# 11) ARCHITECTURE & DIAGRAMS
run "npx --yes madge --extensions ts,tsx,js,jsx --warning --json . > '$FIND/madge.json'"
run "npx --yes dpdm --exit-code circular --reporter json . > '$FIND/dpdm.json'"
if command -v dot >/dev/null 2>&1; then
  run "npx --yes madge --extensions ts,tsx,js,jsx --image '$DIAG/architecture.svg' ."
fi
node << 'NODE' > "$FIND/boundaries.txt"
const fs=require('fs'),globs=require('glob');
const files=globs.sync('src/**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
const areas={feature:0,shared:0,infra:0};
files.forEach(f=>{ if(/src\/screens|src\/components|src\/features/.test(f)) areas.feature++; else if(/src\/lib|src\/utils|src\/hooks/.test(f)) areas.shared++; else if(/src\/config|src\/services/.test(f)) areas.infra++; });
console.log(`Feature: ${areas.feature}\nShared: ${areas.shared}\nInfra: ${areas.infra}`)
NODE

# 12) FEATURE FLAGS & LIVE-OPS
node << 'NODE' > "$FIND/feature_flags.txt"
const fs=require('fs'),globs=require('glob');
const files=globs.sync('**/*.{ts,tsx,js,jsx}',{ignore:['node_modules/**','_reports/**']});
let lines=[]; for(const f of files){const t=fs.readFileSync(f,'utf8'); if(/FLAG|FeatureFlag|enable|BUILD_ENABLE|EXPO_PUBLIC_/.test(t)) lines.push(f)}
console.log(lines.join('\n'))
NODE

# 12b) STORE POLICY RISKS
node << 'NODE' > "$FIND/store_policy_risks.txt"
const fs=require('fs'); let risks=[]; try{const a=JSON.parse(fs.readFileSync('app.json','utf8')); const perms=(a.expo||{}).android?.permissions||[]; if(perms.includes('android.permission.ACCESS_BACKGROUND_LOCATION')) risks.push('Background location'); if(perms.includes('android.permission.RECORD_AUDIO')) risks.push('Microphone'); if(perms.includes('android.permission.CAMERA')) risks.push('Camera'); console.log(risks.join('\n')); }catch{console.log('app.json not parseable')}
NODE

# 13) METRICS + STATUS
node << 'NODE'
const fs=require('fs'); const path=(p)=>{try{return fs.readFileSync(p,'utf8')}catch{return null}};
const json=(p)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}};
const BASE=process.cwd()+"/_reports/prod_audit_v2";
const LOGS=BASE+"/logs", FIND=BASE+"/findings", INV=BASE+"/inventory", TMP=BASE+"/tmp", DIAG=BASE+"/diagrams";
const metrics={ env:{}, architecture:{}, dependencies:{}, code_quality:{}, performance:{}, build:{}, security:{}, privacy:{}, media:{}, testing_observability:{}, i18n_a11y:{}, liveops:{}, release:{}, scores:{per_area:{}} };

metrics.env.text = (path(LOGS+"/environment.txt")||"");

// Dependencies
const depcheck=json(FIND+"/depcheck.json")||{}; const knip=json(FIND+"/knip.json")||{}; const audit=json(FIND+"/audit.json")||{}; const ncu=json(FIND+"/ncu.json")||{};
let high=0,critical=0; if(audit && audit.vulnerabilities){ for(const k of Object.keys(audit.vulnerabilities)){ const v=audit.vulnerabilities[k]; const sev=(v.severity||'').toLowerCase(); if(sev==='high') high+= (v.via?.length||1); if(sev==='critical') critical+=(v.via?.length||1); } }
metrics.dependencies={ unused:(depcheck.dependencies||[]).length||0, missing:Object.keys(depcheck.missing||{}).length||0, deadExports:(knip.issues?.files?Object.keys(knip.issues.files).length:0), upgrades:Object.keys(ncu||{}).length||0, high, critical };

// Code quality
let eslintErr=0, eslintWarn=0; try{ const arr=JSON.parse(path(LOGS+"/eslint.json")||"[]"); for(const f of arr){ eslintErr+=f.errorCount||0; eslintWarn+=f.warningCount||0; } }catch{}
const tscTxt=path(LOGS+"/tsc.txt")||""; const tscErrors=(tscTxt.match(/error TS/g)||[]).length;
const strictTxt=path(FIND+"/strictness.txt")||"";
metrics.code_quality={eslintErr, eslintWarn, tscErrors, strictness:strictTxt.trim()};

// Performance
function fsize(p){ try{ return fs.statSync(p).size }catch{ return 0 } }
const aSize=fsize(TMP+"/index.android.bundle"), iSize=fsize(TMP+"/index.ios.bundle");
metrics.performance={androidBytes:aSize, iosBytes:iSize};

// Build
const doctor=json(LOGS+"/expo_doctor.json")||{}; metrics.build={expoDoctorIssues:Array.isArray(doctor.issues)?doctor.issues.length:0};

// Security
const secretlint=json(FIND+"/secretlint.json")||{}; const truffle=path(FIND+"/trufflehog.json")||""; const grep=path(FIND+"/secret_grep.txt")||"";
metrics.security={ secretlintFindings:Array.isArray(secretlint.results)?secretlint.results.length:0, trufflehogLines: truffle.split('\n').filter(Boolean).length, grepHits: grep.split('\n').filter(Boolean).length };

// Privacy
const pii=path(FIND+"/pii_scan.txt")||""; const rules=path(FIND+"/firebase_rules_report.txt")||""; const dataLife=path(FIND+"/data_lifecycle.txt")||"";
metrics.privacy={piiHits: pii.split('\n').filter(Boolean).length, rulesFindings: rules?1:0, lifecycleHints: dataLife.split('\n').filter(Boolean).length };

// Media
const large=path(FIND+"/assets_large.txt")||""; const unref=path(FIND+"/assets_unreferenced.txt")||"";
metrics.media={largeAssets: large.split('\n').filter(Boolean).length, unreferenced: unref.split('\n').filter(Boolean).length};

// Testing/Observability
const jest=path(LOGS+"/jest.json")||""; const obs=path(FIND+"/observability.txt")||""; const crash=path(FIND+"/crash_reporting.txt")||""; const tests=path(INV+"/test_tools.txt")||"";
metrics.testing_observability={jestRun: !!jest, observability: obs.trim(), crash: crash.trim(), testTools: tests.trim()};

// i18n/a11y
const i18n=path(FIND+"/i18n.txt")||""; const a11y=path(FIND+"/a11y.txt")||""; const i18nTools=path(INV+"/i18n_tools.txt")||"";
metrics.i18n_a11y={i18n:i18n.trim(), a11y:a11y.trim(), i18nTools:i18nTools.trim()};

// Architecture
const madge=json(FIND+"/madge.json")||{}; const dpdm=json(FIND+"/dpdm.json")||{}; const cycles=(dpdm?.circular?.length)||0; const boundaries=path(FIND+"/boundaries.txt")||"";
metrics.architecture={cycles, modulesAnalyzed:Object.keys(madge).length, boundaries:boundaries.trim()};

// LiveOps / Flags
const flags=path(FIND+"/feature_flags.txt")||""; metrics.liveops={flagsCount: flags.split('\n').filter(Boolean).length};

// Release
const store=path(FIND+"/store_policy_risks.txt")||""; const npmTree=path(LOGS+"/npm_tree.txt")?true:false;
metrics.release={storeRisks: store.trim(), npmTree: !!npmTree};

// Scoring with weights: Arch 20, Perf 20, Sec/Priv 20, Build 10, Deps 10, Media 5, Tests 10, i18n/a11y 3, LiveOps 2
function clamp(v){return Math.max(0,Math.min(100,Math.round(v)))}
const s={};
s.Architecture = clamp((cycles===0?100:Math.max(20,100-20*cycles)));
s.Performance = clamp( (aSize? (aSize<1.2e6?100: Math.max(20, 120 - (aSize/1e4))) : 60) );
const secPenalty = (metrics.security.secretlintFindings*10 + metrics.security.trufflehogLines*5 + metrics.security.grepHits*3);
const privPenalty = (metrics.privacy.piiHits*3 + metrics.privacy.rulesFindings*50);
s.SecurityPrivacy = clamp(100 - (secPenalty + privPenalty));
s.Build = clamp(100 - (metrics.build.expoDoctorIssues*15));
const depPenalty = (metrics.dependencies.unused*2 + metrics.dependencies.missing*20 + metrics.dependencies.high*5 + metrics.dependencies.critical*15);
s.Dependencies = clamp(100 - depPenalty);
s.Media = clamp(100 - (metrics.media.largeAssets*10 + metrics.media.unreferenced*2));
s.TestsObs = clamp( (metrics.testing_observability.jestRun?90:60) - (metrics.testing_observability.observability?0:10) );
s.I18nA11y = clamp(70); // heuristic baseline
s.LiveOps = clamp( metrics.liveops.flagsCount>0 ? 85 : 60 );

const weights={Architecture:20,Performance:20,SecurityPrivacy:20,Build:10,Dependencies:10,Media:5,TestsObs:10,I18nA11y:3,LiveOps:2};
let overall=0, wsum=0; for(const k of Object.keys(weights)){ overall += (s[k]||0)*weights[k]; wsum += weights[k]; metrics.scores.per_area[k]=s[k]; }
metrics.scores.overall = clamp(overall/wsum);

// P0/P1/P2
const P0=[]; const P1=[]; const P2=[];
if(metrics.security.trufflehogLines>0) P0.push('Potential secrets in repo (trufflehog).');
if(metrics.privacy.rulesFindings>0) P0.push('Firestore rules may allow unsafe access.');
if(metrics.dependencies.critical>0) P0.push('Critical dependency vulnerabilities.');
if((aSize||0)>2.5e6) P1.push('Android bundle size very large (>2.5MB).');
if(metrics.dependencies.unused>10) P2.push('High unused dependency count.');
if(metrics.build.expoDoctorIssues>0) P1.push('Expo Doctor reported issues');
if(!metrics.testing_observability.jestRun) P2.push('No Jest test run detected');

const GO = (metrics.scores.overall>=85 && P0.length===0) ? 'GO' : 'NO-GO';

// Write metrics.json
fs.writeFileSync(BASE+"/metrics.json", JSON.stringify(metrics,null,2));

// STATUS.md
const lines=[]; lines.push('# Production Readiness - STATUS'); lines.push('');
lines.push(`Overall Score: ${metrics.scores.overall} / 100`); lines.push(`Decision: **${GO}**`); lines.push('');
lines.push('## P0 - Stop-Ship'); lines.push(P0.length?P0.map(x=>`- ${x}`).join('\n'):'- None detected'); lines.push('');
lines.push('## P1 - Next Sprint'); lines.push(P1.length?P1.map(x=>`- ${x}`).join('\n'):'- Minimal'); lines.push('');
lines.push('## P2 - Backlog'); lines.push(P2.length?P2.map(x=>`- ${x}`).join('\n'):'- Minimal'); lines.push('');
lines.push('## Notable Metrics');
lines.push(`- Android bundle bytes: ${aSize||0}`);
lines.push(`- iOS bundle bytes: ${iSize||0}`);
lines.push(`- ESLint errors: ${metrics.code_quality.eslintErr}, warnings: ${metrics.code_quality.eslintWarn}`);
lines.push(`- TS errors: ${metrics.code_quality.tscErrors}`);
lines.push(`- Unused deps: ${metrics.dependencies.unused}, Missing deps: ${metrics.dependencies.missing}`);
lines.push(`- Vulnerabilities (H/C): ${metrics.dependencies.high}/${metrics.dependencies.critical}`);
lines.push('');
lines.push('## Evidence Paths');
lines.push(`- Logs: _reports/prod_audit_v2/logs`);
lines.push(`- Inventory: _reports/prod_audit_v2/inventory`);
lines.push(`- Findings: _reports/prod_audit_v2/findings`);
lines.push(`- Diagrams: _reports/prod_audit_v2/diagrams`);
fs.writeFileSync(BASE+"/STATUS.md", lines.join('\n'));

console.log('Audit complete. See _reports/prod_audit_v2/STATUS.md');
NODE

echo "? Audit script finished"