import type { Metadata } from "next";
import { SearchClient } from "@/components/SearchClient";

export const metadata: Metadata = {
  title: "Search",
  description: "Search people, videos, and teams on Blyp.",
};

export default function SearchPage() {
  return <SearchClient />;
}
