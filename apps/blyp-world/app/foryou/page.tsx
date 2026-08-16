import type { Metadata } from "next";
import { ForYouClient } from "@/components/ForYouClient";

export const metadata: Metadata = {
  title: "For You",
  description:
    "Blyp For You — short video on blyp.world. Watch without an account; log in to like, gift, and comment.",
  alternates: { canonical: "/foryou/" },
  openGraph: {
    title: "Blyp For You",
    description: "Watch short video on Blyp — reach is earned, not bought.",
    url: "https://blyp.world/foryou/",
  },
};

export default function ForYouPage() {
  return <ForYouClient />;
}
