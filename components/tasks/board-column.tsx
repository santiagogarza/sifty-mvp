"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { STATUS_ICONS } from "./status-icon";

export function BoardColumn({
  id,
  title,
  count,
  children,
}: {
  id: Lifecycle;
  title?: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  const Icon = STATUS_ICONS[id];
  const label = title ?? statusLabel(id);

  return (
    <div className="flex flex-col w-[320px] shrink-0 max-h-full">
      <div className="flex items-center gap-2 px-1 py-3 shrink-0">
        <Icon size={16} className="text-[var(--fg-muted)]" />
        <span className="text-[13px] font-medium text-[var(--fg)]">{label}</span>
        <span className="text-[12px] text-[var(--fg-subtle)] ml-1">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-2 pb-4 px-1 rounded-lg transition-colors",
          isOver && "bg-[var(--surface-muted)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
