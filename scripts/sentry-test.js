try {
  const Sentry = require('../sentry');
  if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(new Error('Sentry setup OK — test event'));
    console.log('Sentry: test event sent');
  } else {
    console.log('Sentry: DSN not set (skipping)');
  }
} catch (e) {
  console.log('Sentry test skipped:', e.message);
}
