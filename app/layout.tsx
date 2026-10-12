import { SentryClient } from "@/components/observability/sentry-client";
import { Analytics } from "@vercel/analytics/next";
import { SITE_DESCRIPTION, getSiteUrl } from "@/lib/site/config";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: "Sifty — write it down, Sifty does the rest", template: "%s — Sifty" },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Sifty",
    title: "Sifty — write it down, Sifty does the rest",
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sifty — write it down, Sifty does the rest",
    description: SITE_DESCRIPTION,
  },
  applicationName: "Sifty",
  appleWebApp: {
    title: "Sifty",
    capable: true,
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c08" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Render the theme as early as possible so the first paint is correct. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{const s=localStorage.getItem("sifty.theme")||"system";const m=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";const t=s==="system"?m:s;document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(_){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh">
        {children}
        <SentryClient />
        <Analytics />
      </body>
    </html>
  );
}
