/* Ensure WebSocket is defined very early and optionally wrap it in DEV to avoid startup red screens */

(function bootstrapWS() {
  try {
    const wasUndef = typeof global.WebSocket === 'undefined';
    // Remember whether WS was missing before we touched it
    global.__BLYP_WS_WAS_UNDEFINED__ = wasUndef;

    if (wasUndef) {
      try {
        // Force RN's WebSocket polyfill (internal path, but safe in RN runtime)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        global.WebSocket = require('react-native/Libraries/WebSocket/WebSocket');
        console.warn('[BLYP][WS] Injected RN WebSocket polyfill at startup');
      } catch (e) {
        console.warn('[BLYP][WS] RN WebSocket polyfill not available yet', e);
      }
    }

    // Last-resort DEV guard: delay constructor side-effects by one tick
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      try {
        const _WS = global.WebSocket;
        if (_WS && !_WS.__BLYP_DELAYED_WRAPPER__) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          global.WebSocket = class DelayedWS {
            static __BLYP_DELAYED_WRAPPER__ = true;
            constructor(url, protos) {
              // Construct the real socket immediately
              const ws = new _WS(url, protos);
              // Defer any user code scheduling to the next tick to dodge early-runtime issues
              setTimeout(() => {}, 0);
              return ws;
            }
            static get CONNECTING(){ return _WS.CONNECTING }
            static get OPEN(){ return _WS.OPEN }
            static get CLOSING(){ return _WS.CLOSING }
            static get CLOSED(){ return _WS.CLOSED }
          };
          console.warn('[BLYP][WS] DEV Delayed WebSocket wrapper installed');
        }
      } catch {}
    }

    // Mark that we ran
    global.__BLYP_WS_TAP__ = true;
  } catch {}
})();
