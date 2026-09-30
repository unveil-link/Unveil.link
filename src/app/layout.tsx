import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://unveil.link"),
  title: {
    default: "Unveil — Sell your files with a simple payment link",
    template: "%s · Unveil",
  },
  description:
    "Unveil lets creators sell photos and videos with a shareable payment link. Buyers pay by card, no account needed, and download instantly.",
  applicationName: "Unveil",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Unveil", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: "Unveil",
    title: "Unveil — Sell your files with a simple payment link",
    description:
      "Upload, set a price, share a link. Get paid by card — no subscriptions, no buyer accounts.",
    url: "https://unveil.link",
  },
  twitter: { card: "summary", title: "Unveil", description: "Sell your files with a simple payment link." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f3be8",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
