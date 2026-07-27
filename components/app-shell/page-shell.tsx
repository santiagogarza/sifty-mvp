"use client";

import { cn } from "@/lib/utils/cn";
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
  /**
   * "prose" keeps the reading measure every list view uses. "wide" gives
   * the page the full frame and turns the container into a column, which
   * is what lets the board stretch its five columns to equal height.
   */
  width = "prose",
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  width?: "prose" | "wide";
  children: React.ReactNode;
}) {
  const { openCapture, openCommand } = useFrame();
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
          "px-4 sm:px-6 md:px-8 w-full mx-auto",
          width === "prose"
            ? "flex-1 max-w-[820px]"
            : // A board that scrolls the page instead of its columns loses
              // its headers, so the wide container takes exactly what is
              // left of the viewport under the 56px top bar (and, on
              // phones, above the 80px bottom nav) and hands the overflow
              // to the columns.
              "max-w-[1600px] flex flex-col min-h-0 h-[calc(100dvh-136px)] md:h-[calc(100dvh-56px)]",
        )}
      >
        {children}
      </div>
    </>
  );
}
