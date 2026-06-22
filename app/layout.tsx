import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sifty — calm AI productivity",
  description:
    "Capture instantly. Sifty's AI organizes, prioritizes, and surfaces the next action — without slowing you down.",
  applicationName: "Sifty",
  appleWebApp: {
    title: "Sifty",
    capable: true,
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
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
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
