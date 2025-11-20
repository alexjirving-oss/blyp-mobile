// Replace @expo/vector-icons usages with src/components/Icon shim
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const files = glob.sync('**/*.{js,jsx,ts,tsx}', {
  ignore: ['node_modules/**', '_reports/**', 'android/**', 'ios/**', 'dist/**', 'build/**'],
  nodir: true,
});

let changed = 0;
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const before = t;

  // Remove barrel imports: t = t.replace(/import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]@expo\/vector-icons['"];?\s*/g, '');

  // Remove deep family imports: t = t.replace(/import\s+([A-Za-z0-9_]+)\s+from\s*['"]@expo\/vector-icons\/[A-Za-z0-9_-]+['"];?\s*/g, '');

  // Replace JSX usages like <Icon  name="home" size={24} color="..." />
  t = t.replace(/<\s*(Ionicons|AntDesign|MaterialCommunityIcons|Feather|FontAwesome|Entypo|MaterialIcons)\b([^>]*)\/>/g, (_m, _comp, attrs) => `<Icon ${attrs} />`);
  t = t.replace(/<\s*(Ionicons|AntDesign|MaterialCommunityIcons|Feather|FontAwesome|Entypo|MaterialIcons)\b([^>]*)>([\s\S]*?)<\/\s*\1\s*>/g, (_m, _comp, attrs, inner) => `<Icon ${attrs}>${inner}</Icon>`);

  // Ensure Icon import exists if used
  if (t !== before && /<Icon\b/.test(t)) {
    const rel = path.relative(path.dirname(f), path.join('src', 'components', 'Icon')).replace(/\\/g, '/');
    if (!new RegExp(`from\\s+['\"].*${rel}['\"]`).test(t) && !/from\s+['\"].*components\/Icon['\"]/g.test(t)) {
      // Try to insert after the first import block
      if (/import[\s\S]*?;\s*\n/.test(t)) {
        t = t.replace(/(import[\s\S]*?;\s*\n)/, `$1import Icon from '${rel}';\n`);
      } else {
        t = `import Icon from '${rel}';\n` + t;
      }
    }
  }

  if (t !== before) {
    fs.writeFileSync(f, t, 'utf8');
    changed++;
  }
}

console.log(`Icon migration: updated ${changed} file(s).`);
