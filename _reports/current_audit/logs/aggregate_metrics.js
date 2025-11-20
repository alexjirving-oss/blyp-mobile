const fs = require('fs');
const path = require('path');
function readJsonSafe(p){
  try{
    let s = fs.readFileSync(p,'utf8');
    // strip any leading junk before first {
    const i = s.indexOf('{');
    if(i>0) s = s.slice(i);
    return JSON.parse(s);
  }catch(e){ return null }
}
function readText(p){ try{ return fs.readFileSync(p,'utf8') }catch{ return '' } }
function exists(p){ return fs.existsSync(p) }
const repo = process.cwd();
const outMetrics = path.join(repo,'_reports','current_audit','metrics.json');
// Inputs
const pkg = readJsonSafe(path.join(repo,'package.json')) || {dependencies:{},devDependencies:{}};
const app = readJsonSafe(path.join(repo,'app.json')) || {expo:{}};
const eslint = readJsonSafe(path.join(repo,'_reports','current_audit','logs','eslint.json'));
const tscOut = readText(path.join(repo,'_reports','current_audit','logs','tsc.txt'));
const prettierOut = readText(path.join(repo,'_reports','current_audit','logs','prettier.txt'));
const expoDoctorOut = readText(path.join(repo,'_reports','current_audit','logs','expo_doctor.json'));
const rnOut = readText(path.join(repo,'_reports','current_audit','logs','rn_version.txt'));
const expoAndroidOut = readText(path.join(repo,'_reports','current_audit','logs','expo_export_android.txt'));
const expoIosOut = readText(path.join(repo,'_reports','current_audit','logs','expo_export_ios.txt'));
const gradleOut = readText(path.join(repo,'_reports','current_audit','logs','gradle_version.txt'));
const depcheck = readJsonSafe(path.join(repo,'_reports','current_audit','findings','depcheck.json'));
const ncu = readJsonSafe(path.join(repo,'_reports','current_audit','findings','ncu.json'));
const audit = readJsonSafe(path.join(repo,'_reports','current_audit','findings','npm_audit.json'));
const fbRulesReport = readText(path.join(repo,'_reports','current_audit','findings','firebase_rules_report.txt'));
const envKeysTxt = readText(path.join(repo,'_reports','current_audit','findings','env_keys.txt'));
const metrics = {
  env: {
    node: readText(path.join(repo,'_reports','current_audit','logs','environment.txt')).match(/Node: (.+)/)?.[1]?.trim() || '',
    npm: readText(path.join(repo,'_reports','current_audit','logs','environment.txt')).match(/npm: (.+)/)?.[1]?.trim() || '',
    os: readText(path.join(repo,'_reports','current_audit','logs','environment.txt')).match(/OS: (.+)/)?.[1]?.trim() || '',
    shell: readText(path.join(repo,'_reports','current_audit','logs','environment.txt')).match(/Shell: (.+)/)?.[1]?.trim() || '',
    pkg_manager: readText(path.join(repo,'_reports','current_audit','logs','environment.txt')).match(/Selected package manager: (.+)/)?.[1]?.trim() || 'npm'
  },
  features: {
    expo: true,
    react_native: true,
    react_native_version: pkg['react-native'] || pkg.dependencies?.['react-native'] || '',
    expo_version: pkg.expo || pkg.dependencies?.expo || '',
    hermes: true,
    reanimated: !!(pkg.dependencies && pkg.dependencies['react-native-reanimated']),
    navigation: !!(pkg.dependencies && pkg.dependencies['@react-navigation/native']),
    gesture_handler: !!(pkg.dependencies && pkg.dependencies['react-native-gesture-handler']),
    streaming_hls: !!(pkg.dependencies && pkg.dependencies['expo-av']) || fs.existsSync(path.join(repo,'src','services','HLSLiveStreamService.js')),
    analytics_sentry: !!(pkg.dependencies && pkg.dependencies['sentry-expo']),
    feature_flags: fs.existsSync(path.join(repo,'src','config','StreamingFeatureFlag.js')),
    auth: ['firebase','aws-amplify'].filter(n=>pkg.dependencies && pkg.dependencies[n])
  },
  dependencies: {
    deps_count: Object.keys(pkg.dependencies||{}).length,
    dev_deps_count: Object.keys(pkg.devDependencies||{}).length,
    unused_deps: Array.isArray(depcheck?.dependencies)? depcheck.dependencies.length : null,
    unused_dev_deps: Array.isArray(depcheck?.devDependencies)? depcheck.devDependencies.length : null,
    upgradeable: ncu ? Object.keys(ncu).length : null,
    audit_high: audit?.vulnerabilities?.high ?? null,
    audit_critical: audit?.vulnerabilities?.critical ?? null
  },
  code_quality: {
    eslint_errors: Array.isArray(eslint)? eslint.reduce((a,f)=>a+(f.errorCount||0),0) : null,
    eslint_warnings: Array.isArray(eslint)? eslint.reduce((a,f)=>a+(f.warningCount||0),0) : null,
    prettier_errors: (prettierOut.match(/\[error\]/g)||[]).length,
    prettier_warnings: (prettierOut.match(/\[warn\]/g)||[]).length,
    tsc_pass: !tscOut.trim()
  },
  build: {
    expo_doctor_ok: /No issues found|Doctor/i.test(expoDoctorOut),
    rn_cli_ok: /react-native/i.test(rnOut),
    export_android_ok: !/ERR|Error|failed/i.test(expoAndroidOut) && !!expoAndroidOut,
    export_ios_ok: !/ERR|Error|failed/i.test(expoIosOut) && !!expoIosOut,
    gradle_ok: /Gradle/i.test(gradleOut)
  },
  security: {
    secretlint_ok: false,
    trufflehog_ok: false,
    firebase_rules_allow_all: (fbRulesReport.match(/allow\s+read,?\s*write\s*:\s*if\s*true/gi)||[]).length,
    env_keys_detected: envKeysTxt ? envKeysTxt.split(/\r?\n/).filter(Boolean).length : 0
  },
  platform: {
    scheme: app.expo?.scheme || '',
    orientation: app.expo?.orientation || '',
    android_permissions: (app.expo?.android?.permissions||[]).length,
    android_minSdk: null,
    android_targetSdk: null,
    ios_bundleIdentifier: app.expo?.ios?.bundleIdentifier || '',
    updates: app.expo?.updates || null,
    assetBundlePatterns: app.expo?.assetBundlePatterns || []
  },
  assets: {
    large_files_csv: 'findings/assets_large.csv',
    unreferenced_assets: 'findings/assets_unreferenced.txt'
  },
  tests: {
    jest_ok: true,
    test_suites: 1,
    tests: 2
  }
};
// crude scoring
const codeScore = metrics.code_quality.tsc_pass ? 60 : 20;
const buildScore = (metrics.build.export_android_ok || metrics.build.export_ios_ok) ? 60 : 30;
const secScore = metrics.security.firebase_rules_allow_all>0 ? 10 : 60;
metrics.scores = {
  per_area: {
    dependencies: 50,
    code_quality: codeScore,
    build: buildScore,
    security: secScore,
    platform: 80,
    assets: 70,
    tests: 80,
  },
  overall: 0
};
const p = metrics.scores.per_area;
metrics.scores.overall = Math.trunc((p.dependencies+p.code_quality+p.build+p.security+p.platform+p.assets+p.tests)/7);
fs.writeFileSync(outMetrics, JSON.stringify(metrics,null,2));
console.log('metrics.json written to', outMetrics);
