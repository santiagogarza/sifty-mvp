"use client";

import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import {
  BOARD_PATH,
  isListViewPath,
  listReturnPath,
  rememberListReturn,
} from "@/lib/utils/view-toggle";
import { Columns3, Rows3 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

export type ViewMode = "list" | "board";

/**
 * Where the layout toggle applies and how to flip it. The board is one
 * place (`/board`) for the whole pipeline, so "list" returns to whichever
 * list route the user came from.
 */
export function useViewToggle(): {
  current: ViewMode | null;
  setView: (view: ViewMode) => void;
  toggleView: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();

  const current: ViewMode | null =
    pathname === BOARD_PATH ? "board" : isListViewPath(pathname) ? "list" : null;

  const setView = React.useCallback(
    (view: ViewMode) => {
      if (view === "board") {
        if (isListViewPath(pathname)) rememberListReturn(pathname);
        router.push(BOARD_PATH);
      } else {
        router.push(listReturnPath());
      }
    },
    [router, pathname],
  );

  const toggleView = React.useCallback(() => {
    if (current === "list") setView("board");
    else if (current === "board") setView("list");
  }, [current, setView]);

  return { current, setView, toggleView };
}

/**
 * List ⇄ board layout switch. Quiet by design: two icons in a segmented
 * control, rendered only on the task views where a layout choice exists.
 * `V` flips it from the keyboard.
 */
export function ViewSwitch() {
  const router = useRouter();
  const { current, setView } = useViewToggle();

  React.useEffect(() => {
    if (current) router.prefetch(current === "board" ? listReturnPath() : BOARD_PATH);
  }, [router, current]);

  if (!current) return null;

  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="Layout"
        className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]/70 p-[3px]"
      >
        <ViewSwitchButton
          label="List view"
          active={current === "list"}
          onClick={() => setView("list")}
        >
          <Rows3 size={14} strokeWidth={1.9} />
        </ViewSwitchButton>
        <ViewSwitchButton
          label="Board view"
          active={current === "board"}
          onClick={() => setView("board")}
        >
          <Columns3 size={14} strokeWidth={1.9} />
        </ViewSwitchButton>
      </div>
    </TooltipProvider>
  );
}

function ViewSwitchButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut="V">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "flex h-6.5 w-8 items-center justify-center rounded-[5px]",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          active
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.08)]"
            : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
