"use client";

import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { bucketTone, priorityPillHint, priorityPillLabel } from "@/lib/domain/priority";
import type { PriorityBucket } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

/**
 * Priority as a labeled pill (decision D11, replacing the 2×2 dot glyph
 * that SIF-14 found unreadable). Color and text carry the same meaning,
 * so neither has to be learned; the tooltip spells out the two axes and
 * the scores behind them.
 *
 * `compact` is the list/board form: a colored dot everywhere, the label
 * from the `sm` breakpoint up so phone rows keep their title width. An
 * unranked task shows nothing compact — calm lists stay calm.
 */
export function PriorityPill({
  bucket,
  urgency,
  importance,
  compact = false,
  className,
}: {
  bucket: PriorityBucket;
  urgency?: number;
  importance?: number;
  compact?: boolean;
  className?: string;
}) {
  if (compact && bucket === "unset") return null;

  const tone = bucketTone(bucket);
  const label = priorityPillLabel(bucket);
  const scores =
    urgency !== undefined && importance !== undefined
      ? `Urgency ${Math.round(urgency * 100)} · Importance ${Math.round(importance * 100)}`
      : null;

  return (
    <TooltipProvider delayDuration={250}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <span
            data-testid="priority-pill"
            data-bucket={bucket}
            aria-label={`Priority: ${label}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border text-[11px] font-medium leading-[18px]",
              compact ? "px-1.5 sm:pl-1.5 sm:pr-2" : "pl-1.5 pr-2",
              tone === "ember" && "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]",
              tone === "mist" && "border-transparent bg-[var(--ai-soft)] text-[var(--ai)]",
              tone === "sage" &&
                "border-transparent bg-[oklch(94%_0.02_160)] text-[var(--done)] dark:bg-[oklch(20%_0.02_160)]",
              tone === "neutral" &&
                "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg-muted)]",
              className,
            )}
          >
            <span
              aria-hidden
              className={cn(
                "block size-[6px] rounded-full",
                tone === "ember" && "bg-[var(--accent)]",
                tone === "mist" && "bg-[var(--ai)]",
                tone === "sage" && "bg-[var(--done)]",
                tone === "neutral" && "bg-[var(--fg-subtle)]",
              )}
            />
            <span className={cn(compact && "hidden sm:inline")}>{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-[40ch] px-2.5 py-2">
          <div className="font-medium">{label}</div>
          <p className="mt-0.5 font-normal leading-[1.45] opacity-85 whitespace-normal">
            {priorityPillHint(bucket)}
          </p>
          {scores ? <p className="mt-1 text-num opacity-70">{scores}</p> : null}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
