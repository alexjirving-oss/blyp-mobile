import type { Metadata } from "next";
import { StudioDeckPageClient } from "@/components/StudioDeckPageClient";
import "./deck.css";

export const metadata: Metadata = {
  title: "Studio Deck — Stream Deck companion",
  description:
    "Dark neon soundboard and scene pads for Elgato Stream Deck Website actions. Fires commands into LIVE Studio — does not encode.",
};

export default function StudioDeckPage() {
  return <StudioDeckPageClient />;
}
