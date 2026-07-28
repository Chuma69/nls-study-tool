import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "NLS Study Tool",
  description:
    "Study companion for the Nigerian Law School Bar Part II Finals — MCQ trainer, grounded tutor, and progress dashboard.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NLS Study",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><SiteNav />{children}</body>
    </html>
  );
}
