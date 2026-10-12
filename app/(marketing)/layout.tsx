import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import * as React from "react";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-[var(--bg)]">
      <SiteHeader />
      <main id="main" className="relative z-10 flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
