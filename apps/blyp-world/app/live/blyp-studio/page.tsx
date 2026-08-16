import type { Metadata } from "next";
import { BlypStudioShell } from "@/components/BlypStudio/BlypStudioShell";

export const metadata: Metadata = {
  title: "BlypStudio — Control room wireframe",
  description:
    "Phase 1 structural wireframe for the Blyp web studio control room.",
};

/**
 * Parallel route: does not replace /live/studio (LiveStudioClient IVS publish).
 * Open: /live/blyp-studio
 */
export default function BlypStudioPage() {
  return <BlypStudioShell />;
}
