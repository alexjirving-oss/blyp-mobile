/**
 * Authored cinematic film clips for hero gifts.
 * Skia scenes remain as fallback when a clip module is missing.
 */

export const FILM_CLIP_META = {
  rocket: {
    cinemaId: 'rocket',
    file: 'rocket.mp4',
    durationMs: 3200,
    gloryMs: 1000,
    impactAt: 0.22,
    storyBeat: 'Toy rocket with eyes launches — ignition, ascent, star glory.',
  },
  crown: {
    cinemaId: 'crown',
    file: 'crown.mp4',
    durationMs: 2850,
    gloryMs: 1100,
    impactAt: 0.38,
    storyBeat: 'Jeweled crown character descends and crowns the stage.',
  },
  diamond: {
    cinemaId: 'diamond',
    file: 'diamond.mp4',
    durationMs: 2900,
    gloryMs: 1100,
    impactAt: 0.36,
    storyBeat: 'Diamond character facet-dances into a light burst.',
  },
  cheer_burst: {
    cinemaId: 'cheer_burst',
    file: 'cheer_burst.mp4',
    durationMs: 2900,
    gloryMs: 1100,
    impactAt: 0.36,
    storyBeat: 'Stadium figures erupt in a celebration wave.',
  },
  fire: {
    cinemaId: 'fire',
    file: 'fire.mp4',
    durationMs: 2900,
    gloryMs: 1100,
    impactAt: 0.36,
    storyBeat: 'Phoenix fire-spirit rises from embers to glory.',
  },
};

/** Metro-bundled MP4 modules (H.264 / yuv420p). */
export const FILM_CLIPS = {
  rocket: require('../../../../assets/gifts/cinema/clips/rocket.mp4'),
  crown: require('../../../../assets/gifts/cinema/clips/crown.mp4'),
  diamond: require('../../../../assets/gifts/cinema/clips/diamond.mp4'),
  cheer_burst: require('../../../../assets/gifts/cinema/clips/cheer_burst.mp4'),
  fire: require('../../../../assets/gifts/cinema/clips/fire.mp4'),
};

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
  return !!resolveFilmClip(motion);
}
