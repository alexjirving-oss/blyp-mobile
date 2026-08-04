// blypItService — client for the premium "Blyp it" AI compose endpoint.
//
// Flow: user gives a natural-language command ("wish Ru happy birthday") → server
// drafts message options + an image (premium-gated, rate-limited, self-moderated) →
// we show a preview → the user picks a message and SENDS it themselves via the share
// sheet. The server NEVER auto-sends; delivery is always an explicit user action.
//
// Endpoint: POST /blypAssistantCompose, Bearer <Firebase ID token>.
//   Body:     { command }  (or { recipient, gist, tone })
//   200:      { ok, draftId, recipientName, messages[], imageUrl, channels, tone }
//   401 unauthenticated | 402 subscription_required | 429 rate_limited
//   422 unsafe { detail } | 503 ai_unavailable|no_draft | 400 empty_request

import { Share } from 'react-native';

const FUNCTIONS_BASE = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-blyp-master.cloudfunctions.net'
).replace(/\/+$/, '');

const ENDPOINT = `${FUNCTIONS_BASE}/blypAssistantCompose`;

async function firebaseIdToken() {
  try {
    // eslint-disable-next-line global-require
    const cfg = require('../config/firebase');
    const user = cfg?.auth?.currentUser;
    if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
  } catch (e) {
    console.warn('[blypit] could not get Firebase ID token', e?.message || String(e));
  }
  return null;
}

/**
 * Compose a draft. Returns a tagged result so the UI can react to each case:
 *   { ok:true, draftId, recipientName, messages, imageUrl, tone }
 *   { ok:false, code:'unauthenticated'|'subscription_required'|'rate_limited'
 *              |'unsafe'|'ai_unavailable'|'empty_request'|'error', detail? }
 */
export async function composeBlyp({ command, recipient, gist, tone } = {}) {
  const token = await firebaseIdToken();
  if (!token) return { ok: false, code: 'unauthenticated' };

  const body = command ? { command } : { recipient, gist, tone };
  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data?.ok) {
      return {
        ok: true,
        draftId: data.draftId,
        recipientName: data.recipientName || '',
        messages: Array.isArray(data.messages) ? data.messages : [],
        imageUrl: data.imageUrl || null,
        channels: data.channels || ['share'],
        tone: data.tone || tone || 'warm',
      };
    }

    // Map HTTP status + server reason to a stable client code.
    const codeByStatus = {
      400: 'empty_request',
      401: 'unauthenticated',
      402: 'subscription_required',
      422: 'unsafe',
      429: 'rate_limited',
      503: 'ai_unavailable',
    };
    return {
      ok: false,
      code: data?.reason || codeByStatus[resp.status] || 'error',
      detail: data?.detail || null,
    };
  } catch (e) {
    return { ok: false, code: 'error', detail: String(e?.message || 'compose-failed') };
  }
}

/**
 * Record the outcome of a draft. Firestore rules let the owner change ONLY `status`.
 * status: 'sent' (delivered) | 'discarded' (cancelled).
 */
export async function markDraftStatus(draftId, status) {
  if (!draftId || !status) return false;
  try {
    // eslint-disable-next-line global-require
    const { db } = require('../config/firebase');
    await db.collection('assistantDrafts').doc(draftId).update({ status });
    return true;
  } catch (e) {
    console.warn('[blypit] markDraftStatus failed', e?.message || String(e));
    return false;
  }
}

/** Share a chosen message via the native share sheet (WhatsApp/SMS/any app). */
export async function shareMessageText(text) {
  const message = String(text || '').trim();
  if (!message) return false;
  try {
    await Share.share({ message });
    return true;
  } catch (e) {
    console.warn('[blypit] share text failed', e?.message || String(e));
    return false;
  }
}

/**
 * Share the generated image: download the signed URL to a cache file, then hand it
 * to the native share sheet via expo-sharing. Falls back to sharing the URL as text.
 */
export async function shareImage(imageUrl, caption) {
  const url = String(imageUrl || '').trim();
  if (!url) return false;
  try {
    // eslint-disable-next-line global-require
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line global-require
    const Sharing = require('expo-sharing');
    const target = `${FileSystem.cacheDirectory}blypit_${Date.now()}.png`;
    const dl = await FileSystem.downloadAsync(url, target);
    const available = await Sharing.isAvailableAsync().catch(() => false);
    if (dl?.uri && available) {
      await Sharing.shareAsync(dl.uri, { mimeType: 'image/png', dialogTitle: caption || 'Share image' });
      return true;
    }
  } catch (e) {
    console.warn('[blypit] share image failed, falling back to URL', e?.message || String(e));
  }
  // Fallback: share the image link as text.
  return shareMessageText(caption ? `${caption}\n${url}` : url);
}

export default { composeBlyp, markDraftStatus, shareMessageText, shareImage };
