#!/usr/bin/env node
const name = process.argv[2] || 'command';
console.error(
  `[blyp-live-service] ${name} is not implemented. ` +
    'Schema bootstrap uses ensureEconomySchema at process start / npm run migrate.',
);
process.exit(1);
