import type { Metadata } from "next";
import { LiveDirectoryLoader } from "@/components/LiveDirectoryLoader";

export const metadata: Metadata = {
  title: "LIVE",
  description: "Blyp LIVE directory — real sessions only.",
};

export default function LiveDirectoryPage() {
  return <LiveDirectoryLoader />;
}
