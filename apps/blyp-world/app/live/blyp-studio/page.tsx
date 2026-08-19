import type { Metadata } from "next";
import { BlypStudioShell } from "@/components/BlypStudio/BlypStudioShell";

export const metadata: Metadata = {
  title: "Grid 9 director — BlypStudio",
  description: "Grid 9 director room (not the main LIVE Studio booth).",
};

/** Grid 9 director — not the homepage booth. Main studio is `/` and `/live/studio`. */
export default function BlypStudioPage() {
  return <BlypStudioShell />;
}
