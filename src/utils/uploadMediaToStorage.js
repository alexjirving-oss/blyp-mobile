import * as FileSystem from 'expo-file-system/legacy';
import { auth, firebaseConfig } from '../config/firebase';

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120000;

function maxBytesForContentType(contentType) {
  if (String(contentType || '').startsWith('video/')) return VIDEO_MAX_BYTES;
  return IMAGE_MAX_BYTES;
}

/**
 * Upload a local media file to Firebase Storage using Expo's native uploader.
 * Avoids React Native's broken Blob/ArrayBuffer path through the web Storage SDK.
 *
 * @param {object} args
 * @param {string} args.localUri
 * @param {string} args.storagePath - e.g. users/{uid}/media/photo-123.jpg
 * @param {string} args.contentType
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ downloadURL: string, fullPath: string, bucket: string }>}
 */
export async function uploadMediaToStorage({ localUri, storagePath, contentType, timeoutMs }) {
  if (!localUri || typeof localUri !== 'string') {
    throw new Error('uploadMediaToStorage: missing localUri');
  }
  if (!storagePath || typeof storagePath !== 'string') {
    throw new Error('uploadMediaToStorage: missing storagePath');
  }

  const user = auth?.currentUser;
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('uploadMediaToStorage: Firebase auth required');
  }

  // Prefer the configured bucket. New Firebase projects use
  // `<project>.firebasestorage.app` (appspot.com 404s for this project).
  let bucket = String(firebaseConfig?.storageBucket || 'blyp-master.firebasestorage.app').trim();
  if (bucket.endsWith('.appspot.com')) {
    const project = String(firebaseConfig?.projectId || bucket.split('.')[0] || 'blyp-master').trim();
    const migrated = `${project}.firebasestorage.app`;
    console.warn('[STORAGE_UPLOAD] remapping appspot bucket →', migrated);
    bucket = migrated;
  }
  // Avoid force-refresh on every media item; only refresh if we get a 401 later.
  let token = await user.getIdToken(false);
  if (!token) throw new Error('uploadMediaToStorage: empty ID token');

  // Ensure a real file:// path (camera often returns content://).
  let fileUri = localUri;
  const extGuess = contentType?.includes('video')
    ? 'mp4'
    : contentType?.includes('audio')
      ? 'm4a'
      : 'jpg';
  if (!fileUri.startsWith('file://') && !fileUri.startsWith('http')) {
    const dest = `${FileSystem.cacheDirectory}blyp-upload-${Date.now()}.${extGuess}`;
    await FileSystem.copyAsync({ from: fileUri, to: dest });
    fileUri = dest;
  }

  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info?.exists) {
    throw new Error(`uploadMediaToStorage: file missing at ${fileUri}`);
  }
  if (info.size != null && Number(info.size) <= 0) {
    throw new Error('uploadMediaToStorage: empty file');
  }

  const maxBytes = maxBytesForContentType(contentType);
  if (info.size != null && Number(info.size) > maxBytes) {
    const mb = (Number(info.size) / (1024 * 1024)).toFixed(1);
    const lim = Math.round(maxBytes / (1024 * 1024));
    throw new Error(
      `This ${String(contentType || '').startsWith('video/') ? 'video' : 'file'} is ${mb}MB. Max is ${lim}MB — trim it or pick a shorter clip.`,
    );
  }

  const uploadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o` +
    `?name=${encodeURIComponent(storagePath)}`;

  const ctype = contentType || 'application/octet-stream';
  const limitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_UPLOAD_TIMEOUT_MS;
  console.log('[STORAGE_UPLOAD] starting', {
    bucket,
    storagePath,
    contentType: ctype,
    size: info.size,
    timeoutMs: limitMs,
    authUid: user.uid,
  });

  const runUpload = async (authHeader) => {
    const uploadPromise = FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: authHeader, 'Content-Type': ctype },
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Upload timed out after ${Math.round(limitMs / 1000)}s. Check your connection and try again.`)),
        limitMs,
      );
    });
    return Promise.race([uploadPromise, timeoutPromise]);
  };

  // Firebase Storage REST accepts either "Firebase <token>" or "Bearer <token>".
  const attemptHeaders = () => [
    `Firebase ${token}`,
    `Bearer ${token}`,
  ];

  let lastErr = null;
  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < attemptHeaders().length; i += 1) {
      const authHeader = attemptHeaders()[i];
      try {
        const result = await runUpload(authHeader);

        const status = Number(result?.status || 0);
        let body = null;
        try {
          body = result?.body ? JSON.parse(result.body) : null;
        } catch {
          body = { raw: String(result?.body || '').slice(0, 300) };
        }

        if (status === 401 || status === 403) {
          lastErr = new Error(
            body?.error?.message || body?.error || body?.raw || `HTTP ${status}`,
          );
          console.warn('[STORAGE_UPLOAD] auth/forbidden', { attempt: i + 1, status });
          if (status === 401 && round === 0) {
            token = await user.getIdToken(true);
          }
          continue;
        }

        if (status < 200 || status >= 300) {
          const msg =
            body?.error?.message ||
            body?.error ||
            body?.raw ||
            `HTTP ${status}`;
          lastErr = new Error(`storage_upload_http_${status}: ${msg}`);
          console.warn('[STORAGE_UPLOAD] attempt failed', {
            attempt: i + 1,
            status,
            msg: String(msg).slice(0, 200),
          });
          continue;
        }

        const downloadToken =
          body?.downloadTokens ||
          body?.downloadToken ||
          (typeof body?.metadata?.downloadTokens === 'string'
            ? body.metadata.downloadTokens
            : null);

        const encodedPath = encodeURIComponent(storagePath).replace(/%2F/g, '%2F');
        const downloadURL = downloadToken
          ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;

        console.log('[STORAGE_UPLOAD] ok', { storagePath, status, hasToken: !!downloadToken });
        return { downloadURL, fullPath: storagePath, bucket, meta: body };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        console.warn('[STORAGE_UPLOAD] attempt threw', {
          attempt: i + 1,
          message: lastErr.message,
        });
      }
    }
  }

  throw lastErr || new Error('storage_upload_failed');
}
