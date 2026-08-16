import type { Metadata } from "next";
import { FollowingClient } from "@/components/FollowingClient";

export const metadata: Metadata = {
  title: "Following",
  description: "Videos from accounts you follow on Blyp.",
};

export default function FollowingPage() {
  return <FollowingClient />;
}
