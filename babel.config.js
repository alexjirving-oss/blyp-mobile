module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Fix TS helper initializers in some 3rd-party packages (e.g., RxJS)
      // that read from `this.__extends` under strict mode by redirecting to
      // `globalThis.__extends` to avoid runtime crashes in Metro/Hermes.
      [require.resolve('./babel/plugins/fix-ts-helpers-this.js')],
      ["lodash", { id: ["lodash", "lodash-es"] }],
    ],
    env: {
      production: {
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]]
      }
    }
  };
};
