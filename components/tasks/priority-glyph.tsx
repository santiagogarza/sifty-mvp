import { bucketLabel } from "@/lib/domain/priority";
import type { PriorityBucket } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

/**
 * A small 2x2 dot grid that visualizes the (urgency, importance) position
 * without drawing a literal Eisenhower matrix on the row.
 *
 * Quadrant convention:
 *   ┌───┬───┐    importance →
 *   │ 2 │ 1 │
 *   ├───┼───┤
 *   │ 4 │ 3 │
 *   └───┴───┘    urgency ↓
 *
 *   1 = do_now, 2 = schedule, 3 = delegate, 4 = drop
 */

export function PriorityGlyph({
  bucket,
  className,
  size = 12,
}: {
  bucket: PriorityBucket;
  className?: string;
  size?: number;
}) {
  const dot = (active: boolean, tone: "ember" | "mist" | "sage" | "neutral") => {
    if (!active) {
      return <span className="block size-[3px] rounded-full bg-[var(--border-strong)]" />;
    }
    const color =
      tone === "ember"
        ? "bg-[var(--accent)]"
        : tone === "mist"
          ? "bg-[var(--ai)]"
          : tone === "sage"
            ? "bg-[var(--done)]"
            : "bg-[var(--fg-muted)]";
    return <span className={cn("block size-[3px] rounded-full", color)} />;
  };

  const layout: Record<PriorityBucket, [boolean, boolean, boolean, boolean]> = {
    do_now: [false, true, false, false],
    schedule: [true, false, false, false],
    delegate: [false, false, true, false],
    drop: [false, false, false, true],
    unset: [false, false, false, false],
  };
  const tones: Record<PriorityBucket, "ember" | "mist" | "sage" | "neutral"> = {
    do_now: "ember",
    schedule: "mist",
    delegate: "sage",
    drop: "neutral",
    unset: "neutral",
  };

  const cells = layout[bucket];
  const tone = tones[bucket];

  return (
    <span
      title={bucketLabel(bucket)}
      aria-label={`Priority: ${bucketLabel(bucket)}`}
      className={cn(
        "inline-grid grid-cols-2 grid-rows-2 gap-[2px] p-[2px]",
        "rounded-[3px] border border-[var(--border)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {cells.map((on, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the 4 cells are positionally meaningful (do_now / schedule / delegate / drop), so the index is the stable key by design.
        <span key={i} className="flex items-center justify-center">
          {dot(on, tone)}
        </span>
      ))}
    </span>
  );
}
