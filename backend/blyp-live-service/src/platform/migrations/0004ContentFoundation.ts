import type { PlatformMigration } from './types';

export const contentFoundationMigration: PlatformMigration = {
  id: '0004_content_foundation',
  description: 'Create canonical profiles, posts, media, taxonomy, hashtag, and moderation foundations.',
  transactional: true,
  reversible: false,
  async up(db) {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_profiles (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        display_name text NOT NULL,
        bio text NOT NULL DEFAULT '',
        avatar_url text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(user_id) BETWEEN 1 AND 256),
        CHECK (username ~ '^[A-Za-z0-9_]{3,32}$'),
        CHECK (length(display_name) BETWEEN 1 AND 80),
        CHECK (length(bio) <= 500),
        CHECK (avatar_url IS NULL OR avatar_url ~ '^https://'),
        CHECK (version > 0)
      )
    `);
    await db.raw(`CREATE UNIQUE INDEX IF NOT EXISTS uq_content_profiles_username_ci ON content_profiles (lower(username))`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_profiles_search ON content_profiles (lower(username), lower(display_name))`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_categories (
        category_id uuid PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        display_name text NOT NULL,
        description text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
        CHECK (length(slug) BETWEEN 2 AND 64),
        CHECK (length(display_name) BETWEEN 1 AND 80),
        CHECK (length(description) <= 500)
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_posts (
        post_id uuid PRIMARY KEY,
        author_user_id text NOT NULL REFERENCES content_profiles(user_id) ON DELETE RESTRICT,
        title text NOT NULL DEFAULT '',
        caption text NOT NULL DEFAULT '',
        visibility text NOT NULL DEFAULT 'followers',
        lifecycle_state text NOT NULL DEFAULT 'draft',
        ranking_seed bigint NOT NULL,
        published_at timestamptz,
        removed_at timestamptz,
        moderation_reason_code text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        search_document tsvector GENERATED ALWAYS AS (
          to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(caption, ''))
        ) STORED,
        CHECK (length(title) <= 160),
        CHECK (length(caption) <= 5000),
        CHECK (visibility IN ('public', 'followers', 'private')),
        CHECK (lifecycle_state IN ('draft', 'pending_review', 'published', 'restricted', 'rejected', 'removed')),
        CHECK (moderation_reason_code IS NULL OR length(moderation_reason_code) BETWEEN 1 AND 64),
        CHECK (version > 0),
        CHECK (
          (lifecycle_state = 'published' AND published_at IS NOT NULL AND removed_at IS NULL)
          OR (lifecycle_state = 'removed' AND removed_at IS NOT NULL)
          OR lifecycle_state IN ('draft', 'pending_review', 'restricted', 'rejected')
        )
      )
    `);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_posts_author ON content_posts (author_user_id, created_at DESC, post_id DESC)`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_posts_candidates ON content_posts (published_at DESC, post_id DESC) WHERE lifecycle_state = 'published'`);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_posts_search ON content_posts USING GIN (search_document)`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_media_assets (
        media_id uuid PRIMARY KEY,
        post_id uuid NOT NULL REFERENCES content_posts(post_id) ON DELETE CASCADE,
        client_asset_id text NOT NULL,
        media_kind text NOT NULL,
        media_url text NOT NULL,
        thumbnail_url text,
        mime_type text,
        width integer,
        height integer,
        duration_ms integer,
        alt_text text,
        position integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (post_id, client_asset_id),
        UNIQUE (post_id, position),
        CHECK (length(client_asset_id) BETWEEN 1 AND 128),
        CHECK (media_kind IN ('image', 'video', 'audio')),
        CHECK (media_url ~ '^https://'),
        CHECK (thumbnail_url IS NULL OR thumbnail_url ~ '^https://'),
        CHECK (mime_type IS NULL OR length(mime_type) BETWEEN 3 AND 128),
        CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0)),
        CHECK (duration_ms IS NULL OR duration_ms >= 0),
        CHECK (alt_text IS NULL OR length(alt_text) <= 1000),
        CHECK (position >= 0)
      )
    `);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_media_post ON content_media_assets (post_id, position)`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_hashtags (
        hashtag_id uuid PRIMARY KEY,
        tag text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (tag ~ '^[[:alnum:]_]{1,64}$')
      )
    `);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_post_categories (
        post_id uuid NOT NULL REFERENCES content_posts(post_id) ON DELETE CASCADE,
        category_id uuid NOT NULL REFERENCES content_categories(category_id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (post_id, category_id)
      )
    `);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_post_categories_category ON content_post_categories (category_id, post_id)`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_post_hashtags (
        post_id uuid NOT NULL REFERENCES content_posts(post_id) ON DELETE CASCADE,
        hashtag_id uuid NOT NULL REFERENCES content_hashtags(hashtag_id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (post_id, hashtag_id)
      )
    `);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_post_hashtags_hashtag ON content_post_hashtags (hashtag_id, post_id)`);

    await db.raw(`
      CREATE TABLE IF NOT EXISTS content_moderation_history (
        moderation_event_id uuid PRIMARY KEY,
        post_id uuid NOT NULL REFERENCES content_posts(post_id) ON DELETE CASCADE,
        actor_user_id text NOT NULL,
        from_state text,
        to_state text NOT NULL,
        reason_code text NOT NULL,
        notes text,
        post_version integer NOT NULL,
        correlation_id text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (from_state IS NULL OR from_state IN ('draft', 'pending_review', 'published', 'restricted', 'rejected', 'removed')),
        CHECK (to_state IN ('draft', 'pending_review', 'published', 'restricted', 'rejected', 'removed')),
        CHECK (length(reason_code) BETWEEN 1 AND 64),
        CHECK (notes IS NULL OR length(notes) <= 2000),
        CHECK (post_version > 0),
        CHECK (length(correlation_id) BETWEEN 1 AND 256)
      )
    `);
    await db.raw(`CREATE INDEX IF NOT EXISTS idx_content_moderation_post ON content_moderation_history (post_id, occurred_at DESC)`);

    await db.raw(`
      CREATE OR REPLACE VIEW content_search_documents AS
      SELECT
        'profile'::text AS entity_type,
        profile.user_id::text AS entity_id,
        profile.user_id::text AS owner_user_id,
        profile.username::text AS title,
        (profile.display_name || ' ' || profile.bio)::text AS subtitle,
        profile.updated_at,
        to_tsvector('simple', profile.username || ' ' || profile.display_name || ' ' || profile.bio) AS search_document
      FROM content_profiles profile
      UNION ALL
      SELECT
        'post'::text AS entity_type,
        post.post_id::text AS entity_id,
        post.author_user_id::text AS owner_user_id,
        post.title::text AS title,
        post.caption::text AS subtitle,
        post.updated_at,
        post.search_document
      FROM content_posts post
      WHERE post.lifecycle_state = 'published' AND post.visibility = 'public'
      UNION ALL
      SELECT
        'category'::text AS entity_type,
        category.category_id::text AS entity_id,
        NULL::text AS owner_user_id,
        category.slug::text AS title,
        (category.display_name || ' ' || category.description)::text AS subtitle,
        category.updated_at,
        to_tsvector('simple', category.slug || ' ' || category.display_name || ' ' || category.description) AS search_document
      FROM content_categories category
      WHERE category.active = true
      UNION ALL
      SELECT
        'hashtag'::text AS entity_type,
        hashtag.hashtag_id::text AS entity_id,
        NULL::text AS owner_user_id,
        hashtag.tag::text AS title,
        ''::text AS subtitle,
        hashtag.created_at AS updated_at,
        to_tsvector('simple', hashtag.tag) AS search_document
      FROM content_hashtags hashtag
    `);

    await db.raw(`
      INSERT INTO feature_flags (flag_key, enabled, rollout_percentage, description)
      VALUES
        ('content.api_v1', false, 0, 'Enable canonical content profile and post contracts.'),
        ('feed.discovery_v1', false, 0, 'Enable canonical feed, search, category, and hashtag contracts.')
      ON CONFLICT (flag_key) DO NOTHING
    `);
  },
};
