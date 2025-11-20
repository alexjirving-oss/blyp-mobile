// Early, defensive setup of TypeScript helper functions for React Native/Metro
// Ensures __extends, __assign, etc. exist before any library code executes.

/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

// Prefer the CommonJS build to avoid ESM interop surprises in Metro
let tslibRuntime;
try {
  tslibRuntime = require('tslib');
} catch (_) {
  try {
    tslibRuntime = require('tslib/tslib.js');
  } catch (e) {
    tslibRuntime = {};
  }
}

const g = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this);
if (!g) {
  // Should never happen in RN, but bail gracefully
  // No global to attach to; nothing else we can do.
}

// Make a stable global namespace for tslib helpers so UMD/legacy patterns can find them
g.tslib = g.tslib || {};

// Ensure FormData exists early for libraries that detect it at import-time
try {
  if (typeof g.FormData === 'undefined') {
    // Prefer React Native's built-in implementation when available
    let Impl;
    try {
      const RNFormData = require('react-native/Libraries/Network/FormData');
      Impl = RNFormData && (RNFormData.default || RNFormData);
    } catch (_) {}

    if (!Impl) {
      // Minimal fallback to satisfy feature-detection (append only)
      Impl = function MinimalFormData() { this._parts = []; };
      Impl.prototype.append = function(name, value) { this._parts.push([name, value]); };
    }

    // Define on all common globals to satisfy different resolutions
    try { Object.defineProperty(g, 'FormData', { value: Impl, writable: true, configurable: true }); } catch {}
    try { if (typeof global !== 'undefined' && global !== g) Object.defineProperty(global, 'FormData', { value: Impl, writable: true, configurable: true }); } catch {}
    try { if (typeof self !== 'undefined' && self !== g) Object.defineProperty(self, 'FormData', { value: Impl, writable: true, configurable: true }); } catch {}
    try { if (typeof window !== 'undefined' && window !== g) Object.defineProperty(window, 'FormData', { value: Impl, writable: true, configurable: true }); } catch {}
  }
} catch (_) {}

// Ensure Blob exists for FormData / uploads when some libs reference it directly
try {
  if (typeof g.Blob === 'undefined') {
    let B;
    try {
      const RNBlob = require('react-native/Libraries/Blob/Blob');
      B = RNBlob && (RNBlob.default || RNBlob);
    } catch (_) {}
    if (!B) {
      // Minimal placeholder Blob
      B = function Blob() {};
    }
    try { Object.defineProperty(g, 'Blob', { value: B, writable: true, configurable: true }); } catch {}
  }
} catch (_) {}

// Provide common global aliases
try { if (typeof g.window === 'undefined') g.window = g; } catch {}
try { if (typeof g.self === 'undefined') g.self = g; } catch {}

// List of helpers commonly emitted by TS and used by many deps
const helperNames = [
  '__extends',
  '__assign',
  '__rest',
  '__decorate',
  '__param',
  '__metadata',
  '__awaiter',
  '__generator',
  '__exportStar',
  '__values',
  '__read',
  '__spread',
  '__spreadArrays',
  '__spreadArray',
  '__await',
  '__asyncGenerator',
  '__asyncDelegator',
  '__asyncValues',
  '__makeTemplateObject',
  '__importStar',
  '__importDefault',
  '__classPrivateFieldGet',
  '__classPrivateFieldSet',
  '__classPrivateFieldIn',
];

for (const name of helperNames) {
  if (!g[name]) {
    const value = tslibRuntime && tslibRuntime[name];
    if (typeof value === 'function' || typeof value === 'object') {
      try {
        g[name] = value;
      } catch {}
    }
  }
  if (!g.tslib[name]) {
    const value = tslibRuntime && tslibRuntime[name];
    if (typeof value === 'function' || typeof value === 'object') {
      try {
        g.tslib[name] = value;
      } catch {}
    }
  }
}

// Also expose the entire runtime object for modules that read `this.tslib` or global.tslib
// without named helpers
if (tslibRuntime && Object.keys(g.tslib).length === 0) {
  try {
    Object.assign(g.tslib, tslibRuntime);
  } catch {}
}

// No exports; this module’s side-effect is the setup above.
