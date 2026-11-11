"use client";

import { localIsoDate } from "@/lib/domain/snooze";
import * as React from "react";

/**
 * The current moment, as a Date whose identity changes only when the local
 * day rolls over. Views memoize on it, so snoozed tasks wake up at midnight
 * (or when a backgrounded tab regains focus the next morning) without a
 * reload — and nothing re-renders in between.
 */
export function useToday(): Date {
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const refresh = () => {
      const fresh = new Date();
      setNow((prev) => (localIsoDate(prev) === localIsoDate(fresh) ? prev : fresh));
    };

    const scheduleMidnight = () => {
      const fresh = new Date();
      const nextMidnight = new Date(
        fresh.getFullYear(),
        fresh.getMonth(),
        fresh.getDate() + 1,
      ).getTime();
      // Timers drift and pause in background tabs; the focus and
      // visibility listeners below cover what this one misses.
      timer = setTimeout(
        () => {
          refresh();
          scheduleMidnight();
        },
        nextMidnight - fresh.getTime() + 1000,
      );
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    scheduleMidnight();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return now;
}
