import type { Metadata } from "next";
import { InboxClient } from "@/components/InboxClient";

export const metadata: Metadata = {
  title: "Messages",
  description: "Direct messages on Blyp.",
};

export default function InboxPage() {
  return <InboxClient />;
}
