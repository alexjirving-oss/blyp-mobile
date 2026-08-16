import type { Metadata } from "next";
import { LiveStudioClient } from "@/components/LiveStudioClient";

export const metadata: Metadata = {
  title: "LIVE Studio — Host from browser",
  description:
    "Go LIVE from desktop Chrome/Edge: IVS Real-Time publish, watch links, and guest accept.",
};

export default function LiveStudioPage() {
  return <LiveStudioClient />;
}
