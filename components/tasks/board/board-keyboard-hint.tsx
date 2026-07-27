"use client";

import { Kbd } from "@/components/ui/kbd";
import * as React from "react";

/**
 * The one-time keyboard lesson. It's shown until the first successful
 * keyboard move, then retires — a lesson shouldn't become permanent chrome.
 * Visibility (and its persistence) is owned by the board.
 */
export function BoardKeyboardHint() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--fg-subtle)]">
      <Hint keys={["j", "k"]}>to move</Hint>
      <Dot />
      <Hint keys={["←", "→"]}>to switch column</Hint>
      <Dot />
      <Hint keys={["⇧←", "⇧→"]}>to file</Hint>
      <Dot />
      <Hint keys={["↵"]}>to open</Hint>
    </div>
  );
}

function Hint({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span className="ml-0.5">{children}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-[var(--border-strong)]">·</span>;
}
