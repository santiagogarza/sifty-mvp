"use client";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils/cn";
import { Plus, Search } from "lucide-react";
import * as React from "react";
import { PomodoroControl } from "./pomodoro-control";

/**
 * Top bar — kept intentionally light. The page content owns its own H1
 * heading so the top bar is just affordances: focus timer, command palette,
 * capture.
 */
export function TopBar({
  onCapture,
  onCommand,
  title,
  subtitle,
  rightSlot,
}: {
  onCapture: () => void;
  onCommand: () => void;
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20",
        "flex items-center justify-between gap-3 px-4 sm:px-6 md:px-8",
        "h-14 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        {title ? (
          <h1 className="truncate text-[16px] font-medium tracking-[-0.01em] text-[var(--fg)]">
            {title}
          </h1>
        ) : null}
        {subtitle ? (
          <span className="hidden sm:inline-block truncate text-[13px] text-[var(--fg-subtle)]">
            {subtitle}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {rightSlot}
        <PomodoroControl />
        {/* Visible on phones too: with no sidebar there, the palette is the
            route to Waiting on / Someday / Done. */}
        <button
          type="button"
          onClick={onCommand}
          className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] transition-colors"
          aria-label="Open command palette"
        >
          <Search size={13} />
          <span className="hidden md:inline">Search & jump</span>
          <span className="hidden md:inline-flex items-center gap-1">
            <Kbd>/</Kbd>
          </span>
        </button>

        <Button
          variant="primary"
          onClick={onCapture}
          className="hidden md:inline-flex"
          aria-label="Capture task"
        >
          <Plus size={14} strokeWidth={2.4} />
          Capture
          <Kbd className="!h-4 ml-1 bg-[oklch(0%_0_0/0.18)] text-[var(--accent-fg)] border-[oklch(100%_0_0/0.15)]">
            C
          </Kbd>
        </Button>
      </div>
    </header>
  );
}
