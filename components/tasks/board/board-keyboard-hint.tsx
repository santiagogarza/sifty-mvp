"use client";

export function BoardKeyboardHint({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <div className="hidden items-center gap-2 text-[11px] text-[var(--fg-subtle)] md:flex">
      <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5">
        j/k
      </kbd>
      <span>move</span>
      <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5">
        ←/→
      </kbd>
      <span>columns</span>
      <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5">
        ⇧←/⇧→
      </kbd>
      <span>file</span>
      <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5">
        Enter
      </kbd>
      <span>open</span>
    </div>
  );
}
