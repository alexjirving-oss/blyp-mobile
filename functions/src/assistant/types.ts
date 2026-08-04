/**
 * "Blyp it" — AI compose-and-send assistant (premium).
 *
 * A subscriber speaks to the Ask Blyp bar ("Blyp Ru — tough luck about the
 * football") and the backend returns a ready-to-send DRAFT: warm, on-tone message
 * options + an AI-generated image. The app then previews it and, only on the
 * user's nod, delivers it (in-app DM or native share-sheet to WhatsApp/SMS/...).
 *
 * Guarantees mirrored from the notification spine:
 *  - NEVER auto-sends: the server only ever produces a durable DRAFT.
 *  - NEVER client-trusted: the subscription gate is checked server-side against
 *    admin-written entitlements/{uid}; the client cannot unlock it.
 *  - SAFE: requests that are harassing/abusive/hateful are refused, not drafted.
 */

export const ASSISTANT_COLLECTIONS = {
  drafts: 'assistantDrafts',
  usage: 'assistantUsage', // per-user rate-limit windows
  entitlements: 'entitlements',
} as const;

export type DeliveryChannel = 'dm' | 'share';

export interface AssistantDraftDoc {
  uid: string;
  /** Cleaned recipient name as understood from the command (app resolves to a real contact). */
  recipientHint: string;
  /** 2-3 ready-to-send message options. */
  messages: string[];
  /** The prompt used to generate the image (kept for transparency / regenerate). */
  imagePrompt: string;
  /** Public/served URL of the generated image, or null if none. */
  imageUrl: string | null;
  /** Channels the app may offer for this draft. */
  channels: DeliveryChannel[];
  tone: string;
  status: 'draft' | 'sent' | 'discarded';
  createdAt: number;
  expiresAt: number; // drafts self-expire; the app should send or discard before then
}

/** Result of the Gemini drafting step. */
export interface DraftResult {
  recipientName: string;
  messages: string[];
  imagePrompt: string;
  safe: boolean;
  refusalReason: string;
}

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Cost-control rate limit (per user). Generous for a paying user, but bounded.
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const RATE_LIMIT_MAX = 30; // composes per window
