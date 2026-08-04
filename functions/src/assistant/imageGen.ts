/**
 * AI image generation for "Blyp it" (Imagen via the Gemini API).
 *
 * Generated imagery is owned + moderatable + licence-clean (vs scraping the web),
 * which is exactly why we chose it. If image generation isn't available (key tier
 * without Imagen, transient error), this returns null and the caller degrades to a
 * text-only draft — the feature never hard-fails on the image.
 */

import fetch from 'node-fetch';
import { admin } from '../firebaseAdmin';

const IMAGE_MODEL = process.env.BLYP_IMAGE_MODEL || 'imagen-3.0-generate-002';

export async function generateAndStoreImage(uid: string, draftId: string, prompt: string): Promise<string | null> {
  const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key || !prompt) return null;

  let base64: string | null = null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict?key=${key}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      console.warn('[blyp-it] image gen not available', res.status);
      return null;
    }
    const data: any = await res.json();
    base64 =
      data?.predictions?.[0]?.bytesBase64Encoded ||
      data?.predictions?.[0]?.image?.bytesBase64Encoded ||
      null;
  } catch (e: any) {
    console.warn('[blyp-it] image gen error', e?.message || String(e));
    return null;
  }

  if (!base64) return null;

  try {
    const buffer = Buffer.from(base64, 'base64');
    const objectPath = `assistant/${uid}/${draftId}.png`;
    const file = admin.storage().bucket().file(objectPath);
    await file.save(buffer, {
      metadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
    });
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days; draft is short-lived anyway
    });
    return signedUrl;
  } catch (e: any) {
    console.warn('[blyp-it] image upload error', e?.message || String(e));
    return null;
  }
}
