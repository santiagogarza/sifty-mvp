"use client";

import { isTaskRoute } from "@/lib/ui/board";
import { useViewMode } from "@/lib/ui/view-mode";
import { cn } from "@/lib/utils/cn";
import { usePathname } from "next/navigation";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

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
  // Five columns don't fit the list's reading measure. Only task routes
  // widen, so Memory and Settings stay put when Board is the saved layout.
  const wide = useViewMode() === "board" && isTaskRoute(pathname);
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
          "w-full flex-1 px-4 sm:px-6 md:px-8",
          wide ? "max-w-none" : "mx-auto max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
