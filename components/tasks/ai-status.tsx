import type { AiStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Sparkles } from "lucide-react";
import * as React from "react";

/**
 * Inline AI status indicator.
 *
 * Design rules:
 *  - "Pending" and "running" should be calm, never attention-grabbing.
 *  - "Failed" should be subtle but legible — don't shout.
 *  - "Ready" should disappear after a brief moment in the row, but stays
 *    visible in the detail sheet.
 */
export function AiStatusInline({
  status,
  className,
}: {
  status: AiStatus;
  className?: string;
}) {
  if (status === "ready" || status === "idle") return null;
  if (status === "pending" || status === "running") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11.5px] text-[var(--ai)]",
          "animate-pulse-soft",
          className,
        )}
      >
        <Sparkles size={11} />
        Triaging
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-[var(--warn)]", className)}
    >
      Triage failed
    </span>
  );
}

/**
 * A "thinking" line for the dialog/detail surface — slightly louder.
 */
export function AiThinking() {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-[var(--ai)]">
      <span className="relative inline-flex">
        <span className="size-[6px] rounded-full bg-[var(--ai)] animate-pulse-soft" />
      </span>
      Sifty is organizing this…
    </span>
  );
}
