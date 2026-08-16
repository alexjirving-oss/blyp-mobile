import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import { SiteChrome } from "@/components/SiteChrome";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://blyp.world"),
  title: {
    default: "Blyp",
    template: "%s · Blyp",
  },
  description:
    "For You, Explore, LIVE, Stage, Messages, and coins — Blyp on the web.",
  openGraph: {
    type: "website",
    siteName: "Blyp",
    title: "Blyp",
    description: "Short video, LIVE, Stage, and Messages on blyp.world.",
    url: "https://blyp.world/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blyp",
    description: "Watch, gift, message, and go live on Blyp.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${dmSans.variable} antialiased`}>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
