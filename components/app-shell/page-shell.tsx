"use client";

import { isBoardRoute, useViewMode } from "@/components/tasks/use-view-mode";
import { cn } from "@/lib/utils/cn";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

/**
 * Page wrapper: top bar + content container.
 *
 * The top-bar buttons read the global frame so they're identical on every
 * page without per-page wiring. The content column is reading-width for
 * lists and widens on task routes while the board is showing, so five
 * columns get the room they need without each page knowing about it.
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
  const [mode] = useViewMode();
  const wide = mode === "board" && isBoardRoute(pathname);
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
          "flex-1 px-4 sm:px-6 md:px-8 w-full mx-auto",
          wide ? "max-w-[1280px]" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
