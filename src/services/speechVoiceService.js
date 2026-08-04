// Prefer a polished female English voice for Blyp answer playback.
// Device voices vary; we score what's available and cache the best pick.

import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

const FEMALE_NAME_HINTS = [
  'samantha',
  'karen',
  'moira',
  'serena',
  'martha',
  'kate',
  'fiona',
  'tessa',
  'victoria',
  'allison',
  'ava',
  'susan',
  'zoe',
  'joanna',
  'ivy',
  'salli',
  'amy',
  'emma',
  'jenny',
  'aria',
  'female',
  // Google / Android neural locale tags commonly used for female en voices
  'en-gb-x-gba',
  'en-gb-x-gbc',
  'en-gb-x-gbd',
  'en-gb-x-rjs',
  'en-us-x-sfg',
  'en-us-x-iob',
  'en-us-x-iog',
  'en-us-x-tpf',
  'en-au-x-afh',
  'en-au-x-aua',
];

const MALE_NAME_HINTS = [
  'daniel',
  'arthur',
  'aaron',
  'fred',
  'alex',
  'tom',
  'oliver',
  'male',
  'en-gb-x-gbb',
  'en-gb-x-gbg',
  'en-us-x-iom',
  'en-us-x-tpd',
];

let cachedVoiceId = null;
let resolved = false;

function scoreVoice(v) {
  if (!v) return -Infinity;
  const lang = String(v.language || '').toLowerCase();
  const name = String(v.name || '').toLowerCase();
  const id = String(v.identifier || '').toLowerCase();
  const blob = `${name} ${id}`;
  let score = 0;

  if (lang.startsWith('en-gb')) score += 40;
  else if (lang.startsWith('en-us')) score += 30;
  else if (lang.startsWith('en-au') || lang.startsWith('en-ie')) score += 25;
  else if (lang.startsWith('en')) score += 10;
  else return -1000;

  const quality = String(v.quality || '');
  if (/enhanced|premium|quality/i.test(quality)) score += 35;
  if (/network|neural|wavenet|studio/i.test(blob)) score += 25;
  if (/local|compact/i.test(blob)) score += 5;

  if (FEMALE_NAME_HINTS.some((h) => blob.includes(h))) score += 50;
  if (MALE_NAME_HINTS.some((h) => blob.includes(h))) score -= 60;

  // Slight preference for longer/natural names over bare locale tags.
  if (name.length > 6 && !name.endsWith('-language')) score += 5;

  return score;
}

async function loadVoicesWithRetry() {
  for (let i = 0; i < 6; i += 1) {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      if (Array.isArray(voices) && voices.length) return voices;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return [];
}

/** Resolve (and cache) the best professional female English voice on this device. */
export async function resolvePreferredFemaleVoice() {
  if (resolved) return cachedVoiceId;
  const voices = await loadVoicesWithRetry();
  if (!voices.length) {
    resolved = true;
    cachedVoiceId = null;
    return null;
  }
  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  const best = ranked[0];
  cachedVoiceId = best && scoreVoice(best) > 0 ? best.identifier : null;
  resolved = true;
  try {
    console.log('[TTS] preferred voice', {
      platform: Platform.OS,
      id: cachedVoiceId,
      name: best?.name,
      language: best?.language,
      quality: best?.quality,
      score: scoreVoice(best),
    });
  } catch {
    /* ignore */
  }
  return cachedVoiceId;
}

/**
 * Speak text with the preferred female voice.
 * Falls back to en-GB system default if no voice id is available.
 */
export async function speakWithPreferredVoice(text, options = {}) {
  const clean = String(text || '')
    .replace(/[`*_#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;

  try {
    Speech.stop();
  } catch {
    /* ignore */
  }

  const voice = await resolvePreferredFemaleVoice();
  const payload = {
    language: 'en-GB',
    rate: 0.94,
    pitch: 1.02,
    ...options,
  };
  if (voice) payload.voice = voice;

  Speech.speak(clean.slice(0, 4000), payload);
}

export function stopSpeaking() {
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
}

export default {
  resolvePreferredFemaleVoice,
  speakWithPreferredVoice,
  stopSpeaking,
};
