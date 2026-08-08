/**
 * Shared notification category catalog for Blyp settings UI.
 * Keep in sync with functions/src/notifications/userNotificationPreferences.ts
 */

export const NOTIFICATION_CATEGORIES = [
  'live',
  'message',
  'battle',
  'team',
  'call',
  'gift',
  'presence',
  'streak',
  'system',
  'topic',
  'follow',
  'social',
  'dating',
];

/** Non-spammy defaults — mirrors server DEFAULT_CATEGORY_ENABLED. */
export const DEFAULT_CATEGORY_ENABLED = {
  live: true,
  message: true,
  battle: true,
  team: true,
  call: true,
  gift: true,
  presence: true,
  streak: false,
  system: true,
  topic: true,
  follow: false,
  social: false,
  dating: false,
};

export const CATEGORY_META = {
  live: {
    title: 'Going live',
    subtitle: 'When someone you follow (or watch) starts a live',
  },
  message: {
    title: 'Messages',
    subtitle: 'Direct messages and group chats',
  },
  battle: {
    title: 'Battles',
    subtitle: 'Invites, accepts, schedules, and battle-live alerts',
  },
  team: {
    title: 'Teams',
    subtitle: 'Join requests, decisions, auditions, and team chat',
  },
  call: {
    title: 'Calls',
    subtitle: 'Incoming voice calls',
  },
  gift: {
    title: 'Gifts',
    subtitle: 'When someone gifts your posts',
  },
  presence: {
    title: 'Online alerts',
    subtitle: '"Notify me when they're online" watches',
  },
  streak: {
    title: 'Streak reminders',
    subtitle: 'Daily streak nudges',
  },
  system: {
    title: 'Blyp system',
    subtitle: 'Admin messages, welcome, and product notices',
  },
  topic: {
    title: 'Sport & topics',
    subtitle: 'Master switch — each topic still needs its own opt-in',
  },
  follow: {
    title: 'New followers',
    subtitle: 'When someone follows you (push when enabled)',
  },
  social: {
    title: 'Comments & likes',
    subtitle: 'Engagement on your posts (push when enabled)',
  },
  dating: {
    title: 'Dating',
    subtitle: 'Dating matches and related alerts',
  },
};

export const OVERRIDE_MODES = {
  everything: {
    title: 'Everything from this person',
    subtitle: 'Always ping — live, messages, gifts, calls, and more',
  },
  nothing: {
    title: 'Nothing from this person',
    subtitle: 'Mute all pushes from them (overrides global on)',
  },
  custom: {
    title: 'Custom',
    subtitle: 'Pick categories; unset ones follow your global settings',
  },
};
