// scripts/gen-perf-plan.js
// Reads SME JSON if present; else falls back to perf_fallback_top_modules.txt.
// Emits PERF_CUT_PLAN.md with prioritized actions.
const fs = require('fs'), path = require('path'), glob = require('glob');

function readSME() {
  const files = glob.sync('_reports/prod_audit_v2/findings/sme.*.json');
  if (!files.length) return null;
  try {
    const j = JSON.parse(fs.readFileSync(files[0], 'utf8'));
    // SME json can be an array of reports; normalize to [{files:[{name,size}]}]
    const flat = [];
    const pushEntries = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) obj.forEach(pushEntries);
      else if (obj.files) obj.files.forEach(f => flat.push({ name: f.name, size: f.size || f.gzipSize || 0 }));
      else if (obj.bundles) Object.values(obj.bundles).forEach(b => b.files.forEach(f => flat.push({ name: f.name, size: f.size || 0 })));
    };
    pushEntries(j);
    return flat;
  } catch { return null; }
}

function readFallback() {
  const p = '_reports/prod_audit_v2/findings/perf_fallback_top_modules.txt';
  if (!fs.existsSync(p)) return [];
  try {
    const txt = fs.readFileSync(p, 'utf8');
    return txt.split('\n').filter(Boolean).map(line => {
      const [count, ...rest] = line.trim().split(/\s+/);
      const mod = rest.join(' ') || '';
      return { name: mod, count: Number(count) || 1, size: 0 };
    });
  } catch {
    return [];
  }
}

const sme = readSME();
const data = sme && sme.length ? sme : readFallback();
if (!data || !data.length) {
  console.log('No SME or fallback data found.');
  process.exit(0);
}

// Aggregate by module root
const agg = {};
for (const { name, size, count = 1 } of data) {
  if (!name) continue;
  const parts = name.replace(/^.*node_modules\//, '').split('/');
  const root = name.startsWith('@') ? parts.slice(0,2).join('/') : parts[0];
  agg[root] = agg[root] || { size: 0, count: 0, samples: new Set() };
  agg[root].size += size || 0;
  agg[root].count += count || 1;
  agg[root].samples.add(name);
}

// Rank by size (or count if size missing)
const ranked = Object.entries(agg)
  .map(([k,v]) => ({ pkg:k, size:v.size, count:v.count, files:[...v.samples].slice(0,10) }))
  .sort((a,b) => (b.size||b.count) - (a.size||a.count))
  .slice(0, 25);

const suggestions = (pkg) => {
  if (pkg === 'moment') return ['Replace with dayjs', 'Dynamic import locales if absolutely needed'];
  if (pkg.startsWith('lodash')) return ['Use per-method imports or lodash-es', 'Add babel-plugin-lodash'];
  if (pkg === '@expo/vector-icons') return ['Import specific families only', 'Migrate hot paths to lucide-react-native'];
  if (pkg.startsWith('@firebase') || pkg === 'firebase') return ['Use modular v9+ imports', 'Lazy load heavy sub-modules'];
  if (pkg.startsWith('date-fns')) return ['Import individual functions not whole locale packs'];
  if (pkg === 'uuid') return ['Switch to react-native-uuid or expo-crypto'];
  if (pkg === 'hls.js') return ['Remove from RN (use expo-av)'];
  return ['Audit imports', 'Replace with lighter alt or lazy load on deep screens'];
};

let md = `# PERF_CUT_PLAN\n\n`;
md += `Focus: cut initial Android bundle from ~5.6 MB towards ≤1.2–2.0 MB.\n\n`;
md += `## Top offenders (by ${(sme && sme.length) ? 'size' : 'import frequency'})\n\n`;
ranked.forEach((r,i) => {
  md += `${i+1}. \`${r.pkg}\` — ${r.size?`${(r.size/1024).toFixed(1)} kB`:`count ${r.count}`}\n`;
  suggestions(r.pkg).forEach(s => md += `   - ${s}\n`);
});
md += `\n## Global switches already applied\n- inlineRequires: true (Metro)\n- transform-remove-console in production (Babel)\n`;
md += `\n## Next steps\n- Apply per-package actions above (start with top 5)\n- Re-export and re-run SME\n`;

fs.writeFileSync('_reports/prod_audit_v2/PERF_CUT_PLAN.md', md);
console.log('Wrote _reports/prod_audit_v2/PERF_CUT_PLAN.md');
