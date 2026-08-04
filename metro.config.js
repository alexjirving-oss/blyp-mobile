// Minimal Metro config for Expo/React Native bundling
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const metroResolver = require('metro-resolver');

const config = getDefaultConfig(__dirname);

// Appium driver trees under node_modules can contain broken nested paths that
// crash Metro's FallbackWatcher (ENOENT). They are not part of the app bundle.
const appiumBlock = /node_modules[/\\]appium[^/\\]*[/\\].*/;
if (config.resolver?.blockList) {
  const prev = config.resolver.blockList;
  config.resolver.blockList = Array.isArray(prev)
    ? [...prev, appiumBlock]
    : [prev, appiumBlock];
} else if (config.resolver) {
  config.resolver.blockList = [appiumBlock];
}

// Enable inline requires to improve startup performance (avoid spread for Node CJS compatibility)
config.transformer = Object.assign({}, config.transformer || {}, { inlineRequires: true });

// Resolver aliases: ensure mobile-friendly modules and correct tslib flavor
const baseResolver = config.resolver || {};
const baseAlias = baseResolver.alias ? baseResolver.alias : {};

// Keep aliases minimal to avoid Node resolution issues while loading this file
const shim = path.resolve(__dirname, 'src/runtime/tslib-shim.js');
const rnghShim = path.resolve(__dirname, 'src/runtime/rngh-shim.js');
config.resolver = Object.assign({}, baseResolver, {
  alias: Object.assign({}, baseAlias, {
    // Avoid bundling Node polyfills unintentionally
    uuid: require.resolve('react-native-uuid'),
    // Force every common tslib specifier to the canonical shim
    tslib: shim,
    'tslib/tslib': shim,
    'tslib/tslib.js': shim,
    'tslib/tslib.es6': shim,
    'tslib/tslib.es6.js': shim,
    // Route RNGH to a safe JS shim since native is disabled
    'react-native-gesture-handler': rnghShim,
  }),
  extraNodeModules: Object.assign({}, (baseResolver.extraNodeModules || {}), {
    tslib: shim,
  }),
  // Authoritative hook — hits ALL callers, including nested node_modules
  resolveRequest(context, moduleName, platform) {
    try {
      if (moduleName === 'tslib' || (typeof moduleName === 'string' && moduleName.startsWith('tslib/'))) {
        return { type: 'sourceFile', filePath: shim };
      }
      // Force all RNGH imports (including deep paths) to the JS shim
      if (moduleName === 'react-native-gesture-handler' || (typeof moduleName === 'string' && moduleName.startsWith('react-native-gesture-handler/'))) {
        return { type: 'sourceFile', filePath: rnghShim };
      }
      return metroResolver.resolve(context, moduleName, platform);
    } catch (e) {
      // In worst case, fall back to default resolver to avoid build breakage
      return metroResolver.resolve(context, moduleName, platform);
    }
  },
});

// Ensure critical polyfills run before any other module (including Expo internals)
const baseSerializer = config.serializer || {};
const originalGetPolyfills = baseSerializer.getPolyfills;
const originalGetBefore = baseSerializer.getModulesRunBeforeMainModule;
config.serializer = Object.assign({}, baseSerializer, {
  getModulesRunBeforeMainModule: function () {
    const before = typeof originalGetBefore === 'function' ? originalGetBefore() : [];
    return [
      path.resolve(__dirname, 'src/runtime/hard-polyfills.js'),
      require.resolve('./src/polyfills/setupTsHelpers'),
      ...before,
    ];
  },
  getPolyfills: function (options) {
    const base = typeof originalGetPolyfills === 'function' ? originalGetPolyfills(options) : [];
    return base.concat([require.resolve('./src/polyfills/preludePolyfills.js')]);
  },
});

module.exports = config;
