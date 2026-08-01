const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schemas = require('../dist/content/discoverySchemas');
const service = require('../dist/content/discoveryService');

const source = (relative) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...relative.split('/')), 'utf8');
const serviceSource = source('content/discoveryService.ts');
const routeSource = source('content/discoveryRoutes.ts');
const migrationSource = source('platform/migrations/0004ContentFoundation.ts');

test('feed and search query contracts are bounded, strict, and normalize hashtags', () => {
  assert.deepEqual(
    schemas.feedQuerySchema.parse({ limit: '50', hashtag: '#BLYP', mediaKind: 'video' }),
    { limit: 50, hashtag: 'blyp', mediaKind: 'video' }
  );
  assert.equal(schemas.feedQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(schemas.feedQuerySchema.safeParse({ limit: 20, unknown: 'field' }).success, false);
  assert.equal(schemas.searchQuerySchema.safeParse({ q: 'a' }).success, false);
  assert.equal(
    schemas.searchQuerySchema.safeParse({ q: 'blyp', types: 'profile,unsupported' }).success,
    false
  );
  assert.deepEqual(schemas.searchQuerySchema.parse({ q: 'blyp' }).types, [
    'profile',
    'post',
    'category',
    'hashtag',
  ]);
});

test('feed exposes a deterministic candidate version and never claims final ranking', () => {
  assert.equal(service.FEED_RANKING_VERSION, 'candidate.recency.v1');
  assert.match(serviceSource, /orderBy\('post\.published_at', 'desc'\)/);
  assert.match(serviceSource, /orderBy\('post\.post_id', 'desc'\)/);
  assert.doesNotMatch(serviceSource, /Math\.random|shuffle|recommendedForYou|final\.ranking/i);
  assert.match(serviceSource, /CANONICAL_PUBLISHED/);
  assert.match(serviceSource, /TRUST_ELIGIBLE/);
});

test('all personal discovery candidates are filtered through the shared Trust policy', () => {
  assert.match(serviceSource, /evaluateTrustPolicy/);
  assert.match(serviceSource, /capability: actorUserId === targetUserId \? 'transact' : capability/);
  assert.match(serviceSource, /if \(!\(await trustAllows\(actorUserId, String\(row\.author_user_id\), 'view'/);
  assert.match(serviceSource, /'discover', trustCache/);
  assert.doesNotMatch(serviceSource, /trust_relationship_controls.*select/i);
});

test('search uses canonical PostgreSQL documents and has no Firebase or fabricated fallback', () => {
  assert.match(migrationSource, /CREATE OR REPLACE VIEW content_search_documents/);
  assert.match(migrationSource, /'profile'::text AS entity_type/);
  assert.match(migrationSource, /'post'::text AS entity_type/);
  assert.match(migrationSource, /'category'::text AS entity_type/);
  assert.match(migrationSource, /'hashtag'::text AS entity_type/);
  assert.match(serviceSource, /websearch_to_tsquery/);
  assert.doesNotMatch(serviceSource, /firebase|mock|fallback|sample/i);
});

test('discovery routes are authenticated, versioned, rate-limited, and distinct by domain', () => {
  assert.match(routeSource, /requireClientVersion/);
  assert.match(routeSource, /cognitoJwtMiddleware/);
  assert.match(routeSource, /isFeatureEnabled\(db, DISCOVERY_FLAG, userId\)/);
  assert.match(routeSource, /'\/feed'/);
  assert.match(routeSource, /'\/search'/);
  assert.match(routeSource, /'\/categories'/);
  assert.match(routeSource, /'\/categories\/:categoryId\/posts'/);
  assert.match(routeSource, /'\/hashtags'/);
  assert.match(routeSource, /'\/hashtags\/:tag\/posts'/);
  assert.match(migrationSource, /'feed\.discovery_v1', false, 0/);
});
