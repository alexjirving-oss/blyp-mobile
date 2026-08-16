/**
 * Roulette-land VO: "Box two, your turn". Fail-soft TTS via expo-speech.
 */

export const GRID9_BOX_TURN_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
] as const;

export function grid9BoxNumber(slotIndex: number): number {
  const n = Math.floor(slotIndex) + 1;
  return Math.max(1, Math.min(9, n));
}

export function grid9BoxTurnLine(slotIndex: number): string {
  const box = grid9BoxNumber(slotIndex);
  return `Box ${GRID9_BOX_TURN_WORDS[box - 1]}, your turn`;
}

/** Speak the land line. Never throws. */
export function speakGrid9BoxTurn(slotIndex: number): void {
  try {
    // eslint-disable-next-line global-require
    const { isGrid9AudioMuted } = require('./grid9Audio');
    if (isGrid9AudioMuted()) return;
  } catch {
    /* soft */
  }
  const line = grid9BoxTurnLine(slotIndex);
  try {
    // eslint-disable-next-line global-require
    const Speech = require('expo-speech');
    Speech.stop?.();
    Speech.speak(line, {
      language: 'en-US',
      pitch: 1,
      rate: 0.92,
    });
  } catch {
    /* soft — no TTS on this build */
  }
}
