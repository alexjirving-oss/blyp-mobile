// src/runtime/tslib-shim.js
// Standalone implementation of the common TypeScript helper set.
// IMPORTANT: We DO NOT re-require the original tslib here because our Metro
// resolver aliases "tslib" and "tslib/*" back to this file; attempting to
// require a subpath would recurse and yield a partially initialised export.
// Instead we provide minimal but spec‑compatible helpers used by TS output.

// Utility: safe define
function def(obj, name, value) {
  try {
    if (!Object.prototype.hasOwnProperty.call(obj, name)) {
      Object.defineProperty(obj, name, { enumerable: true, configurable: true, writable: true, value });
    } else if (obj[name] == null) {
      obj[name] = value;
    }
  } catch { obj[name] = value; }
}

// __extends
function __extends(d, b) {
  for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
  function __() { this.constructor = d; }
  d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
}

// __assign
var __assign = Object.assign || function (t) {
  for (var i = 1; i < arguments.length; i++) {
    var s = arguments[i];
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
  }
  return t;
};

// __rest
function __rest(s, e) {
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
}

// __createBinding / __setModuleDefault / __exportStar
function __createBinding(o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || (!('get' in desc) && (!desc.writable || !desc.configurable))) {
    desc = { enumerable: true, get: function () { return m[k]; } };
  }
  Object.defineProperty(o, k2, desc);
}
function __setModuleDefault(o, v) {
  Object.defineProperty(o, 'default', { enumerable: true, value: v });
}
function __exportStar(m, exports) {
  for (var p in m) if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
}

// __values
function __values(o) {
  var s = typeof Symbol === 'function' && Symbol.iterator, m = s && o[s], i = 0;
  if (m) return m.call(o);
  return {
    next: function () {
      if (o && i >= o.length) o = undefined;
      return { value: o && o[i++], done: !o };
    }
  };
}

// __read
function __read(o, n) {
  var arr = [];
  var it = o && (typeof Symbol === 'function') && o[Symbol.iterator];
  if (!it) {
    for (var i = 0; i < o.length && (n === undefined || i < n); i++) arr.push(o[i]);
    return arr;
  }
  it = it.call(o);
  var r;
  while ((n === undefined || n-- > 0) && !(r = it.next()).done) arr.push(r.value);
  return arr;
}

// __spread / __spreadArrays / __spreadArray (newer helper)
function __spread() { return Array.prototype.concat.apply([], arguments); }
function __spreadArrays() { return Array.prototype.concat.apply([], arguments); }
function __spreadArray(to, from, pack) {
  if (pack || from == null) return to.concat(from);
  for (var i = 0, l = from.length; i < l; i++) to[to.length] = from[i];
  return to;
}

// __decorate
function __decorate(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) {
    r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  }
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}

// __param
function __param(paramIndex, decorator) {
  return function (target, key) { decorator(target, key, paramIndex); };
}

// __metadata
function __metadata(k, v) {
  if (typeof Reflect === 'object' && typeof Reflect.metadata === 'function') return Reflect.metadata(k, v);
}

// __awaiter / __generator
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
  return new (P || (P = Promise))(function (resolve, reject) {
    function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
    function rejected(value) { try { step(generator.throw(value)); } catch (e) { reject(e); } }
    function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
function __generator(thisArg, body) {
  var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
  return g = { next: verb(0), throw: verb(1), return: verb(2) }, typeof Symbol === 'function' && (g[Symbol.iterator] = function() { return this; }), g;
  function verb(n) { return function (v) { return step([n, v]); }; }
  function step(op) {
    if (f) throw new TypeError('Generator is already executing.');
    while (_) try {
      if (f = 1, y && (t = op[0] & 2 ? y.return : op[0] ? y.throw || ((t = y.return) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
      if (y = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0: case 1: t = op; break;
        case 4: _.label++; return { value: op[1], done: false };
        case 5: _.label++; y = op[1]; op = [0]; continue;
        case 7: op = _.ops.pop(); _.trys.pop(); continue;
        default:
          if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
          if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
          if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
          if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
          if (t[2]) _.ops.pop(); _.trys.pop(); continue;
      }
      op = body.call(thisArg, _);
    } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
    if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
  }
}

// __importStar / __importDefault
function __importStar(mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) for (var k in mod) if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
  __setModuleDefault(result, mod);
  return result;
}
function __importDefault(mod) { return (mod && mod.__esModule) ? mod : { default: mod }; }

// Build API object with direct & default exports unified.
const api = {};
def(api, '__extends', __extends);
def(api, '__assign', __assign);
def(api, '__rest', __rest);
def(api, '__createBinding', __createBinding);
def(api, '__setModuleDefault', __setModuleDefault);
def(api, '__exportStar', __exportStar);
def(api, '__values', __values);
def(api, '__read', __read);
def(api, '__spread', __spread);
def(api, '__spreadArrays', __spreadArrays);
def(api, '__spreadArray', __spreadArray);
def(api, '__decorate', __decorate);
def(api, '__param', __param);
def(api, '__metadata', __metadata);
def(api, '__awaiter', __awaiter);
def(api, '__generator', __generator);
def(api, '__importStar', __importStar);
def(api, '__importDefault', __importDefault);

api.__esModule = true;
api.default = api;

module.exports = api;
