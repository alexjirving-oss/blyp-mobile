import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <SurfaceShell eyebrow="Discover" title="Search">
      <p className="max-w-xl text-[var(--blyp-muted)]">
        People, tags, and sounds — keyboard-first, faster than mobile search.
      </p>
    </SurfaceShell>
  );
}
