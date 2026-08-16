import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <SurfaceShell eyebrow="Create" title="Upload">
      <p className="max-w-xl text-[var(--blyp-muted)]">
        Desktop file upload, caption, and schedule — creator desk parity with
        TikTok web, then better.
      </p>
    </SurfaceShell>
  );
}
