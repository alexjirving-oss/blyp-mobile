const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const FAILURES = [];
const WARNINGS = [];

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    FAILURES.push(`${relativePath}: required file is missing or unreadable`);
    return '';
  }
}

function requireText(relativePath, content, expected, reason) {
  if (!content.includes(expected)) {
    FAILURES.push(`${relativePath}: ${reason}`);
  }
}

function forbidText(relativePath, content, forbidden, reason) {
  if (content.includes(forbidden)) {
    FAILURES.push(`${relativePath}: ${reason}`);
  }
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    })
      .split('\0')
      .filter(Boolean)
      .map((file) => file.replace(/\\/g, '/'));
  } catch (error) {
    FAILURES.push(`git ls-files failed: ${error.message}`);
    return [];
  }
}

function runtimeFiles(files) {
  return files.filter((file) =>
    file === 'App.js' ||
    file.startsWith('src/') ||
    file.startsWith('backend/blyp-live-service/src/')
  );
}

const files = trackedFiles();
const fileSet = new Set(files);

const retiredFiles = [
  'src/components/FollowerBooster.js',
  'src/components/DeveloperCoinBooster.js',
  'src/utils/testDataGenerator.js',
  'src/data/mockData.js',
  'src/utils/videoFix.js',
];
for (const retiredFile of retiredFiles) {
  if (fileSet.has(retiredFile)) {
    FAILURES.push(`${retiredFile}: retired production hazard was reintroduced`);
  }
}

const sensitiveTrackedPath = /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:pem|p12|pfx)|service[-_.]?account[^/]*\.json)$/i;
for (const file of files) {
  if (sensitiveTrackedPath.test(file)) {
    FAILURES.push(`${file}: sensitive configuration or key material must not be tracked`);
  }
}

const forbiddenRuntimeSymbols = [
  ['addFakeFollowers', 'fake-follower mutation path is forbidden'],
  ['addDeveloperCoins', 'developer coin-minting path is forbidden'],
  ['generateAndAddComments', 'generated engagement mutation path is forbidden'],
  ['AICommentGenerator', 'generated engagement service must not be reachable from runtime code'],
  ['DEV_ACCESS_CODE', 'hard-coded developer access code is forbidden'],
  ['adminSessions', 'in-memory administrator bearer sessions are forbidden'],
  ["'/admin/login'", 'administrator password-login endpoint is forbidden'],
  ['"/admin/login"', 'administrator password-login endpoint is forbidden'],
  ['SAMPLE_VIDEO_URL', 'unrelated sample-media fallback is forbidden'],
  ['selectedPlatforms', 'unsupported third-party delivery selection is forbidden'],
  ['Cross-post', 'unsupported third-party delivery claim is forbidden'],
];

for (const file of runtimeFiles(files)) {
  const content = read(file);
  for (const [symbol, reason] of forbiddenRuntimeSymbols) {
    if (content.includes(symbol)) {
      FAILURES.push(`${file}: ${reason} (${symbol})`);
    }
  }
  if (content.includes('sharedTo') && !(file === 'src/screens/ReviewScreen.js' && /sharedTo\s*:\s*\[\s*\]/.test(content))) {
    FAILURES.push(`${file}: unverified third-party delivery state is forbidden`);
  }
}

const app = read('App.js');
requireText('App.js', app, 'EXPO_PUBLIC_DEV_FORCE_NO_AUTH', 'development bypass must use the explicit development-only flag');
requireText('App.js', app, '__DEV__ === true', 'development bypass must be guarded by the compile-time development constant');
requireText('App.js', app, 'if (!user?.sub) return undefined;', 'server feature flags must refresh only for a verified canonical subject');
forbidText('App.js', app, 'EXPO_PUBLIC_SKIP_AUTH', 'legacy production-capable auth bypass is forbidden');

const verifier = read('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts');
requireText('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts', verifier, "algorithms: ['RS256']", 'JWT verification must pin RS256');
requireText('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts', verifier, "options.tokenUse ?? 'access'", 'platform APIs must default to Cognito access tokens');
requireText('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts', verifier, 'decoded.token_use !== expectedUse', 'JWT token use must be enforced');
requireText('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts', verifier, 'config.allowedClientIds.has(clientId)', 'JWT app-client allowlisting must be enforced');
requireText('backend/blyp-live-service/src/auth/verifyCognitoJwt.ts', verifier, "typeof decoded.sub !== 'string'", 'canonical Cognito subject must be validated');

const adminRoutes = read('backend/blyp-live-service/src/admin/adminRoutes.ts');
requireText('backend/blyp-live-service/src/admin/adminRoutes.ts', adminRoutes, 'cognitoJwtMiddleware', 'administrator routes must require verified Cognito identity');
requireText('backend/blyp-live-service/src/admin/adminRoutes.ts', adminRoutes, 'getAdminEnv', 'administrator authorization must use centralized allowlist configuration');
requireText('backend/blyp-live-service/src/admin/adminRoutes.ts', adminRoutes, "router.post('/admin/auth/login'", 'legacy administrator login compatibility route must remain explicit');
requireText('backend/blyp-live-service/src/admin/adminRoutes.ts', adminRoutes, 'res.status(410)', 'legacy administrator password login must remain disabled with an HTTP 410 tombstone');
requireText('backend/blyp-live-service/src/admin/adminRoutes.ts', adminRoutes, 'ADMIN_PASSWORD_LOGIN_DISABLED', 'legacy administrator password login must expose only the disabled compatibility response');

const apiClient = read('src/services/platformApiClient.js');
requireText('src/services/platformApiClient.js', apiClient, 'getCanonicalAccessToken', 'mobile platform transport must use canonical Cognito access tokens');
requireText('src/services/platformApiClient.js', apiClient, "'X-Correlation-Id'", 'mobile platform transport must send a correlation ID');
requireText('src/services/platformApiClient.js', apiClient, "'X-Client-Version'", 'mobile platform transport must send a client version');
requireText('src/services/platformApiClient.js', apiClient, "'Idempotency-Key'", 'mobile mutation transport must support idempotency keys');
requireText('src/services/platformApiClient.js', apiClient, 'SAFE_METHODS.has(method) || Boolean(idempotencyKey)', 'automatic retries must be limited to safe or idempotent operations');

const flags = read('src/config/FeatureFlags.js');
requireText('src/config/FeatureFlags.js', flags, 'manifestEnabled: false', 'feature flags must initialize disabled');
requireText('src/config/FeatureFlags.js', flags, 'playlistViewerEnabled: false', 'feature flags must initialize disabled');
requireText('src/config/FeatureFlags.js', flags, 'catch {', 'feature-flag refresh must handle service failure');
requireText('src/config/FeatureFlags.js', flags, 'configuration always resolves to disabled', 'feature-flag failure behavior must remain explicitly fail-closed');

const migrations = read('backend/blyp-live-service/src/platform/migrations/runner.ts');
requireText('backend/blyp-live-service/src/platform/migrations/runner.ts', migrations, 'acquireConnection()', 'migration advisory lock must use one dedicated database connection');
requireText('backend/blyp-live-service/src/platform/migrations/runner.ts', migrations, 'pg_advisory_lock', 'migration execution must be serialized with a PostgreSQL advisory lock');

const firestoreRules = read('firestore.rules');
if (/allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(firestoreRules)) {
  FAILURES.push('firestore.rules: unauthenticated catch-all read/write is forbidden');
}
if (/match\s+\/\{document=\*\*\}[\s\S]*allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null/.test(firestoreRules)) {
  WARNINGS.push('firestore.rules still uses a legacy authenticated catch-all policy; replace it with collection-specific authorization before production release');
}

if (WARNINGS.length) {
  console.warn('Production integrity warnings:');
  for (const warning of WARNINGS) console.warn(`  - ${warning}`);
}

if (FAILURES.length) {
  console.error('Production integrity gate failed:');
  for (const failure of FAILURES) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Production integrity gate passed (${files.length} tracked files inspected).`);
