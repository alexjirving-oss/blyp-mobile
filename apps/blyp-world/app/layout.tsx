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
    default: "Blyp — Watch. Live. Gift.",
    template: "%s · Blyp",
  },
  description:
    "Short video, live streaming, Stage pages, and coins — on the web and in the app. Reach is earned, not bought.",
  openGraph: {
    type: "website",
    siteName: "Blyp",
    title: "Blyp — Watch. Live. Gift.",
    description:
      "A live-first social product on the web: For You, LIVE, Stage, and coins.",
    url: "https://blyp.world/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blyp — Watch. Live. Gift.",
    description: "Watch, gift, and go live — without being stranded in an app funnel.",
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
