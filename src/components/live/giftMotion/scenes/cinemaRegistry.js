/**
 * Registry for cinematic V2 Skia hero scenes.
 */

import RocketCinema from './RocketCinema';
import CrownCinema from './CrownCinema';
import DiamondCinema from './DiamondCinema';
import CheerBurstCinema from './CheerBurstCinema';
import FireCinema from './FireCinema';

export const CINEMA_SCENES = {
  rocket: RocketCinema,
  crown: CrownCinema,
  diamond: DiamondCinema,
  cheer_burst: CheerBurstCinema,
  fire: FireCinema,
};

export function resolveCinemaScene(motion) {
  const id = motion?.cinemaId || motion?.giftId;
  return CINEMA_SCENES[id] || null;
}
