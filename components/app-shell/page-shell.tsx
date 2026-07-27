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
          "flex-1 px-4 sm:px-6 md:px-8 w-full mx-auto",
          width === "prose"
            ? "max-w-[820px]"
            : "max-w-[1600px] min-h-0 flex flex-col md:px-6 lg:px-8",
        )}
      >
        {children}
      </div>
    </>
  );
}
