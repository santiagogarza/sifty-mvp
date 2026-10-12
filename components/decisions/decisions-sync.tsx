"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { useDecisionsStore } from "@/lib/decisions/client";
import { SIFT_SETTLED_EVENT } from "@/lib/decisions/events";
import * as React from "react";

/**
 * Keeps the Decisions cache fresh from inside the app frame: once the
 * server pull has settled, when the tab regains focus, and whenever a
 * watched sift settles (the moment a question can have appeared).
 */
export function DecisionsSync() {
  const { serverReady } = useFrame();
  const refresh = useDecisionsStore((s) => s.refresh);

  React.useEffect(() => {
    if (!serverReady) return;
    void refresh();
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onSettled = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SIFT_SETTLED_EVENT, onSettled);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SIFT_SETTLED_EVENT, onSettled);
    };
  }, [serverReady, refresh]);

  return null;
}

/** Open-decision count for nav badges; 0 until loaded. */
export function useOpenDecisionCount(): number {
  return useDecisionsStore((s) => s.count);
}
