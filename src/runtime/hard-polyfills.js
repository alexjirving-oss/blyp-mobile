// Runs before the main module via metro.config.js
(function ensureCoreTimers() {
  const g = (typeof globalThis !== 'undefined' && globalThis) || (typeof global !== 'undefined' && global) || this;

  // setImmediate / clearImmediate
  if (typeof g.setImmediate !== 'function') {
    const _st = g.setTimeout ? g.setTimeout.bind(g) : (fn, t, ...a) => setTimeout(fn, t, ...a);
    const _ct = g.clearTimeout ? g.clearTimeout.bind(g) : (id) => clearTimeout(id);
    g.setImmediate = (fn, ...args) => _st(fn, 0, ...args);
    g.clearImmediate = (id) => _ct(id);
    // console.log('[BLYP][HARD] setImmediate polyfilled');
  }

  // process.nextTick
  if (!g.process) g.process = {};
  if (typeof g.process.nextTick !== 'function') {
    const micro = (fn, ...a) => (typeof queueMicrotask === 'function'
      ? queueMicrotask(() => fn(...a))
      : Promise.resolve().then(() => fn(...a)));
    g.process.nextTick = micro;
    // console.log('[BLYP][HARD] process.nextTick polyfilled');
  }
})();

// ---- TypeScript helper shims (safe, only if missing) ----
(function ensureTSHelpers() {
  const g = (typeof globalThis !== 'undefined' && globalThis) || (typeof global !== 'undefined' && global) || this;

  if (!g.__extends) {
    g.__extends = function (d, b) {
      for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  }

  if (!g.__assign) {
    g.__assign = Object.assign || function (t) {
      for (var i = 1; i < arguments.length; i++) {
        var s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
      }
      return t;
    };
  }

  if (!g.__rest) {
    g.__rest = function (s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === 'function') {
        for (var i = 0, syms = Object.getOwnPropertySymbols(s); i < syms.length; i++) {
          if (e.indexOf(syms[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, syms[i])) {
            t[syms[i]] = s[syms[i]];
          }
        }
      }
      return t;
    };
  }

  if (!g.__decorate) {
    g.__decorate = function (decorators, target, key, desc) {
      var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
      for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) {
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
      }
      return c > 3 && r && Object.defineProperty(target, key, r), r;
    };
  }

  if (!g.__awaiter) {
    g.__awaiter = function (thisArg, _arguments, P, generator) {
      function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
      return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator.throw(value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    };
  }
})();

// ---- Force tslib available everywhere (import + legacy var) ----
(function forceTslibEverywhere() {
  try {
    // Resolve the canonical CJS build explicitly
    // Our resolver forces any tslib* request to the shim, so require('tslib') is sufficient.
    const real = require('tslib');

    // If any module expects a global var, satisfy it.
    if (!global.tslib_1) global.tslib_1 = real;
    if (!global.tslib) global.tslib = real;

    // Some bundlers read default; others named — expose both.
    if (!real.__extends && real && real.default) {
      // If Metro gave an ESM wrapper, use .default
      Object.assign(real, real.default);
    }
    // Sanity: ensure the helpers exist
    const ensure = (k, fn) => { if (!real[k]) real[k] = fn; };
    ensure('__extends', function (d, b) {
      for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    });
    ensure('__assign', Object.assign || function (t) {
      for (var i = 1; i < arguments.length; i++) {
        var s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
      }
      return t;
    });
    // Additional helpers sometimes emitted by TS & AWS libs
    const stub = (name, fn) => { if (!real[name]) real[name] = fn; };
    stub('__createBinding', function (o, m, k, k2) { if (k2 === undefined) k2 = k; Object.defineProperty(o, k2, { enumerable: true, get: function () { return m[k]; } }); });
    stub('__setModuleDefault', function (o, v) { Object.defineProperty(o, 'default', { enumerable: true, value: v }); });
    stub('__exportStar', function (m, exports) { for (var p in m) if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p)) real.__createBinding(exports, m, p); });
    stub('__importDefault', function (mod) { return (mod && mod.__esModule) ? mod : { default: mod }; });
    stub('__importStar', function (mod) { if (mod && mod.__esModule) return mod; var r = {}; if (mod != null) for (var k in mod) if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k)) real.__createBinding(r, mod, k); real.__setModuleDefault(r, mod); return r; });
  } catch (e) {
    // Last-ditch: fabricate a minimal module so require('tslib') isn't undefined
    const fake = {};
    fake.__extends = function (d, b) {
      for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
    fake.__assign = Object.assign || function (t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p]; } return t; };
    fake.__createBinding = function (o, m, k, k2) { if (k2 === undefined) k2 = k; Object.defineProperty(o, k2, { enumerable: true, get: function () { return m[k]; } }); };
    fake.__setModuleDefault = function (o, v) { Object.defineProperty(o, 'default', { enumerable: true, value: v }); };
    fake.__exportStar = function (m, exports) { for (var p in m) if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p)) fake.__createBinding(exports, m, p); };
    fake.__importDefault = function (mod) { return (mod && mod.__esModule) ? mod : { default: mod }; };
    fake.__importStar = function (mod) { if (mod && mod.__esModule) return mod; var r = {}; if (mod != null) for (var k in mod) if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k)) fake.__createBinding(r, mod, k); fake.__setModuleDefault(r, mod); return r; };
    try { global.tslib_1 = fake; global.tslib = fake; } catch {}
  }
})();
