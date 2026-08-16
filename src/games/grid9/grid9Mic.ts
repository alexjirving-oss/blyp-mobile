/** Local combatant is on roulette pick / spotlight — unmute for the go. */
export function shouldAutoUnmuteGrid9Mic(args: {
  isCombatant: boolean;
  spectate?: boolean;
  localSlotIndex: number | null;
  activeSlotIndex: number | null;
}): boolean {
  if (!args.isCombatant || args.spectate) return false;
  if (args.localSlotIndex == null || args.activeSlotIndex == null) return false;
  return args.localSlotIndex === args.activeSlotIndex;
}
