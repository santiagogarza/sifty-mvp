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
 *
 * `width="wide"` is for the board view: five columns can't live inside the
 * reading-width container, and the flex column lets the board size its
 * per-column scroll areas.
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
  width?: "default" | "wide";
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
          width === "wide" ? "max-w-[1440px] flex flex-col min-h-0" : "max-w-[820px]",
        )}
      >
        {children}
      </div>
    </>
  );
}
