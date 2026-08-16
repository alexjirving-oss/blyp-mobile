import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";

export const metadata: Metadata = {
  title: "Search",
  description: "Search people, tags, and sounds on Blyp.",
  alternates: { canonical: "/search/" },
};

export default function SearchPage() {
  return (
    <SurfaceShell eyebrow="Discover" title="Search">
      <p className="max-w-xl text-[var(--blyp-muted)]">
        People, tags, and sounds — keyboard-first, faster than mobile search.
      </p>
    </SurfaceShell>
  );
}
