/**
 * Authored cinematic film clips for hero gifts.
 * Prefer AlphaPlayer-style RGB|Alpha split MP4 when present;
 * Skia scenes remain as fallback when a clip module is missing.
 */

export const FILM_CLIP_META = {
  rocket: {
    cinemaId: 'rocket',
    file: 'rocket.mp4',
    durationMs: 3400,
    gloryMs: 1000,
    impactAt: 0.28,
    loopOnce: true,
    composite: 'alphaSplitRgbLeft',
    storyBeat: 'Metallic rocket ignition → ascent streak → apex star detonation.',
  },
  crown: {
    cinemaId: 'crown',
    file: 'crown.mp4',
    durationMs: 3200,
    gloryMs: 1100,
    impactAt: 0.42,
    loopOnce: true,
    composite: 'alphaSplitRgbLeft',
    storyBeat: 'Jeweled gold crown descends on light shaft → contact glitter storm.',
  },
  diamond: {
    cinemaId: 'diamond',
    file: 'diamond.mp4',
    durationMs: 3300,
    gloryMs: 1100,
    impactAt: 0.34,
    loopOnce: true,
    composite: 'alphaSplitRgbLeft',
    storyBeat: 'Crystal rotates with caustic flashes → prism beams → shatter bloom.',
  },
  cheer_burst: {
    cinemaId: 'cheer_burst',
    file: 'cheer_burst.mp4',
    durationMs: 3200,
    gloryMs: 1100,
    impactAt: 0.3,
    loopOnce: true,
    composite: 'alphaSplitRgbLeft',
    storyBeat: 'Confetti cannon → stadium light streaks → teal/gold celebration wash.',
  },
  fire: {
    cinemaId: 'fire',
    file: 'fire.mp4',
    durationMs: 3300,
    gloryMs: 1100,
    impactAt: 0.3,
    loopOnce: true,
    composite: 'alphaSplitRgbLeft',
    storyBeat: 'Ember floor → luminous flame column → heat bloom + ember rain.',
  },
  // Purchased full-scene lion films (H.264 from VP9 WEBM). Opaque composite —
  // scenic backgrounds are not dark-keyed for screen blend.
  lion_baby: {
    cinemaId: 'lion_baby',
    file: 'lion_baby.mp4',
    durationMs: 7042,
    gloryMs: 900,
    impactAt: 0.32,
    loopOnce: true,
    composite: 'opaque',
    storyBeat: 'Baby lion cub on a golden paw-print path at sunset.',
  },
  lion_big: {
    cinemaId: 'lion_big',
    file: 'lion_big.mp4',
    durationMs: 12042,
    gloryMs: 1100,
    impactAt: 0.42,
    loopOnce: true,
    composite: 'opaque',
    storyBeat: 'Epic lion spirit rises through lightning and stone rupture.',
  },
};

/**
 * Drop-in contract:
 *   assets/gifts/cinema/alpha/{id}.mp4
 *   layout: side-by-side RGB | Alpha (YYEVA), 720×1280 subject → 1440×1280 file
 */
export const ALPHA_CLIPS = {
  rocket: require('../../../../assets/gifts/cinema/alpha/rocket.mp4'),
  crown: require('../../../../assets/gifts/cinema/alpha/crown.mp4'),
  diamond: require('../../../../assets/gifts/cinema/alpha/diamond.mp4'),
  cheer_burst: require('../../../../assets/gifts/cinema/alpha/cheer_burst.mp4'),
  fire: require('../../../../assets/gifts/cinema/alpha/fire.mp4'),
};

/** Dark-key / RGB-on-black Metro-bundled MP4 modules (H.264 / yuv420p). */
export const FILM_CLIPS = {
  rocket: require('../../../../assets/gifts/cinema/clips/rocket.mp4'),
  crown: require('../../../../assets/gifts/cinema/clips/crown.mp4'),
  diamond: require('../../../../assets/gifts/cinema/clips/diamond.mp4'),
  cheer_burst: require('../../../../assets/gifts/cinema/clips/cheer_burst.mp4'),
  fire: require('../../../../assets/gifts/cinema/clips/fire.mp4'),
  lion_baby: require('../../../../assets/gifts/cinema/clips/lion_baby.mp4'),
  lion_big: require('../../../../assets/gifts/cinema/clips/lion_big.mp4'),
};

export function resolveAlphaClip(motion) {
  const id = motion?.cinemaId || motion?.giftId;
  if (!id || !ALPHA_CLIPS[id]) return null;
  return {
    id,
    module: ALPHA_CLIPS[id],
    meta: {
      ...(FILM_CLIP_META[id] || {
        cinemaId: id,
        durationMs: 3000,
        gloryMs: 900,
        impactAt: 0.25,
      }),
      composite: 'alphaSplitRgbLeft',
      layout: 'splitHorizontalRgbLeftAlphaRight',
    },
  };
}

export function resolveFilmClip(motion) {
  const id = motion?.cinemaId || motion?.giftId;
  if (!id || !FILM_CLIPS[id]) return null;
  return {
    id,
    source: FILM_CLIPS[id],
    meta: FILM_CLIP_META[id] || {
      cinemaId: id,
      durationMs: 3000,
      gloryMs: 900,
      impactAt: 0.25,
    },
  };
}

export function hasFilmClip(motion) {
  return !!resolveFilmClip(motion) || !!resolveAlphaClip(motion);
}

export function hasAlphaClip(motion) {
  return !!resolveAlphaClip(motion);
}
