"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

export type TaskViewMode = "list" | "board";

function storageKey(pathname: string): string {
  return `sifty.view.${pathname}`;
}

export function useBoardMode(): {
  mode: TaskViewMode;
  setMode: (mode: TaskViewMode) => void;
} {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const urlMode = search.get("view");
  const [remembered, setRemembered] = React.useState<TaskViewMode>("list");

  React.useEffect(() => {
    if (urlMode === "list" || urlMode === "board") {
      setRemembered(urlMode);
      window.localStorage.setItem(storageKey(pathname), urlMode);
      return;
    }
    const stored = window.localStorage.getItem(storageKey(pathname));
    if (stored === "board") setRemembered("board");
  }, [pathname, urlMode]);

  const mode = urlMode === "board" || urlMode === "list" ? urlMode : remembered;

  const setMode = React.useCallback(
    (next: TaskViewMode) => {
      setRemembered(next);
      window.localStorage.setItem(storageKey(pathname), next);
      const params = new URLSearchParams(search.toString());
      params.set("view", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, search],
  );

  return { mode, setMode };
}
