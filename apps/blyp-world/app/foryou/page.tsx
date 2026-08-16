import type { Metadata } from "next";
import { ForYouClient } from "@/components/ForYouClient";

export const metadata: Metadata = {
  title: "For You",
  description:
    "Blyp For You — watch without an account. Log in to like, gift, and comment.",
};

export default function ForYouPage() {
  return <ForYouClient />;
}
