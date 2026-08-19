"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { publishVideoPost } from "@/lib/uploadPost";
import { useAuth } from "./AuthProvider";
import "./hub-neon.css";

export function UploadClient() {
  const { session, loading, requireAuth } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
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
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [session, file, caption, requireAuth]);

  if (loading) {
    return (
      <div className="hub">
        <p className="hub-kicker">Create</p>
        <h1 className="hub-title">Upload</h1>
        <p className="hub-load">Loading session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="hub">
        <p className="hub-kicker">Create</p>
        <h1 className="hub-title">Upload</h1>
        <p className="hub-lead">
          Publish a video to the same For You feed as the Blyp app.
        </p>
        <div className="hub-card">
          <div className="hub-empty">
            <div className="hub-empty-stage">
              <span>SIGNED OUT</span>
            </div>
            <h2>Log in to upload</h2>
            <p>No draft, no fake progress. Sign in, pick a file, publish.</p>
            <Link href="/login" className="hub-go">
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hub">
      <header>
        <p className="hub-kicker">Create</p>
        <h1 className="hub-title">Upload</h1>
        <p className="hub-lead">
          Pick a video, add a caption, publish to For You. Progress only moves
          when a file is actually uploading.
        </p>
      </header>

      <div className="hub-card" style={{ padding: "1.15rem" }}>
        <label className="hub-drop hub-drop-label">
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPostId(null);
              setError(null);
              setProgress(0);
              setStatus("");
            }}
          />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <p>{(file.size / (1024 * 1024)).toFixed(1)} MB · tap to replace</p>
            </>
          ) : (
            <>
              <strong>No video chosen</strong>
              <p>MP4, WebM, or QuickTime. Tap to pick a file.</p>
            </>
          )}
        </label>

        <label className="hub-field">
          <span>Caption</span>
          <textarea
            value={caption}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={2200}
            placeholder="What’s this about? Use #hashtags"
            className="hub-area"
          />
        </label>

        {busy || (progress > 0 && !postId) ? (
          <div className="hub-progress">
            <div className="hub-progress-row">
              <span>{status || "Working…"}</span>
              <span>{progress}%</span>
            </div>
            <div className="hub-bar">
              <span style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
          </div>
        ) : null}

        {error ? <p className="hub-err">{error}</p> : null}

        {postId ? (
          <div className="hub-ok">
            <p>Published</p>
            <p>Your video is in the posts feed.</p>
            <div className="hub-actions">
              <Link
                href={`/v/${encodeURIComponent(postId)}`}
                className="hub-go"
              >
                Watch post
              </Link>
              <Link
                href={`/u/${encodeURIComponent(session.username || "me")}`}
                className="hub-ghost"
              >
                Open Stage
              </Link>
            </div>
          </div>
        ) : null}

        <div className="hub-actions">
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void onPublish()}
            className="hub-go"
            style={{ width: "100%" }}
          >
            {busy ? "Publishing…" : file ? "Publish" : "Choose a video first"}
          </button>
        </div>
      </div>
    </div>
  );
}
