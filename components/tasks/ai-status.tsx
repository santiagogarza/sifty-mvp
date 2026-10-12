import { type AiStatus, SIFT_STAGES, SIFT_STAGE_LABELS, type SiftStage } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Sparkles } from "lucide-react";
import * as React from "react";

/**
 * Inline AI status indicator.
 *
 * Design rules:
 *  - "Pending" and "running" should be calm, never attention-grabbing.
 *    When the server reports which stage is running, the label follows it
 *    ("Enriching", "Prioritizing", …) so the row visibly advances.
 *  - "Failed" should be subtle but legible — don't shout.
 *  - "Ready" should disappear after a brief moment in the row, but stays
 *    visible in the detail sheet.
 */
export function AiStatusInline({
  status,
  stage,
  className,
}: {
  status: AiStatus;
  stage?: SiftStage | null;
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
        data-testid="ai-status"
      >
        <Sparkles size={11} />
        {status === "running" && stage ? SIFT_STAGE_LABELS[stage] : "Organizing"}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-[var(--warn)]", className)}
    >
      Couldn't organize
    </span>
  );
}

/**
 * A "thinking" line for the dialog/detail surface — slightly louder. With a
 * stage it becomes a five-step strip: done stages filled, the current one
 * pulsing, the rest hollow.
 */
export function AiThinking({ stage }: { stage?: SiftStage | null }) {
  const current = stage ? SIFT_STAGES.indexOf(stage) : -1;
  return (
    <span
      className="inline-flex items-center gap-2 text-[12px] text-[var(--ai)]"
      data-testid="sift-progress"
      aria-label={stage ? `${SIFT_STAGE_LABELS[stage]} (step ${current + 1} of 5)` : undefined}
    >
      <span className="inline-flex items-center gap-[3px]">
        {SIFT_STAGES.map((s, i) => (
          <span
            key={s}
            className={cn(
              "size-[6px] rounded-full",
              i < current && "bg-[var(--ai)]",
              i === current && "bg-[var(--ai)] animate-pulse-soft",
              i > current && "border border-[var(--ai)]/50",
              current < 0 && i === 0 && "bg-[var(--ai)] animate-pulse-soft",
            )}
          />
        ))}
      </span>
      {stage ? `${SIFT_STAGE_LABELS[stage]}…` : "Sifty is organizing this…"}
    </span>
  );
}
