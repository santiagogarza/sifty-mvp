"use client";

import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

/**
 * Page wrapper: top bar + content container.
 *
 * The top-bar buttons read the global frame so they're identical on every
 * page without per-page wiring. `wide` relaxes the reading-width column
 * for surfaces that are horizontal by nature (the Board).
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
          wide ? "max-w-[1600px]" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
