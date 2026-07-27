"use client";

import { PageShell } from "@/components/app-shell/page-shell";
import { useBoardMode } from "@/lib/store/view-mode";
import * as React from "react";

/**
 * PageShell that widens to full when Board mode is on — the board can't live
 * inside the 820px reading column.
 */
export function StatusPageShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { isBoard } = useBoardMode();
  return (
    <PageShell title={title} width={isBoard ? "full" : "default"}>
      {children}
    </PageShell>
  );
}
