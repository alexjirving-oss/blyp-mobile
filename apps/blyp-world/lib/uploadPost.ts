"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { firebaseWeb } from "./env";
import { getDb, getFirebaseAuth } from "./firebase";

function extractHashtags(caption: string): string[] {
  const tags = caption.match(/#[\w]+/g) || [];
  return Array.from(new Set(tags.map((t) => t.slice(1).toLowerCase())));
}

function initialReachState() {
  const now = Date.now();
  return {
    v: 1,
    wave: 0,
    stage: "audition",
    exposure: 0.08,
    score: 0,
    impressions: 0,
    waveImpressions: 0,
    engagements: {
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      completions: 0,
      dwellMsTotal: 0,
    },
    version: 1,
    enteredWaveAt: now,
    lastScoredAt: now,
    updatedAt: now,
  };
}

function storageBucket(): string {
  let bucket = String(
    firebaseWeb.storageBucket || "blyp-master.firebasestorage.app",
  ).trim();
  if (bucket.endsWith(".appspot.com")) {
    const project = String(firebaseWeb.projectId || "blyp-master").trim();
    bucket = `${project}.firebasestorage.app`;
  }
  return bucket;
}

async function uploadBlobToStorage(opts: {
  blob: Blob;
  storagePath: string;
  contentType: string;
  onProgress?: (pct: number) => void;
}): Promise<string> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Firebase auth required to upload");
  const token = await user.getIdToken();
  const bucket = storageBucket();
  const url =
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o` +
    `?name=${encodeURIComponent(opts.storagePath)}`;

  const body = await opts.blob.arrayBuffer();
  opts.onProgress?.(5);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Firebase ${token}`,
      "Content-Type": opts.contentType,
    },
    body,
  });
  opts.onProgress?.(90);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Storage upload failed (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }

  const meta = (await res.json()) as {
    downloadTokens?: string;
    name?: string;
  };
  const downloadToken = meta.downloadTokens || "";
  const encodedPath = encodeURIComponent(opts.storagePath).replace(
    /%2F/g,
    "%2F",
  );
  const downloadURL = downloadToken
    ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`
    : `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  opts.onProgress?.(100);
  return downloadURL;
}

export type PublishPostInput = {
  file: File;
  caption: string;
  userId: string;
  username: string;
  userPhotoURL?: string | null;
  onProgress?: (pct: number, label: string) => void;
};

export async function publishVideoPost(
  input: PublishPostInput,
): Promise<{ postId: string }> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser?.uid) {
    throw new Error("Sign in required before publishing");
  }
  if (auth.currentUser.uid !== input.userId) {
    throw new Error("Auth uid mismatch — refresh and try again");
  }

  const file = input.file;
  if (!file) throw new Error("Choose a video file");
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("Video must be under 100MB");
  }

  const caption = String(input.caption || "").trim();
  const username = String(input.username || "creator").trim() || "creator";
  const ext =
    (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "mp4";
  const contentType = file.type || "video/mp4";
  const storagePath = `users/${input.userId}/media/video-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;

  input.onProgress?.(0, "Uploading video…");
  const videoUrl = await uploadBlobToStorage({
    blob: file,
    storagePath,
    contentType,
    onProgress: (pct) => input.onProgress?.(Math.round(pct * 0.85), "Uploading video…"),
  });

  input.onProgress?.(90, "Publishing…");
  const tags = extractHashtags(caption);
  const media = [{ url: videoUrl, type: "video", thumbnail: null }];

  const postData = {
    userId: input.userId,
    username,
    userPhotoURL: input.userPhotoURL || null,
    title: caption.slice(0, 80) || "Video",
    transcript: caption,
    description: caption,
    caption,
    tags,
    hashtags: tags,
    categoryId: null,
    sportTags: [] as string[],
    teamIds: [] as string[],
    emoji: "📸",
    media,
    type: "video",
    videoUrl,
    imageUrl: null,
    audioUrl: null,
    thumbnail: null,
    user: {
      username,
      avatar: input.userPhotoURL || null,
    },
    likes: 0,
    comments: 0,
    shares: 0,
    sharedTo: [] as string[],
    date: serverTimestamp(),
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    views: 0,
    giftCoins: 0,
    giftCount: 0,
    coinsReceived: 0,
    reach: initialReachState(),
  };

  const ref = await addDoc(collection(getDb(), "posts"), postData);
  input.onProgress?.(100, "Live");
  return { postId: ref.id };
}
