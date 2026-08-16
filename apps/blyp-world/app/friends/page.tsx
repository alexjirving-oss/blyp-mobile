import type { Metadata } from "next";
import { FriendsClient } from "@/components/FriendsClient";

export const metadata: Metadata = {
  title: "Friends",
  description: "Mutual follows and people you follow on Blyp.",
};

export default function FriendsPage() {
  return <FriendsClient />;
}
