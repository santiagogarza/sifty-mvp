"use client";

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
  fluid = false,
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  /**
   * Drop the reading-width column and let content own the full width and
   * height. Used by the board, which needs to span the viewport and manage
   * its own vertical scroll.
   */
  fluid?: boolean;
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
        className={
          fluid
            ? "flex flex-1 min-h-0 flex-col px-4 sm:px-6 md:px-8 w-full"
            : "flex-1 px-4 sm:px-6 md:px-8 max-w-[820px] w-full mx-auto"
        }
      >
        {children}
      </div>
    </>
  );
}
