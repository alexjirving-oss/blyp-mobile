import { VideoClient } from "@/components/VideoClient";

export function generateStaticParams() {
  return [{ id: "_" }];
}

/** Share alias of /v/[id] — Netlify also routes /p/* through share-post for OG. */
export default function PostSharePage() {
  return <VideoClient />;
}
