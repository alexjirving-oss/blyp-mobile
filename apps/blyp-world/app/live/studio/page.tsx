import type { Metadata } from "next";
import { LiveStudioClient } from "@/components/LiveStudioClient";

export const metadata: Metadata = {
  title: "LIVE Studio — Host operator desk",
  description:
    "Create LIVE sessions, share watch links, manage guests, track gifts, and go on air from the Blyp app.",
};

export default function LiveStudioPage() {
  return <LiveStudioClient />;
}
