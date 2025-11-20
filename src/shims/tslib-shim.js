// A robust tslib shim for Metro/React Native
// Ensures both default and named exports exist for all helpers regardless of import style.

/* eslint-disable @typescript-eslint/no-var-requires */
const cjs = (function loadCjs() {
  try {
    return require('tslib/tslib.js');
  } catch (e) {
    try {
      return require('tslib');
    } catch (_) {
      return {};
    }
  }
})();

// Create an export object that has named helpers and a default pointing to itself
const exported = { ...cjs };
// Some bundlers look for __esModule and default
Object.defineProperty(exported, '__esModule', { value: true });
if (!('default' in exported)) {
  exported.default = exported;
}

// Also attach to global.tslib for any UMD patterns that check global
const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this);
if (g) {
  try {
    g.tslib = g.tslib || {};
    Object.keys(cjs).forEach((k) => {
      if (!g.tslib[k]) g.tslib[k] = cjs[k];
    });
  } catch {}
}

module.exports = exported;
