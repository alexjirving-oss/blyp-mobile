const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Prefer parsing sourcemap to list module sources
const maps = glob.sync('_reports/bundles/**/AppEntry*.hbc.map');
if (!maps.length) {
  fs.writeFileSync('_reports/prod_audit_v2/findings/perf_fallback_top_modules.txt', 'no sourcemap');
  console.log('No sourcemap found for fallback');
  process.exit(0);
}

const mapPath = maps[0];
const sm = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const sources = Array.isArray(sm.sources) ? sm.sources : [];
const freq = {};
for (const s of sources) {
  // Normalize package name from path like node_modules/<pkg>/...
  let mod = s;
  const nm = s.indexOf('node_modules/');
  if (nm >= 0) {
    const rest = s.slice(nm + 'node_modules/'.length);
    const parts = rest.split(/[\\\/]/);
    mod = parts[0] === '@' ? parts.slice(0,2).join('/') : parts[0];
  }
  if (mod.startsWith('node_modules')) continue;
  freq[mod] = (freq[mod] || 0) + 1;
}
const lines = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,50).map(([k,v]) => `${v}\t${k}`).join('\n');
fs.writeFileSync('_reports/prod_audit_v2/findings/perf_fallback_top_modules.txt', lines || 'no modules parsed');
console.log('Fallback perf report written from sourcemap');
