// ensureSafetyGate — shared helper for Create / Review / Go Live entry points.
import { evaluateSafetyGate } from './SafetyGateService';

/**
 * If gate fails, caller should show SafetyGateModal.
 * @returns {Promise<{ ok: boolean, evaluation: object }>}
 */
export async function ensureSafetyGate(uid) {
  if (!uid) return { ok: false, evaluation: { needsTerms: true, needsAge: true } };
  const evaluation = await evaluateSafetyGate(uid);
  return { ok: !!evaluation.ok, evaluation };
}

export default { ensureSafetyGate };
