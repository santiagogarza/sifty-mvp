"use client";

import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

const TASK_ROUTES = ["/today", "/focus", "/inbox", "/waiting", "/someday"];

/**
 * Page wrapper: top bar + content container.
 *
 * The top-bar buttons read the global frame so they're identical on every
 * page without per-page wiring. Task routes widen in board mode so the
 * kanban columns can breathe.
 */
export function PageShell({
  title,
  subtitle,
  rightSlot,
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { openCapture, openCommand } = useFrame();
  const pathname = usePathname();
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.tasksViewMode);
  const isTaskRoute = TASK_ROUTES.some((route) => pathname?.startsWith(route));
  const wide = hydrated && isTaskRoute && viewMode === "board";

  return (
    <>
      <TopBar
        title={title}
        subtitle={subtitle}
        rightSlot={rightSlot}
        onCapture={openCapture}
        onCommand={openCommand}
      />
      <div
        className={cn(
          "flex-1 w-full mx-auto px-4 sm:px-6 md:px-8",
          wide ? "max-w-none" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
