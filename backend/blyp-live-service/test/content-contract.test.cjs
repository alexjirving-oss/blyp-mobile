const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lifecycle = require('../dist/content/contentLifecycle');
const schemas = require('../dist/content/contentSchemas');
const events = require('../dist/platform/events/eventRegistry');
const migrations = require('../dist/platform/migrations/runner');

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'content', 'contentRoutes.ts'),
  'utf8'
);
const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'content', 'contentService.ts'),
  'utf8'
);
const migrationSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'platform', 'migrations', '0004ContentFoundation.ts'),
  'utf8'
);

test('content schemas reject client authority and accept normalized canonical inputs', () => {
  const accepted = schemas.createPostSchema.parse({
    title: 'Canonical post',
    caption: 'A real post #Blyp',
    visibility: 'public',
    publish: true,
    media: [
      {
        clientAssetId: 'local-asset-1',
        kind: 'image',
        url: 'https://cdn.example.test/post.jpg',
        width: 1200,
        height: 900,
      },
    ],
    hashtags: ['#BLYP'],
    categoryIds: [],
  });
  assert.deepEqual(accepted.hashtags, ['blyp']);
  assert.equal(accepted.publish, true);

  assert.equal(
    schemas.createPostSchema.safeParse({
      caption: 'spoofed',
      authorUserId: 'another-user',
      lifecycleState: 'published',
    }).success,
    false
  );
  assert.equal(
    schemas.createPostSchema.safeParse({
      caption: '',
      title: '',
      media: [],
    }).success,
    false
  );
  assert.equal(
    schemas.mediaInputSchema.safeParse({
      clientAssetId: 'asset-1',
      kind: 'image',
      url: 'http://insecure.example.test/post.jpg',
    }).success,
    false
  );
});

test('moderation lifecycle allows only explicit transitions and removed is terminal', () => {
  assert.equal(lifecycle.canTransitionPostState('draft', 'published'), true);
  assert.equal(lifecycle.canTransitionPostState('published', 'restricted'), true);
  assert.equal(lifecycle.canTransitionPostState('restricted', 'published'), true);
  assert.equal(lifecycle.canTransitionPostState('removed', 'published'), false);
  assert.equal(lifecycle.canTransitionPostState('published', 'draft'), false);
  assert.throws(
    () => lifecycle.assertPostStateTransition('removed', 'published'),
    (error) => error.code === 'CONTENT_STATE_TRANSITION_INVALID'
  );
});

test('content lifecycle events are registered and payload-validated', () => {
  const required = [
    'content.profile.changed.v1',
    'content.post.created.v1',
    'content.post.updated.v1',
    'content.post.state_changed.v1',
  ];
  for (const eventType of required) {
    assert.ok(events.registeredEventTypes().includes(eventType), `${eventType} must be registered`);
  }
  assert.deepEqual(
    events.validateEventPayload('content.post.created.v1', {
      postId: '59f4b173-d8f3-4b16-b451-2f68c50cddc1',
      authorUserId: 'cognito-sub-1',
      lifecycleState: 'published',
      visibility: 'public',
      version: 1,
    }),
    {
      postId: '59f4b173-d8f3-4b16-b451-2f68c50cddc1',
      authorUserId: 'cognito-sub-1',
      lifecycleState: 'published',
      visibility: 'public',
      version: 1,
    }
  );
  assert.throws(
    () =>
      events.validateEventPayload('content.post.created.v1', {
        postId: 'not-a-uuid',
        authorUserId: 'cognito-sub-1',
        lifecycleState: 'published',
        visibility: 'public',
        version: 1,
      }),
    (error) => error.code === 'EVENT_PAYLOAD_INVALID'
  );
});

test('content migration is ordered, constrained, and flags are disabled by default', () => {
  const ids = migrations.platformMigrations.map((migration) => migration.id);
  const contentMigrationId = '0004_content_foundation';
  assert.equal(ids.filter((id) => id === contentMigrationId).length, 1);
  assert.deepEqual(ids, [...ids].sort());
  assert.ok(ids.indexOf(contentMigrationId) > ids.indexOf('0003_trust_foundation'));
  assert.equal(new Set(ids).size, ids.length);
  assert.match(migrationSource, /content_profiles/);
  assert.match(migrationSource, /content_posts/);
  assert.match(migrationSource, /content_media_assets/);
  assert.match(migrationSource, /content_moderation_history/);
  assert.match(migrationSource, /'content\.api_v1', false, 0/);
  assert.match(migrationSource, /'feed\.discovery_v1', false, 0/);
  assert.doesNotMatch(migrationSource, /INSERT INTO content_posts/i);
});

test('content mutations derive identity from Cognito and are idempotency-protected', () => {
  assert.match(routeSource, /req\.user\?\.sub/);
  assert.doesNotMatch(routeSource, /authorUserId\s*[:=]\s*req\.body/);
  assert.match(routeSource, /isFeatureEnabled\(db, CONTENT_FLAG, userId\)/);

  for (const [method, path] of [
    ['put', '/profiles/me'],
    ['post', '/posts'],
    ['patch', '/posts/:postId'],
    ['post', '/posts/:postId/publish'],
    ['delete', '/posts/:postId'],
  ]) {
    const declaration = routeSource.match(
      new RegExp(`contentRouter\\.${method}\\(\\s*'${path}',([\\s\\S]*?)asyncRoute`)
    );
    assert.ok(declaration, `missing mutation route declaration: ${method.toUpperCase()} ${path}`);
    assert.match(
      declaration[1],
      /requireMutationIdempotency/,
      `missing idempotency protection: ${method.toUpperCase()} ${path}`
    );
  }
  assert.match(serviceSource, /requireTrustPolicyInTransaction/);
  assert.match(serviceSource, /enqueueDomainEvent/);
  assert.match(serviceSource, /CONTENT_VERSION_CONFLICT/);
  assert.match(serviceSource, /SELECT pg_advisory_xact_lock/);
});
