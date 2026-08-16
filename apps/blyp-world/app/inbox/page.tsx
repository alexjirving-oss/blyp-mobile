import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <SurfaceShell eyebrow="Messages" title="Inbox">
      <p className="max-w-xl text-[var(--blyp-muted)]">
        TikTok strands DMs in the app. Blyp does not — web inbox is part of the
        product architecture from day one.
      </p>
    </SurfaceShell>
  );
}
