"use client";

import { Kbd } from "@/components/ui/kbd";
import * as React from "react";

/**
 * The board's keyboard contract, stated once at the foot of the page.
 * Selection and filing are deliberately different keys, so nobody files a
 * card while browsing.
 */
export function BoardKeyboardHint() {
  return (
    <div className="hidden md:flex shrink-0 items-center gap-1.5 pt-3 pb-1 text-[11.5px] text-[var(--fg-subtle)]">
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span className="ml-1">move selection</span>
      <span className="mx-1.5 text-[var(--border-strong)]">·</span>
      <Kbd>⇧←</Kbd>
      <Kbd>⇧→</Kbd>
      <span className="ml-1">file the card</span>
      <span className="mx-1.5 text-[var(--border-strong)]">·</span>
      <Kbd>↵</Kbd>
      <span className="ml-1">open</span>
    </div>
  );
}
