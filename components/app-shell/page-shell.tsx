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
  wide = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  /** Use the full width instead of the reading column (the board). */
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
      <div className={cn("flex-1 px-4 sm:px-6 md:px-8 w-full mx-auto", !wide && "max-w-[820px]")}>
        {children}
      </div>
    </>
  );
}
