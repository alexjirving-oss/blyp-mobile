"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { publishVideoPost } from "@/lib/uploadPost";
import { useAuth } from "./AuthProvider";

export function UploadClient() {
  const { session, loading, requireAuth } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);

  const onPublish = useCallback(async () => {
    if (!session?.sub) {
      requireAuth("Log in to upload");
      return;
    }
    if (!file) {
      setError("Choose a video file first");
      return;
    }
    setBusy(true);
    setError(null);
    setPostId(null);
    setProgress(0);
    setStatus("Preparing…");
    try {
      const ok = await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      if (!ok) throw new Error("Could not bridge Firebase auth");
      const { postId: id } = await publishVideoPost({
        file,
        caption,
        userId: session.sub,
        username: session.username || "creator",
        onProgress: (pct, label) => {
          setProgress(pct);
          setStatus(label);
        },
      });
      setPostId(id);
      setStatus("Published");
      setFile(null);
      setCaption("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [session, file, caption, requireAuth]);

  if (loading) {
    return (
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">Loading…</div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">Upload</h1>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          Log in to publish a video to the same feed as the Blyp app.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-bold text-[var(--blyp-ink)]"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-8 pb-24">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
        Create
      </p>
      <h1 className="font-display mt-1 text-3xl font-bold">Upload</h1>
      <p className="mt-2 text-sm text-[var(--blyp-muted)]">
        Pick a video, add a caption, publish to For You.
      </p>

      <div className="mt-8 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Video</span>
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPostId(null);
              setError(null);
            }}
            className="block w-full text-sm text-[var(--blyp-muted)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--blyp-teal)] file:px-4 file:py-2 file:text-sm file:font-bold file:text-[var(--blyp-ink)]"
          />
          {file ? (
            <p className="mt-2 text-xs text-[var(--blyp-muted)]">
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Caption</span>
          <textarea
            value={caption}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={2200}
            placeholder="What’s this about? Use #hashtags"
            className="w-full resize-y rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-3 text-sm outline-none focus:border-[var(--blyp-teal)]"
          />
        </label>

        {busy || progress > 0 ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-[var(--blyp-muted)]">
              <span>{status || "Working…"}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-[var(--blyp-teal)] transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {postId ? (
          <div className="rounded-2xl border border-[var(--blyp-line)] px-4 py-4">
            <p className="font-semibold text-[var(--blyp-teal)]">Published</p>
            <p className="mt-1 text-sm text-[var(--blyp-muted)]">
              Your video is in the posts feed.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/v/${encodeURIComponent(postId)}`}
                className="rounded-full bg-[var(--blyp-teal)] px-4 py-2 text-sm font-bold text-[var(--blyp-ink)]"
              >
                Watch post
              </Link>
              <Link
                href={`/u/${encodeURIComponent(session.username || "me")}`}
                className="rounded-full border border-[var(--blyp-line)] px-4 py-2 text-sm font-semibold"
              >
                Open Stage
              </Link>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy || !file}
          onClick={() => void onPublish()}
          className="w-full rounded-full bg-[var(--blyp-teal)] py-3 text-sm font-bold text-[var(--blyp-ink)] disabled:opacity-40"
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}
