"use client";

import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Sparkles, TriangleAlert } from "lucide-react";
import * as React from "react";

/** Below this, Sifty's own read of a task is flagged for a human look. */
export const LOW_CONFIDENCE = 0.6;

export type ConfidenceBand = "low" | "ok";

/**
 * Which band a sifted task falls in, or null when there is nothing to show:
 * not sifted yet, sifting failed, or an older row without a confidence.
 */
export function confidenceBand(task: Pick<Task, "aiStatus" | "confidence">): ConfidenceBand | null {
  if (task.aiStatus !== "ready") return null;
  const c = task.confidence;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return c < LOW_CONFIDENCE ? "low" : "ok";
}

export function confidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/**
 * "Why did Sifty file it this way?" — surfaces the model's confidence and
 * one-paragraph rationale where the triage result is read, so the user can
 * trust it (or not) without opening the rationale disclosure.
 *
 * `compact` is the list/board form: it renders only for low confidence, so
 * calm lists stay calm and the amber mark means "worth a look".
 */
export function ConfidencePill({
  task,
  compact = false,
  className,
}: {
  task: Pick<Task, "aiStatus" | "confidence" | "rationale">;
  compact?: boolean;
  className?: string;
}) {
  const band = confidenceBand(task);
  if (!band) return null;
  if (compact && band !== "low") return null;

  const pct = confidencePercent(task.confidence);
  const low = band === "low";
  const label = compact ? "Unsure" : `Sifted · ${pct}%`;

  return (
    <TooltipProvider delayDuration={250}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="confidence-pill"
            data-band={band}
            aria-label={`Sifty confidence ${pct}%${low ? ", low" : ""}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-[18px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
              // Amber (the "Sifty asks" hue), not the rose used for overdue:
              // this is a nudge to look, not a problem.
              low
                ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]/60 text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                : "border-transparent text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-muted)]",
              className,
            )}
          >
            {low ? (
              <TriangleAlert size={10} />
            ) : (
              <Sparkles size={10} className="text-[var(--ai)]" />
            )}
            <span className="text-num">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-[48ch] px-2.5 py-2">
          <div className="flex items-center gap-1.5 font-medium">
            {low ? <TriangleAlert size={11} className="shrink-0" /> : null}
            <span>Confidence: {pct}%</span>
          </div>
          {task.rationale ? (
            <p className="mt-1 font-normal leading-[1.45] opacity-85 whitespace-normal">
              {task.rationale}
            </p>
          ) : null}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
