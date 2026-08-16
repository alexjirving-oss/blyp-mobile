import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";
import { WalletPanel } from "@/components/WalletPanel";

export const metadata: Metadata = {
  title: "Coins",
  description:
    "Buy Blyp coins on the web with Stripe — same ledger as the Blyp app on Google Play.",
  alternates: { canonical: "/wallet/" },
};

export default function WalletPage() {
  return (
    <SurfaceShell eyebrow="Economy" title="Coins">
      <WalletPanel />
    </SurfaceShell>
  );
}
