'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(backendRoot, '..', '..');
const migrations = require(path.join(backendRoot, 'dist', 'platform', 'migrations', 'runner.js'));
const events = require(path.join(backendRoot, 'dist', 'platform', 'events', 'eventRegistry.js'));

function source(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

const indexSource = source(backendRoot, 'src', 'index.ts');
const contentRoutesSource = source(backendRoot, 'src', 'content', 'contentRoutes.ts');
const discoveryRoutesSource = source(backendRoot, 'src', 'content', 'discoveryRoutes.ts');
const economyRoutesSource = source(backendRoot, 'src', 'economy', 'economyApiRoutes.ts');
const contentServiceSource = source(backendRoot, 'src', 'content', 'contentService.ts');
const discoveryServiceSource = source(backendRoot, 'src', 'content', 'discoveryService.ts');
const entitlementServiceSource = source(backendRoot, 'src', 'economy', 'entitlementService.ts');
const contentMigrationSource = source(
  backendRoot,
  'src',
  'platform',
  'migrations',
  '0004ContentFoundation.ts'
);
const entitlementMigrationSource = source(
  backendRoot,
  'src',
  'platform',
  'migrations',
  '0005EconomyEntitlements.ts'
);
const firestoreRulesSource = source(repositoryRoot, 'firestore.rules');

test('Wave 4 migrations and event schemas compose without collisions', () => {
  const migrationIds = migrations.platformMigrations.map((migration) => migration.id);
  assert.deepEqual(migrationIds, [...migrationIds].sort());
  assert.equal(new Set(migrationIds).size, migrationIds.length);
  assert.equal(
    migrationIds.filter((id) => id === '0004_content_foundation').length,
    1
  );
  assert.equal(
    migrationIds.filter((id) => id === '0005_economy_entitlements').length,
    1
  );
  assert.ok(
    migrationIds.indexOf('0004_content_foundation') <
      migrationIds.indexOf('0005_economy_entitlements')
  );

  const registered = new Set(events.registeredEventTypes());
  for (const eventType of [
    'content.profile.changed.v1',
    'content.post.created.v1',
    'content.post.updated.v1',
    'content.post.state_changed.v1',
    'economy.quota.reserved.v1',
    'economy.quota.committed.v1',
    'economy.quota.refunded.v1',
    'economy.quota.expired.v1',
  ]) {
    assert.ok(registered.has(eventType), `missing integrated event schema: ${eventType}`);
    events.validateEventVersion(eventType, 1);
  }

  assert.deepEqual(
    events.validateEventPayload('content.post.state_changed.v1', {
      postId: '00000000-0000-4000-8000-000000000001',
      authorUserId: 'cognito-sub-content-author',
      fromState: 'pending_review',
      toState: 'published',
      reasonCode: 'moderation_approved',
      version: 3,
    }),
    {
      postId: '00000000-0000-4000-8000-000000000001',
      authorUserId: 'cognito-sub-content-author',
      fromState: 'pending_review',
      toState: 'published',
      reasonCode: 'moderation_approved',
      version: 3,
    }
  );

  assert.deepEqual(
    events.validateEventPayload('economy.quota.reserved.v1', {
      userId: 'cognito-sub-quota-user',
      entitlementKey: 'ai.generate.image',
      planId: 'free',
      reservationId: '00000000-0000-4000-8000-000000000002',
      quotaPeriodId: '00000000-0000-4000-8000-000000000003',
      units: 1,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-02T00:00:00.000Z',
      remainingUnits: 0,
    }),
    {
      userId: 'cognito-sub-quota-user',
      entitlementKey: 'ai.generate.image',
      planId: 'free',
      reservationId: '00000000-0000-4000-8000-000000000002',
      quotaPeriodId: '00000000-0000-4000-8000-000000000003',
      units: 1,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-02T00:00:00.000Z',
      remainingUnits: 0,
    }
  );
});

test('all Wave 4 APIs are versioned, mounted before v1 not-found, and disabled by default', () => {
  assert.match(contentMigrationSource, /'content\.api_v1'\s*,\s*false\s*,\s*0/);
  assert.match(contentMigrationSource, /'feed\.discovery_v1'\s*,\s*false\s*,\s*0/);
  assert.match(
    entitlementMigrationSource,
    /'economy\.entitlements_v1'\s*,\s*false\s*,\s*0/
  );

  assert.match(contentRoutesSource, /const CONTENT_FLAG = 'content\.api_v1'/);
  assert.match(discoveryRoutesSource, /const DISCOVERY_FLAG = 'feed\.discovery_v1'/);
  assert.match(economyRoutesSource, /const ENTITLEMENTS_FLAG = 'economy\.entitlements_v1'/);
  for (const routeSource of [contentRoutesSource, discoveryRoutesSource, economyRoutesSource]) {
    assert.match(routeSource, /isFeatureEnabled\(/);
    assert.match(routeSource, /FEATURE_DISABLED/);
  }

  const notFoundIndex = indexSource.indexOf("app.use('/api/v1', platformNotFound);");
  assert.ok(notFoundIndex > 0, 'missing the versioned API terminal not-found handler');
  for (const mount of [
    "app.use('/api/v1/economy', economyApiRouter);",
    "app.use('/api/v1/content', contentRouter);",
    "app.use('/api/v1/discovery', discoveryRouter);",
  ]) {
    const mountIndex = indexSource.indexOf(mount);
    assert.ok(mountIndex > 0, `missing integrated router mount: ${mount}`);
    assert.ok(mountIndex < notFoundIndex, `router mounted after v1 not-found: ${mount}`);
  }
  assert.ok(
    indexSource.indexOf("app.use('/api', liveRoutes);") > notFoundIndex,
    'legacy routes must remain outside the versioned gateway contract'
  );
});

test('content, discovery, and quota decisions reuse Trust and discovery fails closed', () => {
  assert.match(contentServiceSource, /requireTrustPolicyInTransaction/);
  assert.match(entitlementServiceSource, /requireTrustPolicyInTransaction/);
  assert.match(discoveryServiceSource, /evaluateTrustPolicy/);
  assert.match(
    discoveryServiceSource,
    /catch \{\s*cache\.set\(cacheKey, false\);\s*return false;\s*\}/
  );
  assert.doesNotMatch(discoveryServiceSource, /Math\.random|fabricat|fallbackResult/i);
});

test('Firestore has explicit client domains, server-owned economy denies, and recursive default deny', () => {
  for (const explicitClientDomain of [
    'match /users/{userId}',
    'match /posts/{postId}',
    'match /chats/{chatId}',
    'match /liveStreams/{streamId}',
  ]) {
    assert.match(firestoreRulesSource, new RegExp(explicitClientDomain.replace(/[{}]/g, '\\$&')));
  }

  for (const serverOwnedDomain of ['wallets', 'transactions', 'ledger_entries']) {
    assert.match(
      firestoreRulesSource,
      new RegExp(`match /${serverOwnedDomain}/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`)
    );
  }
  assert.doesNotMatch(firestoreRulesSource, /allow read, write: if isSignedIn\(\);/);

  const recursiveDefault = firestoreRulesSource.slice(
    firestoreRulesSource.lastIndexOf('match /{document=**}')
  );
  assert.match(recursiveDefault, /allow read, write: if false;/);
  assert.doesNotMatch(recursiveDefault, /isSignedIn/);
});
