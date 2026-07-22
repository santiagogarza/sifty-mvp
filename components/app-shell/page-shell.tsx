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
  width = "reading",
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  /** "reading" is the prose column; "full" lets wide surfaces (the board) breathe. */
  width?: "reading" | "full";
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
          "flex-1 w-full mx-auto px-4 sm:px-6 md:px-8",
          width === "reading" && "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
