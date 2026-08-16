import type { Metadata } from "next";
import { LiveDirectoryLoader } from "@/components/LiveDirectoryLoader";

export const metadata: Metadata = {
  title: "LIVE",
  description:
    "Blyp LIVE directory — watch real live streams on blyp.world. Go live from the Blyp app or LIVE Studio.",
  alternates: { canonical: "/live/" },
  openGraph: {
    title: "Blyp LIVE",
    description: "Watch real Blyp LIVE sessions — gifts, creators, and real-time chat.",
    url: "https://blyp.world/live/",
  },
};

export default function LiveDirectoryPage() {
  return <LiveDirectoryLoader />;
}
