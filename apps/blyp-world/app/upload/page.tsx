import type { Metadata } from "next";
import { UploadClient } from "@/components/UploadClient";

export const metadata: Metadata = {
  title: "Upload",
  description: "Publish a video to Blyp For You.",
};

export default function UploadPage() {
  return <UploadClient />;
}
