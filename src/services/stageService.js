/**
 * Stage personal page — fields live on users/{uid}.stage (+ existing profile fields).
 * No parallel identity object; @username remains canonical.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import {
  DEFAULT_STAGE_THEME_ID,
  STAGE_DISPLAY_NAME_MAX,
  STAGE_LINK_LABEL_MAX,
  STAGE_MAX_LINKS,
  STAGE_MAX_PINS,
  STAGE_MAX_TOP_CIRCLE,
  STAGE_VIBE_MAX,
  getStageThemePack,
  getStageWallpaper,
} from './stageCatalog';
import {
  normalizeProfileBadges,
  normalizeProfileClubs,
} from './profileIdentityCatalog';
import { normalizeProfileCategories } from '../utils/profileCategories';

const SCHEME_BLOCKLIST = /^(javascript|data|vbscript|file):/i;

const pickStr = (...vals) =>
  vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v.length > 0) || '';

const clampStr = (value, max) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
};

const makeLinkId = () => `lnk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function sanitizeStageUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (SCHEME_BLOCKLIST.test(u)) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
    u = `https://${u}`;
  }
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function normalizeStageLink(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const url = sanitizeStageUrl(raw.url || raw.href);
  if (!url) return null;
  const label = clampStr(raw.label || raw.title || `Link ${index + 1}`, STAGE_LINK_LABEL_MAX) || `Link ${index + 1}`;
  const id = pickStr(raw.id) || makeLinkId();
  return { id, label, url };
}

export function normalizeStageModules(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    about: src.about !== false,
    links: src.links !== false,
    topCircle: src.topCircle !== false,
    showcase: src.showcase !== false,
  };
}

export function normalizeStageConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const themeId = getStageThemePack(src.themeId || DEFAULT_STAGE_THEME_ID).id;
  const coverUrl = pickStr(src.coverUrl);
  const coverWallpaperId = getStageWallpaper(src.coverWallpaperId)?.id || null;
  const links = (Array.isArray(src.links) ? src.links : [])
    .map((l, i) => normalizeStageLink(l, i))
    .filter(Boolean)
    .slice(0, STAGE_MAX_LINKS);
  const topCircle = (Array.isArray(src.topCircle) ? src.topCircle : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, STAGE_MAX_TOP_CIRCLE);
  const pinnedPostIds = (Array.isArray(src.pinnedPostIds) ? src.pinnedPostIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, STAGE_MAX_PINS);

  return {
    displayName: clampStr(src.displayName, STAGE_DISPLAY_NAME_MAX),
    themeId,
    coverUrl: coverUrl || null,
    coverWallpaperId,
    vibe: clampStr(src.vibe, STAGE_VIBE_MAX),
    links,
    topCircle,
    pinnedPostIds,
    modules: normalizeStageModules(src.modules),
    showPastLives: src.showPastLives === true,
  };
}

export function defaultStageConfig() {
  return normalizeStageConfig({});
}

/**
 * Merge Firestore user doc + stage config into a Stage model for the shared renderer.
 */
export function buildStageModel(userId, userData = {}, stageOverride = null) {
  const data = userData && typeof userData === 'object' ? userData : {};
  const stage = normalizeStageConfig(stageOverride || data.stage);
  const username = pickStr(data.username, data.handle, data.displayName) || 'user';
  const handle = username.startsWith('@') ? username.slice(1) : username;
  const stageName = stage.displayName || '';
  const publicName = stageName || pickStr(data.displayName, handle) || handle;

  return {
    userId: String(userId || ''),
    username: handle,
    displayName: publicName,
    stageDisplayName: stageName,
    bio: pickStr(data.bio),
    pronouns: pickStr(data.pronouns),
    location: pickStr(data.location, data.city),
    country: pickStr(data.country),
    website: pickStr(data.website),
    photoURL: pickStr(data.photoURL, data.avatar) || null,
    verified: data.verified === true,
    profileClubs: normalizeProfileClubs(data.profileClubs),
    profileBadges: normalizeProfileBadges(data.profileBadges),
    profileCategories: normalizeProfileCategories(data.profileCategories),
    stage,
    theme: getStageThemePack(stage.themeId),
    wallpaper: stage.coverWallpaperId ? getStageWallpaper(stage.coverWallpaperId) : null,
  };
}

export async function fetchStageModel(userId) {
  if (!userId) return null;
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) {
    return buildStageModel(userId, {}, null);
  }
  return buildStageModel(userId, snap.data(), null);
}

/**
 * Persist Stage customization. Does not overwrite core identity fields
 * except optional stage.displayName (separate from @username).
 */
export async function saveStageConfig(userId, partial) {
  if (!userId) throw new Error('userId required');
  const existingSnap = await getDoc(doc(db, 'users', userId));
  const existing = existingSnap.exists() ? existingSnap.data() : {};
  const next = normalizeStageConfig({
    ...(existing.stage || {}),
    ...(partial || {}),
  });
  await setDoc(
    doc(db, 'users', userId),
    {
      stage: next,
      updatedAt: new Date(),
    },
    { merge: true },
  );
  return next;
}

/** Build checklist for empty Stage owner guidance. */
export function buildStageChecklist(model) {
  if (!model) return [];
  const stage = model.stage || defaultStageConfig();
  return [
    {
      id: 'cover',
      label: 'Add a cover',
      done: Boolean(stage.coverUrl || stage.coverWallpaperId),
    },
    {
      id: 'about',
      label: 'Write a bio or vibe',
      done: Boolean(model.bio || stage.vibe),
    },
    {
      id: 'theme',
      label: 'Pick a theme pack',
      done: Boolean(stage.themeId && stage.themeId !== DEFAULT_STAGE_THEME_ID),
    },
    {
      id: 'links',
      label: 'Add up to 5 links',
      done: (stage.links || []).length > 0,
    },
    {
      id: 'circle',
      label: 'Feature your Top Circle',
      done: (stage.topCircle || []).length > 0,
    },
    {
      id: 'pins',
      label: 'Pin up to 3 posts',
      done: (stage.pinnedPostIds || []).length > 0,
    },
  ];
}
