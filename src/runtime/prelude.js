// src/runtime/prelude.js — minimal, safe prelude
// Loud marker + global flag
// eslint-disable-next-line no-console
console.log('[BLYP][PRELUDE] RUN');
// @ts-ignore
global.BLYP_PRELUDE = 'RUN';

// Ensure RN core polyfills (includes WebSocket) are loaded ASAP
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('react-native/Libraries/Core/InitializeCore');

// Probe tslib resolution early to verify Metro alias works
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require('tslib');
  // eslint-disable-next-line no-console
  console.log('[BLYP][TSLIB] keys:', ts && Object.keys(ts));
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[BLYP][TSLIB] require failed:', e?.message);
}

// Ensure timers and microtask APIs exist very early
// Some libraries reference setImmediate/process.nextTick during import time
(function ensureTimersPolyfill() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : global;
    // setImmediate / clearImmediate
    if (typeof g.setImmediate !== 'function') {
      // eslint-disable-next-line no-console
      console.log('[BLYP][PRELUDE] setImmediate polyfilled');
      g.setImmediate = (fn, ...args) => setTimeout(() => {
        try { return typeof fn === 'function' ? fn(...args) : fn; } catch (e) { setTimeout(() => { throw e; }, 0); }
      }, 0);
    }
    if (typeof g.clearImmediate !== 'function') {
      g.clearImmediate = (id) => clearTimeout(id);
    }

    // queueMicrotask shim for older runtimes
    const queueTask = g.queueMicrotask || ((cb) => Promise.resolve().then(cb).catch(e => setTimeout(() => { throw e; }, 0)));

    // process.nextTick
    if (!g.process) {
      // minimal process stub
      // @ts-ignore
      g.process = { env: g.process?.env || {}, nextTick: (cb, ...args) => queueTask(() => cb(...args)) };
    } else if (typeof g.process.nextTick !== 'function') {
      g.process.nextTick = (cb, ...args) => queueTask(() => cb(...args));
    }
  } catch {}
})();

// Early-construction detector (LOG ONLY). Keep a transparent pass-through to the real WS
(function () {
  const start = Date.now();
  let ready = false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppState, InteractionManager } = require('react-native');
  (async () => {
    await new Promise(r => InteractionManager.runAfterInteractions(() => r()));
    if (AppState.currentState !== 'active') {
      await new Promise(r => {
        const sub = AppState.addEventListener('change', s => {
          if (s === 'active') { sub.remove(); r(); }
        });
      });
    }
    ready = true;
    // eslint-disable-next-line no-console
    console.log('[BLYP][PRELUDE] READY @', Date.now() - start, 'ms');
  })();

  // Tap global WebSocket only to log early construction; do not block/alter behavior
  const WS = global.WebSocket;
  // Tiny wrapper logs then delegates to the real WS
  // eslint-disable-next-line no-global-assign
  global.WebSocket = function GuardWS(...args) {
    if (!ready) {
      // eslint-disable-next-line no-console
      console.warn(new Error('[BLYP][WS] Constructed before runtime READY').stack);
    }
    // @ts-ignore
    return new WS(...args);
  };
  // Preserve constants/prototype
  // @ts-ignore
  global.WebSocket.CONNECTING = WS.CONNECTING; // @ts-ignore
  global.WebSocket.OPEN = WS.OPEN; // @ts-ignore
  global.WebSocket.CLOSING = WS.CLOSING; // @ts-ignore
  global.WebSocket.CLOSED = WS.CLOSED; // @ts-ignore
  global.WebSocket.prototype = WS.prototype;
})();

// First error trap
try {
  // @ts-ignore RN global
  const ErrorUtils = global.ErrorUtils;
  if (ErrorUtils && !global.__BLYP_ERR_TAPPED__) {
    // @ts-ignore
    global.__BLYP_ERR_TAPPED__ = true;
    const orig = ErrorUtils.getGlobalHandler && ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((e, isFatal) => {
      try {
        // eslint-disable-next-line no-console
        console.log('[BLYP][ERR] FATAL:', isFatal);
        // eslint-disable-next-line no-console
        console.log('[BLYP][ERR] NAME:', e?.name);
        // eslint-disable-next-line no-console
        console.log('[BLYP][ERR] MSG:', e?.message);
        // eslint-disable-next-line no-console
        console.log('[BLYP][ERR] STACK:', e?.stack);
      } catch {}
      if (orig) return orig(e, isFatal);
    });
  }
} catch {}
