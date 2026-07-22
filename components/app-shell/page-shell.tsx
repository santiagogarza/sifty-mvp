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
  wide,
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  /**
   * Widen the content column for surfaces that need the whole canvas — the
   * board's five columns don't fit the reading-width default. List surfaces
   * keep the narrow 820px measure for calm, scannable rows.
   */
  wide?: boolean;
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
          wide ? "max-w-[1400px]" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
