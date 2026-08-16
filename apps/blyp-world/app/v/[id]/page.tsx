import { VideoClient } from "@/components/VideoClient";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function VideoPage() {
  return <VideoClient />;
}
