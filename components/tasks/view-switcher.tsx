"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import type { TaskLayout } from "@/lib/hooks/use-task-layout";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";

export function ViewSwitcher({
  layout,
  onLayoutChange,
}: {
  layout: TaskLayout;
  onLayoutChange: (layout: TaskLayout) => void;
}) {
  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="View layout"
        className={cn(
          "inline-flex items-center rounded-[var(--radius-sm)] p-0.5",
          "border border-[var(--border)] bg-[var(--surface-muted)]/60",
        )}
      >
        <Tooltip label="List view" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-pressed={layout === "list"}
            onClick={() => onLayoutChange("list")}
            className={cn(
              "h-7 w-7 rounded-[5px]",
              layout === "list" && "bg-[var(--surface)] shadow-sm text-[var(--fg)]",
              layout !== "list" && "text-[var(--fg-muted)]",
            )}
          >
            <List size={14} />
            <span className="sr-only">List view</span>
          </Button>
        </Tooltip>
        <Tooltip label="Board view" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            aria-pressed={layout === "board"}
            onClick={() => onLayoutChange("board")}
            className={cn(
              "h-7 w-7 rounded-[5px]",
              layout === "board" && "bg-[var(--surface)] shadow-sm text-[var(--fg)]",
              layout !== "board" && "text-[var(--fg-muted)]",
            )}
          >
            <Columns3 size={14} />
            <span className="sr-only">Board view</span>
          </Button>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
