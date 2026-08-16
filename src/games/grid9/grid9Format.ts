import { GRID9_SLOT_COUNT, GRID9_SLOT_INDICES, type Grid9SlotIndex } from './constants';
import type { Grid9AuthoritativeGameState, Grid9PublicPlayer } from './protocol';

export function formatGrid9Coins(amount: number): string {
  return Math.max(0, Math.floor(amount)).toLocaleString('en-US');
}

export function formatGrid9Phase(phase: string | null | undefined): string {
  switch (phase) {
    case 'initializing':
      return 'BOOTING';
    case 'lobby':
    case 'lobby_waiting':
      return 'MATCH STARTING';
    case 'private_lobby':
      return 'PRIVATE LOBBY';
    case 'roulette':
      return 'ROULETTE';
    case 'countdown':
      return 'COUNTDOWN';
    case 'combat':
      return 'COMBAT';
    case 'settling':
      return 'SETTLING';
    case 'completed':
      return 'COMPLETE';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'STANDBY';
  }
}

export function remainingMs(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const ends = Date.parse(iso);
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, ends - nowMs);
}

export function formatGrid9Countdown(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  if (totalSeconds >= 10) return `${Math.ceil(totalSeconds)}s`;
  return `${totalSeconds.toFixed(1)}s`;
}

export function grid9HealthRatio(player: Pick<Grid9PublicPlayer, 'health' | 'maxHealth'>): number {
  if (!player.maxHealth) return 0;
  return Math.max(0, Math.min(1, player.health / player.maxHealth));
}

export function isGrid9SlotEliminated(
  player: Pick<Grid9PublicPlayer, 'health' | 'status'> | null,
): boolean {
  if (!player) return false;
  return player.status === 'eliminated' || player.health <= 0;
}

export function getGrid9JackpotPool(match: Grid9AuthoritativeGameState | null): number {
  return match?.jackpot?.currentCoins ?? 0;
}

export function getGrid9SpotlightSlot(
  match: Grid9AuthoritativeGameState | null,
): Grid9SlotIndex | null {
  const slot = match?.turn?.spotlightSlotIndex;
  return slot === 0 || slot ? slot : null;
}

export function slotsForGrid9Board(
  players: Grid9PublicPlayer[] | undefined,
): Array<Grid9PublicPlayer | null> {
  const list = players ?? [];
  return GRID9_SLOT_INDICES.map(
    (slotIndex) => list.find((player) => player.slotIndex === slotIndex) ?? null,
  );
}

export function playerInitials(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '•';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export const GRID9_BOARD_SIZE = GRID9_SLOT_COUNT;
