import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Support assistant builder",
  description: "Build a support assistant that answers from your own documents, try it, and embed it on your website.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        {children}
        <Analytics />

        {/* AI Support Widget */}
        <Script
          src="/ai-support-widget.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
