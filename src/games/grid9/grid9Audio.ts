/**
 * Grid 9 one-shot SFX (expo-av). Local to src/games/grid9 — does not edit frozen LIVE/IAP modules.
 *
 * Assets under ./assets/audio are lightweight synthetic WAV placeholders so real VO/SFX
 * can drop in later by replacing files (same filenames) without code changes.
 *
 * Fail-soft: load/play errors are swallowed. Respects module mute + iOS silent switch via mode.
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

export type Grid9AudioCue =
  | 'arena_live'
  | 'roulette_spin'
  | 'spotlight_select'
  | 'your_go'
  | 'turn_end'
  | 'weapon_fire'
  | 'weapon_impact'
  | 'shield_pulse'
  | 'kiss_heal'
  | 'eliminated'
  | 'victory'
  | 'jackpot_sting'
  | 'entry_fee';

const REGISTRY: Record<Grid9AudioCue, number> = {
  arena_live: require('./assets/audio/arena_live.wav'),
  roulette_spin: require('./assets/audio/roulette_spin.wav'),
  spotlight_select: require('./assets/audio/spotlight_select.wav'),
  your_go: require('./assets/audio/your_go.wav'),
  turn_end: require('./assets/audio/turn_end.wav'),
  weapon_fire: require('./assets/audio/weapon_fire.wav'),
  weapon_impact: require('./assets/audio/weapon_impact.wav'),
  shield_pulse: require('./assets/audio/shield_pulse.wav'),
  kiss_heal: require('./assets/audio/kiss_heal.wav'),
  eliminated: require('./assets/audio/eliminated.wav'),
  victory: require('./assets/audio/victory.wav'),
  jackpot_sting: require('./assets/audio/jackpot_sting.wav'),
  entry_fee: require('./assets/audio/entry_fee.wav'),
};

let muted = false;
let modeReady = false;

export function setGrid9AudioMuted(next: boolean): void {
  muted = !!next;
}

export function isGrid9AudioMuted(): boolean {
  return muted;
}

async function ensurePlaybackMode(): Promise<void> {
  if (modeReady) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    });
    modeReady = true;
  } catch {
    /* soft */
  }
}

/** Play a one-shot cue. Never throws. */
export async function playGrid9Cue(
  cue: Grid9AudioCue,
  opts?: { volume?: number },
): Promise<void> {
  if (muted) return;
  const source = REGISTRY[cue];
  if (source == null) return;
  try {
    await ensurePlaybackMode();
    const { sound } = await Audio.Sound.createAsync(source, {
      shouldPlay: true,
      volume: Math.max(0, Math.min(1, opts?.volume ?? 0.85)),
      isLooping: false,
    });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        void sound.unloadAsync().catch(() => undefined);
      }
    });
  } catch {
    /* soft — missing asset / AV session */
  }
}

export function cueForWeaponVfx(kind: 'projectile' | 'shield' | 'heal', weaponId?: string): {
  fire?: Grid9AudioCue;
  impact: Grid9AudioCue;
} {
  if (kind === 'heal' || weaponId === 'kiss') {
    return { fire: 'weapon_fire', impact: 'kiss_heal' };
  }
  if (kind === 'shield') {
    return { impact: 'shield_pulse' };
  }
  return { fire: 'weapon_fire', impact: 'weapon_impact' };
}
