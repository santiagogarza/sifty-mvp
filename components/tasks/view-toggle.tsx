"use client";

import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { Columns3, LayoutList } from "lucide-react";
import Link from "next/link";
import * as React from "react";

/**
 * Subtle switcher between the two working surfaces, rendered beside the
 * page title on each: Today (the day's list) and Board (the whole
 * pipeline). The segments are named by surface, not by presentation —
 * Today is a filtered lens while Board shows everything, so "list/board"
 * would wrongly promise the same items in two layouts. Links rather than
 * buttons — the views are routes, so middle-click, cmd+click, and the
 * back button all stay honest.
 */
export function ViewToggle({ active }: { active: "today" | "board" }) {
  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="View"
        className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)]/60 p-0.5"
      >
        <Segment
          href="/today"
          label="Today"
          active={active === "today"}
          icon={<LayoutList size={13} />}
        />
        <Segment
          href="/board"
          label="Board"
          active={active === "board"}
          icon={<Columns3 size={13} />}
        />
      </div>
    </TooltipProvider>
  );
}

function Segment({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Link
        href={href}
        aria-label={`${label} view`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-6 w-7 items-center justify-center rounded-[calc(var(--radius-md)-2px)]",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          active
            ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.06)] border border-[var(--border)]"
            : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
        )}
      >
        {icon}
      </Link>
    </Tooltip>
  );
}
