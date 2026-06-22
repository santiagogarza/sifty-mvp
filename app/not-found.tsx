import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-eyebrow mb-3">404</div>
        <h1 className="text-display text-[40px]">This corner is empty.</h1>
        <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
          Maybe the link is old, or the task moved on. Either way, your inbox is over here.
        </p>
        <Link
          href="/today"
          className="inline-flex mt-6 h-9 items-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] px-4 text-[13.5px] font-medium"
        >
          Back to Today
        </Link>
      </div>
    </div>
  );
}
