(function (g) {
  try { if (typeof g.self === 'undefined') g.self = g; } catch {}
  try { if (typeof g.window === 'undefined') g.window = g; } catch {}

  if (typeof g.FormData === 'undefined') {
    function MinimalFormData() { this._parts = []; }
    MinimalFormData.prototype.append = function (name, value, fileName) {
      this._parts.push([name, value, fileName]);
    };
    try {
      Object.defineProperty(g, 'FormData', { value: MinimalFormData, configurable: true, writable: true });
    } catch {
      g.FormData = MinimalFormData;
    }
  }

  // Provide WebSocket early; attempt RN internal first, else minimal non-throwing façade
  if (typeof g.WebSocket === 'undefined') {
    var Impl = null;
    try {
      var RNWS = require('react-native/Libraries/WebSocket/WebSocket');
      Impl = RNWS && (RNWS.default || RNWS);
    } catch (_) {}
    if (!Impl) {
      // Minimal placeholder to satisfy feature detection without throwing
      // This lets the app boot even if someone constructs a WS too early
      Impl = function WebSocket(url, protocols) {
        // no-op façade; callers won't crash, but connection won't open
        this.readyState = 3; /* CLOSED */
        this.bufferedAmount = 0;
        this.extensions = '';
        this.protocol = '';
        this.url = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
        this.close = function(){};
        this.send = function(){};
        this.onopen = this.onmessage = this.onerror = this.onclose = null;
      };
      Impl.CONNECTING = 0; Impl.OPEN = 1; Impl.CLOSING = 2; Impl.CLOSED = 3;
    }
    try { Object.defineProperty(g, 'WebSocket', { value: Impl, configurable: true, writable: true }); } catch { g.WebSocket = Impl; }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this));
