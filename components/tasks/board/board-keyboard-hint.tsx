import { Kbd } from "@/components/ui/kbd";

export function BoardKeyboardHint() {
  return (
    <div className="hidden flex-wrap items-center gap-1 text-[12px] text-[var(--fg-subtle)] md:flex">
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <span>within</span>
      <span>·</span>
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>across</span>
      <span>·</span>
      <Kbd>⇧←</Kbd>
      <Kbd>⇧→</Kbd>
      <span>to file</span>
      <span>·</span>
      <Kbd>↵</Kbd>
      <span>to open</span>
    </div>
  );
}
