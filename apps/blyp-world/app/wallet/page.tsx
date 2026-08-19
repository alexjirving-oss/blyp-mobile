import type { Metadata } from "next";
import { WalletPanel } from "@/components/WalletPanel";

export const metadata: Metadata = {
  title: "Coins & Gems",
  description:
    "Buy Blyp coins (card or PayPal) and withdraw gem earnings — same ledger as the app.",
};

export default function WalletPage() {
  return <WalletPanel />;
}
