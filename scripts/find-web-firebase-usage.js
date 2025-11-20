const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');
const PATTERN = /from\s+'firebase\//;

function walk(dir, result = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, result);
    else if (e.isFile() && /\.(js|jsx|ts|tsx)$/.test(e.name)) result.push(full);
  }
  return result;
}

const files = walk(ROOT);
const matches = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (PATTERN.test(text)) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (PATTERN.test(line)) {
        matches.push({ file: path.relative(path.resolve(__dirname, '..'), f), line: idx + 1, code: line.trim() });
      }
    });
  }
}

console.log(`Found ${matches.length} firebase/* import lines across ${files.length} files.`);
const byFile = matches.reduce((acc, m) => {
  (acc[m.file] ||= []).push(m);
  return acc;
}, {});

Object.keys(byFile).sort().forEach((file) => {
  console.log(`\n> ${file}`);
  byFile[file].forEach((m) => console.log(`  ${m.line}: ${m.code}`));
});
