/**
 * Live battles kill switch — default ON so prod works; set LIVE_BATTLES_ENABLED=0
 * (or false/off/no) to soft-disable for soak/incident without a client ship.
 */
export function battlesEnabled(): boolean {
  const raw = String(process.env.LIVE_BATTLES_ENABLED ?? '1').trim();
  return !/^(0|false|no|off)$/i.test(raw);
}

export function battlesDisabledPayload() {
  return { error: 'DISABLED', code: 'BATTLES_DISABLED' };
}
