/**
 * Web gift cinema registry — mirrors RN filmClipRegistry opaque / dark-key clips.
 * MP4s are copied into public/gifts/cinema/ by scripts/copy-gift-cinema-assets.mjs.
 */

export type GiftCinemaComposite = "opaque" | "darkKey";

export type GiftCinemaClip = {
  cinemaId: string;
  /** Public URL under /gifts/cinema/ */
  src: string;
  durationMs: number;
  gloryMs: number;
  composite: GiftCinemaComposite;
  hasEmbeddedAudio?: boolean;
};

/** Cue published on overlay feed so watch / OBS receive the same film as host. */
export type GiftCinemaCue = {
  giftId: string;
  giftEventId: string;
  at: number;
};

const META: Record<
  string,
  Omit<GiftCinemaClip, "src"> & { file: string }
> = {
  rocket: {
    cinemaId: "rocket",
    file: "rocket.mp4",
    durationMs: 3400,
    gloryMs: 1000,
    composite: "darkKey",
  },
  crown: {
    cinemaId: "crown",
    file: "crown.mp4",
    durationMs: 3200,
    gloryMs: 1100,
    composite: "darkKey",
  },
  diamond: {
    cinemaId: "diamond",
    file: "diamond.mp4",
    durationMs: 3300,
    gloryMs: 1100,
    composite: "darkKey",
  },
  cheer_burst: {
    cinemaId: "cheer_burst",
    file: "cheer_burst.mp4",
    durationMs: 3200,
    gloryMs: 1100,
    composite: "darkKey",
  },
  fire: {
    cinemaId: "fire",
    file: "fire.mp4",
    durationMs: 3300,
    gloryMs: 1100,
    composite: "darkKey",
  },
  lion_baby: {
    cinemaId: "lion_baby",
    file: "lion_baby.mp4",
    durationMs: 7042,
    gloryMs: 900,
    composite: "opaque",
    hasEmbeddedAudio: true,
  },
  lion_big: {
    cinemaId: "lion_big",
    file: "lion_big.mp4",
    durationMs: 12042,
    gloryMs: 1100,
    composite: "opaque",
    hasEmbeddedAudio: true,
  },
  mad_hearts: {
    cinemaId: "mad_hearts",
    file: "mad_hearts.mp4",
    durationMs: 5042,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_confetti: {
    cinemaId: "mad_confetti",
    file: "mad_confetti.mp4",
    durationMs: 5042,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_rose: {
    cinemaId: "mad_rose",
    file: "mad_rose.mp4",
    durationMs: 4467,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_donut: {
    cinemaId: "mad_donut",
    file: "mad_donut.mp4",
    durationMs: 4967,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_thanks_gift: {
    cinemaId: "mad_thanks_gift",
    file: "mad_thanks_gift.mp4",
    durationMs: 5042,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_thanks_likes: {
    cinemaId: "mad_thanks_likes",
    file: "mad_thanks_likes.mp4",
    durationMs: 5042,
    gloryMs: 900,
    composite: "opaque",
  },
  mad_thanks_share: {
    cinemaId: "mad_thanks_share",
    file: "mad_thanks_share.mp4",
    durationMs: 5042,
    gloryMs: 950,
    composite: "opaque",
  },
  mad_gift_avalanche: {
    cinemaId: "mad_gift_avalanche",
    file: "mad_gift_avalanche.mp4",
    durationMs: 4700,
    gloryMs: 1000,
    composite: "opaque",
  },
};

export const GIFT_CINEMA_IDS = Object.keys(META);

export function resolveGiftCinemaClip(
  giftId: string | null | undefined,
): GiftCinemaClip | null {
  const id = String(giftId || "").trim();
  if (!id || !META[id]) return null;
  const row = META[id];
  return {
    cinemaId: row.cinemaId,
    src: `/gifts/cinema/${row.file}`,
    durationMs: row.durationMs,
    gloryMs: row.gloryMs,
    composite: row.composite,
    hasEmbeddedAudio: row.hasEmbeddedAudio,
  };
}

export function makeGiftCinemaCue(
  giftId: string,
  giftEventId?: string | null,
): GiftCinemaCue | null {
  if (!resolveGiftCinemaClip(giftId)) return null;
  return {
    giftId,
    giftEventId:
      String(giftEventId || "").trim() ||
      `local_${giftId}_${Date.now()}`,
    at: Date.now(),
  };
}
