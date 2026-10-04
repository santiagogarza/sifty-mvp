"use client";

import { STATUS_VIEWS } from "@/lib/domain/status";
import { useClientReady, useViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

const TASK_ROUTES = new Set<string>(["/today", ...STATUS_VIEWS.map((view) => view.href)]);

/**
 * Page wrapper: top bar + content container.
 *
 * The top-bar buttons read the global frame so they're identical on every
 * page without per-page wiring.
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
  const mode = useViewMode();
  const clientReady = useClientReady();
  // Board needs the full pane; list stays in the reading column. Settings
  // and Memory keep the column even if Board was chosen on a task route.
  const wide = clientReady && mode === "board" && TASK_ROUTES.has(pathname ?? "");
  return (
    <>
      <TopBar
        title={title}
        subtitle={subtitle}
        rightSlot={rightSlot}
        onCapture={() => openCapture()}
        onCommand={openCommand}
      />
      <div
        className={cn(
          "flex-1 w-full min-w-0 px-4 sm:px-6 md:px-8",
          wide ? "max-w-none" : "max-w-[820px] mx-auto",
        )}
      >
        {children}
      </div>
    </>
  );
}
