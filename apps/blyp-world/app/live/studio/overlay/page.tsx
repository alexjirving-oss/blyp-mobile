import type { Metadata } from "next";
import { StudioOverlayPageClient } from "@/components/StudioOverlayPageClient";

export const metadata: Metadata = {
  title: "Studio Overlay — Browser Source",
  description:
    "Clean-feed overlays for OBS / TikFinity-style Browser Source. Pair with Blyp LIVE Studio on the same browser.",
};

export default function StudioOverlayPage() {
  return <StudioOverlayPageClient />;
}
