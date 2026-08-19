import type { Metadata } from "next";
import { CommandCenterClient } from "@/components/CommandCenterClient";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/site";

export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
};

/** Homepage dashboard. LIVE Studio lives at /live/studio. */
export default function HomePage() {
  return <CommandCenterClient />;
}
