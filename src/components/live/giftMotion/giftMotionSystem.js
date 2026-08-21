/**
 * Blyp Gift Motion System — catalog, tiers, budgets, palette.
 *
 * Identity: Mercedes-AMG PETRONAS teal + live/sport energy.
 * Avoid purple AI sludge; gold reserved for legendary climax only.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { COLORS } from '../../../styles/theme';

export const TEAL = COLORS.primary;
export const TEAL_DARK = COLORS.primaryDark;
export const TEAL_LIGHT = COLORS.primaryLight;
export const ENERGY_ORANGE = '#F59E0B';
export const ENERGY_RED = '#EF4444';
export const GOLD = '#FBBF24';
export const CRYSTAL = '#A5F3FC';
export const INK = '#0B1220';

/** Motion tier taxonomy (maps coin cost → screen treatment). */
export const MOTION_TIERS = {
  small: {
    id: 'small',
    label: 'Small',
    coinMax: 5,
    entranceMs: 280,
    climaxMs: 420,
    lingerMs: 700,
    exitMs: 320,
    screenShare: 0.18,
    comboMultiplierVisual: 1,
    takeover: false,
    skippable: false,
  },
  mid: {
    id: 'mid',
    label: 'Mid',
    coinMax: 20,
    entranceMs: 320,
    climaxMs: 700,
    lingerMs: 900,
    exitMs: 360,
    screenShare: 0.42,
    comboMultiplierVisual: 1.15,
    takeover: 'spotlight',
    skippable: false,
  },
  epic: {
    id: 'epic',
    label: 'Epic',
    coinMax: 40,
    entranceMs: 380,
    climaxMs: 1100,
    lingerMs: 1400,
    exitMs: 420,
    screenShare: 0.72,
    comboMultiplierVisual: 1.35,
    takeover: 'fullscreen',
    skippable: true,
  },
  legendary: {
    id: 'legendary',
    label: 'Legendary',
    coinMax: 80,
    entranceMs: 420,
    climaxMs: 1600,
    lingerMs: 2000,
    exitMs: 480,
    screenShare: 0.9,
    comboMultiplierVisual: 1.55,
    takeover: 'fullscreen',
    skippable: true,
  },
  ultimate: {
    id: 'ultimate',
    label: 'Ultimate',
    coinMax: Infinity,
    entranceMs: 480,
    climaxMs: 2200,
    lingerMs: 2600,
    exitMs: 520,
    screenShare: 1,
    comboMultiplierVisual: 1.8,
    takeover: 'fullscreen',
    skippable: true,
  },
};

/**
 * Per-gift cinematic specs for P0 set.
 * `palette` drives rays/rings/banners; `motif` selects choreography branch.
 */
export const GIFT_MOTION = {
  heart: {
    giftId: 'heart',
    emoji: '❤️',
    name: 'Heart',
    coinCost: 1,
    rarity: 'common',
    motionTier: 'small',
    motif: 'pulse_bloom',
    palette: [TEAL_DARK, TEAL, TEAL_LIGHT],
    particles: ['✨', '💫', '❤️'],
    audioKey: 'gift_heart',
    p0: true,
  },
  thumbsup: {
    giftId: 'thumbsup',
    emoji: '👍',
    name: 'Thumbs Up',
    coinCost: 2,
    rarity: 'common',
    motionTier: 'small',
    motif: 'pop_ack',
    palette: [TEAL_DARK, TEAL, '#E2E8F0'],
    particles: ['✨', '👍'],
    audioKey: 'gift_pop',
    p0: false,
  },
  clap: {
    giftId: 'clap',
    emoji: '👏',
    name: 'Clap',
    coinCost: 5,
    rarity: 'common',
    motionTier: 'small',
    motif: 'shock_clap',
    palette: [TEAL_DARK, TEAL, ENERGY_ORANGE],
    particles: ['✨', '👏', '💫'],
    audioKey: 'gift_clap',
    p0: true,
  },
  fire: {
    giftId: 'fire',
    emoji: '🔥',
    name: 'Fire',
    coinCost: 10,
    rarity: 'rare',
    motionTier: 'mid',
    motif: 'flame_column',
    cinemaId: 'fire',
    cinematicV2: true,
    filmClip: true,
    palette: ['#7C2D12', ENERGY_RED, ENERGY_ORANGE],
    particles: ['🔥', '✨', '💥'],
    audioKey: 'gift_fire',
    p0: true,
  },
  star: {
    giftId: 'star',
    emoji: '⭐',
    name: 'Star',
    coinCost: 15,
    rarity: 'rare',
    motionTier: 'mid',
    motif: 'constellation',
    palette: [TEAL_DARK, TEAL, GOLD],
    particles: ['⭐', '✨', '🌟'],
    audioKey: 'gift_star',
    p0: true,
  },
  diamond: {
    giftId: 'diamond',
    emoji: '💎',
    name: 'Diamond',
    coinCost: 25,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'crystal_prism',
    cinemaId: 'diamond',
    cinematicV2: true,
    filmClip: true,
    palette: ['#0E7490', CRYSTAL, TEAL_LIGHT],
    particles: ['💎', '✨', '💠'],
    audioKey: 'gift_diamond',
    p0: true,
  },
  cheer_burst: {
    giftId: 'cheer_burst',
    emoji: '💨',
    name: 'Cheer Burst',
    coinCost: 25,
    rarity: 'rare',
    motionTier: 'epic',
    motif: 'stadium_wave',
    cinemaId: 'cheer_burst',
    cinematicV2: true,
    filmClip: true,
    palette: [TEAL_DARK, TEAL, ENERGY_ORANGE],
    particles: ['💨', '👏', '✨'],
    audioKey: 'gift_cheer',
    p0: true,
  },
  revive: {
    giftId: 'revive',
    emoji: '🛟',
    name: 'Revive',
    coinCost: 30,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'life_ring',
    palette: [TEAL_DARK, TEAL, '#FDE68A'],
    particles: ['🛟', '✨', '💚'],
    audioKey: 'gift_revive',
    p0: false,
  },
  crown: {
    giftId: 'crown',
    emoji: '👑',
    name: 'Crown',
    coinCost: 50,
    rarity: 'legendary',
    motionTier: 'legendary',
    motif: 'regal_drop',
    cinemaId: 'crown',
    cinematicV2: true,
    filmClip: true,
    palette: ['#92400E', GOLD, TEAL],
    particles: ['👑', '✨', '⭐'],
    audioKey: 'gift_crown',
    p0: true,
  },
  rocket: {
    giftId: 'rocket',
    emoji: '🚀',
    name: 'Rocket',
    coinCost: 100,
    rarity: 'legendary',
    motionTier: 'ultimate',
    motif: 'orbital_launch',
    cinemaId: 'rocket',
    cinematicV2: true,
    filmClip: true,
    palette: [INK, TEAL, ENERGY_ORANGE],
    particles: ['🚀', '✨', '🔥', '💫'],
    audioKey: 'gift_rocket',
    p0: true,
  },
  lion_baby: {
    giftId: 'lion_baby',
    emoji: '🦁',
    name: 'Baby Lion',
    coinCost: 1000,
    rarity: 'legendary',
    motionTier: 'ultimate',
    motif: 'regal_drop',
    cinemaId: 'lion_baby',
    cinematicV2: true,
    filmClip: true,
    palette: ['#78350F', GOLD, ENERGY_ORANGE],
    particles: ['🦁', '✨', '🐾'],
    audioKey: null,
    p0: true,
  },
  lion_big: {
    giftId: 'lion_big',
    emoji: '🦁',
    name: 'Big Lion',
    coinCost: 5000,
    rarity: 'legendary',
    motionTier: 'ultimate',
    motif: 'orbital_launch',
    cinemaId: 'lion_big',
    cinematicV2: true,
    filmClip: true,
    palette: ['#4C1D95', ENERGY_ORANGE, GOLD],
    particles: ['🦁', '⚡', '✨', '💥'],
    audioKey: null,
    p0: true,
  },
  mad_hearts: {
    giftId: 'mad_hearts',
    emoji: '💖',
    name: 'Mad Hearts',
    coinCost: 100,
    rarity: 'rare',
    motionTier: 'mid',
    motif: 'pulse_bloom',
    cinemaId: 'mad_hearts',
    cinematicV2: true,
    filmClip: true,
    palette: ['#9D174D', '#FB7185', TEAL],
    particles: ['💖', '✨', '💕'],
    audioKey: null,
    p0: true,
  },
  mad_confetti: {
    giftId: 'mad_confetti',
    emoji: '🎊',
    name: 'Mad Confetti',
    coinCost: 100,
    rarity: 'rare',
    motionTier: 'mid',
    motif: 'stadium_wave',
    cinemaId: 'mad_confetti',
    cinematicV2: true,
    filmClip: true,
    palette: [TEAL_DARK, ENERGY_ORANGE, GOLD],
    particles: ['🎊', '✨', '🎉'],
    audioKey: null,
    p0: true,
  },
  mad_rose: {
    giftId: 'mad_rose',
    emoji: '🌹',
    name: 'Mad Rose',
    coinCost: 200,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'regal_drop',
    cinemaId: 'mad_rose',
    cinematicV2: true,
    filmClip: true,
    palette: ['#7F1D1D', '#FB7185', GOLD],
    particles: ['🌹', '✨', '💫'],
    audioKey: null,
    p0: true,
  },
  mad_donut: {
    giftId: 'mad_donut',
    emoji: '🍩',
    name: 'Mad Donut',
    coinCost: 200,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'pop_ack',
    cinemaId: 'mad_donut',
    cinematicV2: true,
    filmClip: true,
    palette: ['#9A3412', ENERGY_ORANGE, GOLD],
    particles: ['🍩', '✨', '🍬'],
    audioKey: null,
    p0: true,
  },
  mad_thanks_gift: {
    giftId: 'mad_thanks_gift',
    emoji: '🎁',
    name: 'Thanks Gift',
    coinCost: 300,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'pulse_bloom',
    cinemaId: 'mad_thanks_gift',
    cinematicV2: true,
    filmClip: true,
    palette: [TEAL_DARK, TEAL, GOLD],
    particles: ['🎁', '✨', '🙏'],
    audioKey: null,
    p0: true,
  },
  mad_thanks_likes: {
    giftId: 'mad_thanks_likes',
    emoji: '👍',
    name: 'Thanks Likes',
    coinCost: 300,
    rarity: 'epic',
    motionTier: 'epic',
    motif: 'pop_ack',
    cinemaId: 'mad_thanks_likes',
    cinematicV2: true,
    filmClip: true,
    palette: [TEAL_DARK, TEAL_LIGHT, ENERGY_ORANGE],
    particles: ['👍', '✨', '💙'],
    audioKey: null,
    p0: true,
  },
  mad_thanks_share: {
    giftId: 'mad_thanks_share',
    emoji: '🔗',
    name: 'Thanks Share',
    coinCost: 500,
    rarity: 'legendary',
    motionTier: 'legendary',
    motif: 'stadium_wave',
    cinemaId: 'mad_thanks_share',
    cinematicV2: true,
    filmClip: true,
    palette: [INK, TEAL, GOLD],
    particles: ['🔗', '✨', '📣'],
    audioKey: null,
    p0: true,
  },
  mad_gift_avalanche: {
    giftId: 'mad_gift_avalanche',
    emoji: '🎁',
    name: 'Gift Avalanche',
    coinCost: 750,
    rarity: 'legendary',
    motionTier: 'ultimate',
    motif: 'orbital_launch',
    cinemaId: 'mad_gift_avalanche',
    cinematicV2: true,
    filmClip: true,
    palette: ['#7C2D12', ENERGY_ORANGE, GOLD],
    particles: ['🎁', '✨', '💥', '🎊'],
    audioKey: null,
    p0: true,
  },
};

/** Hero gifts that use GiftCinematicPlayer (film clips, Skia fallback). */
export const CINEMATIC_V2_IDS = Object.keys(GIFT_MOTION).filter((k) => GIFT_MOTION[k].cinematicV2);
export const FILM_CLIP_IDS = Object.keys(GIFT_MOTION).filter((k) => GIFT_MOTION[k].filmClip);

export function resolveMotion(giftId, fallback = {}) {
  const key = String(giftId || '').toLowerCase();
  const spec = GIFT_MOTION[key];
  if (spec) return { ...spec };
  const cost = Number(fallback.cost) || 0;
  const rarity = fallback.rarity || 'common';
  return {
    giftId: key || 'gift',
    emoji: fallback.emoji || '🎁',
    name: fallback.name || giftId || 'Gift',
    coinCost: cost,
    rarity,
    motionTier: tierFromCost(cost),
    motif: rarity === 'legendary' ? 'regal_drop' : rarity === 'epic' ? 'crystal_prism' : 'pulse_bloom',
    palette: paletteForRarity(rarity),
    particles: [fallback.emoji || '🎁', '✨', '💫'],
    audioKey: null,
    p0: false,
  };
}

export function tierFromCost(cost) {
  const c = Number(cost) || 0;
  if (c <= 5) return 'small';
  if (c <= 20) return 'mid';
  if (c <= 40) return 'epic';
  if (c <= 80) return 'legendary';
  return 'ultimate';
}

export function getTierConfig(tierId) {
  return MOTION_TIERS[tierId] || MOTION_TIERS.small;
}

export function paletteForRarity(rarity) {
  switch (rarity) {
    case 'legendary':
      return ['#92400E', GOLD, TEAL];
    case 'epic':
      return ['#0E7490', CRYSTAL, TEAL_LIGHT];
    case 'rare':
      return [TEAL_DARK, TEAL, ENERGY_ORANGE];
    default:
      return ['#3F3F46', TEAL_DARK, TEAL];
  }
}

/** Combo heat styling — teal → orange → gold fire, not purple. */
export function comboHeat(count) {
  if (count >= 100) return { color: '#FDE68A', glow: GOLD, flame: true, size: 32, label: 'ULTIMATE' };
  if (count >= 50) return { color: '#FCA5A5', glow: ENERGY_RED, flame: true, size: 30, label: 'ON FIRE' };
  if (count >= 20) return { color: '#FDBA74', glow: ENERGY_ORANGE, flame: true, size: 29, label: 'HOT' };
  if (count >= 10) return { color: TEAL_LIGHT, glow: TEAL, flame: false, size: 28, label: 'STREAK' };
  return { color: '#fff', glow: TEAL, flame: false, size: 26, label: null };
}

export function crossedComboMilestone(oldC, newC) {
  const tiers = [
    { at: 500, color: GOLD },
    { at: 200, color: TEAL },
    { at: 100, color: ENERGY_RED },
    { at: 50, color: ENERGY_ORANGE },
  ];
  for (const t of tiers) {
    if (oldC < t.at && newC >= t.at) return t;
  }
  return null;
}

/**
 * Device FX budget for 60fps target on mid Android / Fold7-class high.
 * Caps particle counts and disables heavy SVG layers on low-end.
 */
export function getFxBudget() {
  let tier = 'mid';
  try {
    const mem = Number(Device.totalMemory) || 0;
    const yearClass = Number(Device.deviceYearClass) || 0;
    if (mem >= 7e9 || yearClass >= 2023) tier = 'high';
    else if (mem > 0 && mem < 3.5e9) tier = 'low';
    else if (yearClass > 0 && yearClass < 2020) tier = 'low';
  } catch {
    // keep mid
  }
  if (Platform.OS === 'android' && tier === 'high') {
    // Still respect mid defaults for particle spam under live chat load
  }
  const budgets = {
    high: {
      tier: 'high',
      maxBanners: 3,
      maxFloaters: 18,
      maxParticles: 72,
      burstNormal: 12,
      burstBig: 28,
      rays: 8,
      rings: 3,
      shake: true,
      svgLayers: true,
      trail: true,
      cinemaParticles: 48,
      bloom: true,
      chromatic: true,
      letterbox: true,
      skiaCinema: true,
    },
    mid: {
      tier: 'mid',
      maxBanners: 3,
      maxFloaters: 14,
      maxParticles: 48,
      burstNormal: 8,
      burstBig: 18,
      rays: 6,
      rings: 3,
      shake: true,
      svgLayers: true,
      trail: true,
      cinemaParticles: 32,
      bloom: true,
      chromatic: true,
      letterbox: true,
      skiaCinema: true,
    },
    low: {
      tier: 'low',
      maxBanners: 2,
      maxFloaters: 8,
      maxParticles: 24,
      burstNormal: 5,
      burstBig: 10,
      rays: 4,
      rings: 2,
      shake: false,
      svgLayers: false,
      trail: false,
      cinemaParticles: 14,
      bloom: false,
      chromatic: false,
      letterbox: false,
      skiaCinema: true,
    },
  };
  return budgets[tier] || budgets.mid;
}

/**
 * Full duration for cinematic V2 heroes.
 * Film-clip path: authored MP4 length + glory freeze + chrome.
 * Skia fallback: longer procedural hold than P0 emoji path.
 */
export function cinemaHoldMs(motion) {
  // Lazy require avoids circular import at module init
  try {
    // eslint-disable-next-line global-require
    const { FILM_CLIP_META } = require('./filmClipRegistry');
    const id = motion?.cinemaId || motion?.giftId;
    const meta = id ? FILM_CLIP_META[id] : null;
    if (meta && motion?.filmClip !== false) {
      return meta.durationMs + meta.gloryMs + 400;
    }
  } catch {
    // fall through to Skia timing
  }
  const tier = getTierConfig(motion?.motionTier);
  const base = {
    mid: 2200,
    epic: 3200,
    legendary: 4200,
    ultimate: 5200,
  };
  const ms = base[tier.id] || heroHoldMs(motion);
  try {
    const budget = getFxBudget();
    if (budget.tier === 'low') return Math.round(ms * 0.82);
  } catch {
    // keep base
  }
  return ms;
}

/** Hold duration for hero takeover from tier + coin intensity. */
export function heroHoldMs(motion) {
  const tier = getTierConfig(motion.motionTier);
  const intensity = Math.max(0.35, Math.min(1, (Number(motion.coinCost) || 25) / 100));
  return tier.entranceMs + tier.climaxMs + tier.lingerMs * (0.55 + intensity * 0.45) + tier.exitMs;
}

/**
 * Optional designer SFX registry (NOT blyp_notify). Cinema gifts use the MP4
 * soundtrack via playGiftFilmSoundtrack — never the Blyp jingle on live.
 */
const AUDIO_REGISTRY = Object.create(null);

let giftAudioProfileApplied = false;
let giftFilmSoundtrackToken = 0;

/**
 * Under live IVS, unmuted expo-av ExoPlayer fights STREAM_MUSIC vs
 * VOICE_COMMUNICATION and freezes on frame 0. Mute the film surface; play the
 * MP4 soundtrack via BlypAudioRoute.playGiftCinemaUri (voice-comm attrs).
 */
export function mustMuteGiftFilm() {
  try {
    // eslint-disable-next-line global-require
    const { isLiveAudioSessionActive } = require('../../../services/livePublishAudioGuard');
    return !!isLiveAudioSessionActive();
  } catch {
    return false;
  }
}

export function isLiveGiftAudioContext() {
  return mustMuteGiftFilm();
}

/**
 * Off-live only: media loudspeaker session for unmuted expo-av Video.
 * NEVER call while live — playThroughEarpieceAndroid:false forces MODE_NORMAL
 * and quiets IVS host/guest (earpiece / call volume).
 */
export async function ensureGiftAudioSession() {
  try {
    // eslint-disable-next-line global-require
    const { isLiveAudioSessionActive } = require('../../../services/livePublishAudioGuard');
    if (isLiveAudioSessionActive()) {
      return;
    }
  } catch {
    // guard optional
  }
  if (giftAudioProfileApplied) return;
  try {
    // eslint-disable-next-line global-require
    const { ensureMediaPlaybackAudioMode } = require('../../../services/notifySound');
    await ensureMediaPlaybackAudioMode({ background: false });
    giftAudioProfileApplied = true;
    return;
  } catch {
    // fall through
  }
  try {
    // eslint-disable-next-line global-require
    const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = require('expo-av');
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    });
    giftAudioProfileApplied = true;
  } catch {
    // best-effort
  }
}

/**
 * After a gift overlay ends: stop native cinema soundtrack, clear media latch,
 * re-assert IVS loudspeaker so Stage is not left ducked / earpiece.
 */
export async function releaseGiftAudioSession() {
  giftAudioProfileApplied = false;
  giftFilmSoundtrackToken += 1;
  try {
    // eslint-disable-next-line global-require
    const { stopGiftCinema } = require('../../../services/blypAudioRoute');
    await stopGiftCinema();
  } catch {
    // optional
  }
  try {
    // eslint-disable-next-line global-require
    const { invalidateMediaPlaybackAudioMode } = require('../../../services/notifySound');
    invalidateMediaPlaybackAudioMode();
  } catch {
    // optional
  }
  try {
    // eslint-disable-next-line global-require
    const { isLiveAudioSessionActive } = require('../../../services/livePublishAudioGuard');
    if (!isLiveAudioSessionActive()) return;
    // eslint-disable-next-line global-require
    const { getIVSNativeClient } = require('../../../streaming/IVSNativeClient');
    await getIVSNativeClient().forceLiveLoudspeaker('gift-audio-release');
  } catch {
    // best-effort — native watchdog still reasserts
  }
}

export function registerGiftAudio(key, module) {
  if (key && module) AUDIO_REGISTRY[key] = module;
}

async function resolveGiftSourceUri(sourceModule) {
  if (!sourceModule && sourceModule !== 0) return null;
  if (typeof sourceModule === 'string') return sourceModule;
  try {
    // eslint-disable-next-line global-require
    const { Asset } = require('expo-asset');
    const asset = Asset.fromModule(sourceModule);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    return asset.localUri || asset.uri || null;
  } catch {
    try {
      // eslint-disable-next-line global-require
      const { Image } = require('react-native');
      const resolved = Image.resolveAssetSource(sourceModule);
      return resolved?.uri || null;
    } catch {
      return null;
    }
  }
}

/**
 * Play the cinema MP4's own soundtrack (“rah”), never blyp_notify.
 * Live Android: muted Video + native MediaPlayer on voice-comm attrs.
 * Off-live / iOS: unmuted Video carries the embedded audio (caller unmutes).
 */
export async function playGiftFilmSoundtrack(sourceModule) {
  const token = ++giftFilmSoundtrackToken;
  const live = isLiveGiftAudioContext();
  // eslint-disable-next-line global-require
  const { Platform } = require('react-native');

  if (live && Platform.OS === 'android') {
    const uri = await resolveGiftSourceUri(sourceModule);
    if (!uri || token !== giftFilmSoundtrackToken) return false;
    try {
      // eslint-disable-next-line global-require
      const { playGiftCinemaUri } = require('../../../services/blypAudioRoute');
      return !!(await playGiftCinemaUri(uri, 1));
    } catch {
      return false;
    }
  }

  if (!live) {
    try {
      await ensureGiftAudioSession();
    } catch {
      // continue — Video may still unmute
    }
  }
  return !live;
}

/**
 * Legacy hook for Skia / non-film heroes. On live: always silent (no jingle).
 * Off-live: only plays designer-registered SFX (never auto-maps blyp_notify).
 */
export async function playGiftCinemaAudio(motion) {
  let live = false;
  try {
    // eslint-disable-next-line global-require
    const { isLiveAudioSessionActive } = require('../../../services/livePublishAudioGuard');
    live = !!isLiveAudioSessionActive();
  } catch {
    live = false;
  }
  if (live) return;
  const key = motion?.audioKey;
  if (!key || !AUDIO_REGISTRY[key]) return;
  await playGiftAudio(key);
}

export async function playGiftAudio(audioKey) {
  try {
    // eslint-disable-next-line global-require
    const { isLiveAudioSessionActive } = require('../../../services/livePublishAudioGuard');
    if (isLiveAudioSessionActive()) return;
  } catch {
    // continue
  }
  try {
    await ensureGiftAudioSession();
  } catch {
    // continue
  }
  const key = audioKey || 'gift_cinema';
  if (!AUDIO_REGISTRY[key]) return;
  try {
    // eslint-disable-next-line global-require
    const { Audio } = require('expo-av');
    const { sound } = await Audio.Sound.createAsync(AUDIO_REGISTRY[key], {
      shouldPlay: true,
      volume: 1,
      isMuted: false,
    });
    sound.setOnPlaybackStatusUpdate((st) => {
      if (st?.didJustFinish) {
        try {
          sound.unloadAsync();
        } catch {
          // ignore
        }
        void releaseGiftAudioSession();
      }
    });
  } catch {
    // audio is optional polish
  }
}

export const P0_GIFT_IDS = Object.keys(GIFT_MOTION).filter((k) => GIFT_MOTION[k].p0);
