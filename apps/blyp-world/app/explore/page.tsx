import type { Metadata } from "next";
import { ExploreClient } from "@/components/ExploreClient";

export const metadata: Metadata = {
  title: "Explore",
  description: "Discover trending videos on Blyp.",
};

export default function ExplorePage() {
  return <ExploreClient />;
}
