"use client";

import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { useFrame } from "./app-frame";
import { TopBar } from "./top-bar";

/**
 * Page wrapper: top bar + content container.
 *
 * The top-bar buttons read the global frame so they're identical on every
 * page without per-page wiring. `width="full"` drops the reading-column
 * constraint so the board can use the viewport.
 */
export function PageShell({
  title,
  subtitle,
  rightSlot,
  width = "default",
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  width?: "default" | "full";
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
          width === "default" ? "max-w-[820px]" : "max-w-none",
        )}
      >
        {children}
      </div>
    </>
  );
}
