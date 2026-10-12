import Link from "next/link";

/** Logo + name used by the public pages. The in-app sidebar has its own. */
export function SiftyWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-[6px]" aria-label="Sifty">
      <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--accent)]/15 border border-[var(--accent)]/30">
        <span className="absolute inset-0 rounded-[6px] bg-[var(--accent)] opacity-10 blur-[6px]" />
        <span className="relative size-2 rounded-full bg-[var(--accent)]" />
      </span>
      <span className="text-[15px] font-medium tracking-[-0.01em] text-[var(--fg)]">Sifty</span>
    </Link>
  );
}
