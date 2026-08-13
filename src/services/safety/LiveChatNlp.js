// Live chat NLP — keyword / toxicity list on top of contentFilter.
// Expand TOXICITY_EXTRA as policy grows. Flags are audit-logged.

import { inspectText as baseInspect } from '../../utils/contentFilter';
import { appendSafetyAudit } from './SafetyAuditLog';

/** Extra expandable toxicity / harassment patterns for live chat. */
export const TOXICITY_EXTRA = [
  /\bkill\s*(yourself|urself|yrsel[f]?)\b/i,
  /\bkys\b/i,
  /\b(rape|molest)\b/i,
  /\b(gas\s*the|hang\s*all)\b/i,
  /\b(doxx?|swat)\s*(me|you|them|him|her)?\b/i,
  /\b(n[i1]gg|f[a@]g)\w*\b/i,
];

/**
 * @returns {{ blocked: boolean, clean: string, flagged: boolean, categories: string[] }}
 */
export function inspectLiveChat(input) {
  const base = baseInspect(input);
  if (base.blocked) {
    return { ...base, flagged: true, categories: ['hard_block'] };
  }

  const text = String(input || '');
  const categories = [];
  for (const re of TOXICITY_EXTRA) {
    if (re.test(text)) {
      categories.push('toxicity');
      break;
    }
  }

  if (categories.length) {
    return { blocked: true, clean: '', flagged: true, categories };
  }

  return {
    blocked: false,
    clean: base.clean,
    flagged: false,
    categories: [],
  };
}

/**
 * Drop/flag before send. Logs flags to safetyAuditLogs.
 */
export async function filterLiveChatBeforeSend(text, { streamId, userId } = {}) {
  const result = inspectLiveChat(text);
  if (result.flagged || result.blocked) {
    await appendSafetyAudit({
      action: 'chat_flag',
      actorId: userId || undefined,
      targetType: 'stream_chat',
      targetId: streamId || 'unknown',
      metadata: {
        categories: result.categories,
        blocked: true,
        // Do not store raw message body in audit.
        length: String(text || '').length,
      },
    });
  }
  return result;
}

export default { inspectLiveChat, filterLiveChatBeforeSend, TOXICITY_EXTRA };
