"use client";

import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Kanban, List } from "lucide-react";
import * as React from "react";

export function ViewModeToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const hydrated = useStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="flex bg-[var(--surface-muted)] p-0.5 rounded-md">
        <div className="w-8 h-7" />
        <div className="w-8 h-7" />
      </div>
    );
  }

  return (
    <div className="flex bg-[var(--surface-muted)] p-0.5 rounded-md">
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-8 rounded-sm",
          viewMode === "list"
            ? "bg-[var(--surface)] shadow-sm text-[var(--fg)]"
            : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
        )}
        onClick={() => setViewMode("list")}
        aria-label="List view"
      >
        <List size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-8 rounded-sm",
          viewMode === "board"
            ? "bg-[var(--surface)] shadow-sm text-[var(--fg)]"
            : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
        )}
        onClick={() => setViewMode("board")}
        aria-label="Board view"
      >
        <Kanban size={14} />
      </Button>
    </div>
  );
}
