import type { Metadata } from "next";
import { TeamsPreviewClient } from "./TeamsPreviewClient";

export const metadata: Metadata = {
  title: "Teams desk preview — Blyp",
  description:
    "Interactive preview of the Blyp Teams operator desk: roster, LIVE ops, money, battles.",
  robots: { index: false, follow: false },
};

export default function TeamsPreviewPage() {
  return <TeamsPreviewClient />;
}
