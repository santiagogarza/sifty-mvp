import type { Recurrence } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Repeat } from "lucide-react";
import * as React from "react";
import { useRecurrenceCopy } from "./task-copy";

/** Quiet "this one comes back" mark for list rows and board cards. */
export function RepeatGlyph({
  rule,
  className,
  size = 12,
}: {
  rule: Recurrence;
  className?: string;
  size?: number;
}) {
  const title = useRecurrenceCopy().title(rule);
  return (
    <span
      data-testid="repeat-glyph"
      role="img"
      aria-label={title}
      title={title}
      className={cn("inline-flex shrink-0 items-center text-[var(--fg-subtle)]", className)}
    >
      <Repeat size={size} />
    </span>
  );
}
