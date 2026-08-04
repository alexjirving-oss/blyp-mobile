// termsService.js
//
// Blyp's two-layer terms (see BLYP_CHARTER.md → "Our terms, in two layers"):
//   • Layer 1 — "How Blyp works": the plain, human statement shown at sign-up.
//   • Layer 2 — the formal, lawyer-drafted Terms (binding). Stubbed here pending
//     legal review; we record which version a user accepted.
//
// Versioned acceptance: bump TERMS_VERSION whenever Layer 1/2 materially change.
// We store the accepted version on the user doc; if it's behind, we re-prompt.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, firebaseEnabled } from '../config/firebase';
import { snapData } from '../utils/firestoreSnap';

export const TERMS_VERSION = 1;

// Local mirror of the accepted version so acceptance survives Firestore write
// failures and, crucially, so a transient Firestore READ failure on launch (very
// common right after an app update while auth/db are still warming up) never
// re-prompts a user who already agreed.
const localKey = (uid) => `@blyp/termsAcceptedVersion/${uid}`;

async function getLocalAcceptedVersion(uid) {
  if (!uid) return 0;
  try {
    const raw = await AsyncStorage.getItem(localKey(uid));
    return Number(raw || 0) || 0;
  } catch {
    return 0;
  }
}

async function setLocalAcceptedVersion(uid, version) {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(localKey(uid), String(version));
  } catch {
    /* non-fatal */
  }
}

// Layer 1 — the honest gist, lifted from the Charter. Each item is shown as a card.
export const HOW_BLYP_WORKS = [
  {
    icon: 'eye-outline',
    title: 'We show our working',
    body:
      'Most apps hide how they rank you, pay you, or moderate you. We don’t. Your dashboard shows what Blyp is doing and what you’re doing — the good and the bad — in plain English.',
  },
  {
    icon: 'trending-up-outline',
    title: 'Your posts earn their reach',
    body:
      'Every post is shown to a sample of the right people first. If they genuinely like it, it goes wider. If they don’t, it doesn’t. You can pay to Boost — but that only buys a bigger, faster test, never a place at the top.',
  },
  {
    icon: 'cash-outline',
    title: 'Creators get their fair share',
    body: 'When your content earns, you get the majority of it. You can see the maths.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Illegal is illegal',
    body:
      'Break the law here and you’re gone — account closed, and where the law requires it, the authorities are told. Zero tolerance, no debate.',
  },
  {
    icon: 'people-outline',
    title: 'We’re not the drama police',
    body:
      'Arguments and people you don’t like? Block, mute, filter, move on — you control your own feed. We won’t referee who said what.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Play fair with the system',
    body:
      'Brigading, fake accounts, gaming the rules — the app isn’t stupid. It notices. You won’t get away with it, and we can close any account that’s here to abuse the place.',
  },
  {
    icon: 'ribbon-outline',
    title: 'Your rating',
    body:
      'You’ve got a standing only you can see. Behave well and it stays high — be proud of it. One complaint? It dips while we take a look, then bounces back if it was nothing. Keep it up and it’ll slide.',
  },
  {
    icon: 'card-outline',
    title: 'Try it all, then choose',
    body:
      'Your first 30 days are the full app, free — cancel any time. After that the app stays useful for free; the AI extras become a paid upgrade. Plus is $4.99/mo for everything, or $9.99/mo gets everything plus 999 coins a month. Paying never buys you reach; it buys features and coins. Coins can be gifted or turned into gems, but they’re not cashable.',
  },
  {
    icon: 'gift-outline',
    title: 'Your data is yours to trade',
    body:
      'We don’t sell you by default. If a business wants access to your data, we ask you directly, in plain words, and a share of what they pay comes back to you — with zero penalty for saying no.',
  },
];

export const LAYER_2_NOTE =
  'The full legal Terms sit behind this and are what’s legally binding — but the above is the honest gist. The formal Terms are being finalised with our lawyers.';

/** Read the user's accepted terms version (0 if none/unknown). */
export async function getAcceptedVersion(uid) {
  if (!firebaseEnabled || !db?.collection || !uid) return 0;
  try {
    const snap = await db.collection('users').doc(uid).get();
    return Number(snapData(snap)?.acceptedTermsVersion || 0);
  } catch {
    return 0;
  }
}

/**
 * Has this user accepted the current terms version?
 *
 * Resilient by design — we only ever re-prompt when we are CERTAIN the user is
 * behind:
 *   1. If the local mirror already shows the current version, never prompt (no
 *      network needed).
 *   2. Otherwise read Firestore. Only prompt if the read succeeds AND the stored
 *      version is genuinely behind. On any read failure we fail OPEN (no prompt),
 *      so a flaky launch can't nag a user who already agreed.
 *   3. If Firestore says they're current but the local mirror was missing (e.g.
 *      after reinstall), backfill the local mirror.
 */
export async function needsAcceptance(uid) {
  if (!uid) return false;

  const local = await getLocalAcceptedVersion(uid);
  if (local >= TERMS_VERSION) return false;

  if (!firebaseEnabled || !db?.collection) return false;

  try {
    const snap = await db.collection('users').doc(uid).get();
    const remote = Number(snapData(snap)?.acceptedTermsVersion || 0);
    if (remote >= TERMS_VERSION) {
      await setLocalAcceptedVersion(uid, remote);
      return false;
    }
    // Definitive read showing they're behind → prompt once.
    return true;
  } catch (e) {
    // Read failed (offline / cold start / rules race) — do NOT nag. We'd rather
    // miss a re-prompt than show it on every launch when the network blips.
    console.warn('[terms] needsAcceptance read failed; failing open', e?.message || String(e));
    return false;
  }
}

/** Record acceptance of the current terms version (local first, then Firestore). */
export async function recordAcceptance(uid) {
  if (!uid) return false;
  // Persist locally first so acceptance sticks even if the Firestore write fails.
  await setLocalAcceptedVersion(uid, TERMS_VERSION);

  if (!firebaseEnabled || !db?.collection) return true;
  try {
    await db.collection('users').doc(uid).set(
      { acceptedTermsVersion: TERMS_VERSION, acceptedTermsAt: Date.now() },
      { merge: true },
    );
    return true;
  } catch (e) {
    console.warn('[terms] recordAcceptance Firestore write failed (kept locally)', e?.message || String(e));
    return false;
  }
}

export default {
  TERMS_VERSION,
  HOW_BLYP_WORKS,
  LAYER_2_NOTE,
  getAcceptedVersion,
  needsAcceptance,
  recordAcceptance,
};
