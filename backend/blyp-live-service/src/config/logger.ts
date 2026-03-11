import pino from 'pino';

export const logger = pino({
  name: 'blyp-live-service',
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
});
