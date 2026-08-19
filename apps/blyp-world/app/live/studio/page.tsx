import type { Metadata } from "next";
import { LiveStudioClient } from "@/components/LiveStudioClient";

export const metadata: Metadata = {
  title: "LIVE Studio — Host booth",
  description:
    "Blyp LIVE Studio — sources, guests, chat, gifts, Go LIVE.",
};

export default function LiveStudioPage() {
  return <LiveStudioClient />;
}
