import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false, follow: false },
};

export default function FollowingPage() {
  return (
    <SurfaceShell eyebrow="Watch" title="Following">
      <p className="max-w-xl text-[var(--blyp-muted)]">
        Signed-in feed of people you follow. Empty states teach — they do not
        fake content.
      </p>
    </SurfaceShell>
  );
}
