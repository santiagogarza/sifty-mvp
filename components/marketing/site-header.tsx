import { SiftyWordmark } from "@/components/marketing/sifty-wordmark";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="relative z-10">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-20 focus:rounded-[var(--radius-sm)] focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:text-[13px]"
      >
        Skip to content
      </a>
      <nav
        aria-label="Site"
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:px-6"
      >
        <SiftyWordmark />
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "hidden sm:inline-flex",
            )}
          >
            Pricing
          </Link>
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
          <Link href="/sign-up" className={buttonVariants({ variant: "primary", size: "sm" })}>
            Start free
          </Link>
        </div>
      </nav>
    </header>
  );
}
