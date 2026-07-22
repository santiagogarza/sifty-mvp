import { Badge } from "@/components/ui/badge";
import type { ID, ISODate, Label } from "@/lib/domain/types";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import * as React from "react";

/**
 * Task meta chips shared by the list row and the board card, so due-date
 * semantics and the label cap can never drift between the two surfaces.
 */

/** Resolve labelIds against a label map, dropping ids that no longer exist. */
export function resolveTaskLabels(labelIds: ID[], labelMap: Map<ID, Label>): Label[] {
  return labelIds.flatMap((id) => {
    const label = labelMap.get(id);
    return label ? [label] : [];
  });
}

/** Due chip: overdue reads rose, due-today leans ember, later stays quiet. */
export function DueBadge({ due }: { due: ISODate | null }) {
  const label = formatRelativeDay(due);
  if (!label) return null;
  const tone: "rose" | "ember" | "neutral" = isOverdue(due)
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";
  return (
    <Badge tone={tone} variant={tone === "neutral" ? "outline" : "soft"}>
      {label}
    </Badge>
  );
}

/** The first `max` labels as badges, then a "+N" overflow count. */
export function TaskLabelBadges({ labels, max = 2 }: { labels: Label[]; max?: number }) {
  if (labels.length === 0) return null;
  return (
    <>
      {labels.slice(0, max).map((label) => (
        <Badge key={label.id} tone={label.tone}>
          {label.name}
        </Badge>
      ))}
      {labels.length > max ? (
        <span className="text-[11px] text-[var(--fg-subtle)]">+{labels.length - max}</span>
      ) : null}
    </>
  );
}
