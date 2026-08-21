"use client";

import { Kbd } from "@/components/ui/kbd";
import * as React from "react";

/**
 * One-line lesson under the board. It retires permanently after the first
 * successful keyboard move — a one-time lesson should not become permanent
 * chrome (see `useBoardHint`).
 */
export function BoardKeyboardHint() {
  return (
    <div className="mt-2 hidden shrink-0 items-center gap-1.5 text-[12px] text-[var(--fg-subtle)] md:flex">
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <span>to move</span>
      <span>·</span>
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>to switch column</span>
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

const HINT_KEY = "sifty.board.hint";

export function useBoardHint(): { hintVisible: boolean; retireHint: () => void } {
  const [hintVisible, setHintVisible] = React.useState(false);

  React.useEffect(() => {
    try {
      setHintVisible(window.localStorage.getItem(HINT_KEY) !== "retired");
    } catch {
      setHintVisible(true);
    }
  }, []);

  const retireHint = React.useCallback(() => {
    setHintVisible(false);
    try {
      window.localStorage.setItem(HINT_KEY, "retired");
    } catch {
      // Session-only retirement is fine.
    }
  }, []);

  return { hintVisible, retireHint };
}
