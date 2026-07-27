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
/**
 * Content width. Lists read best in a single measured column (`default`); the
 * Board needs the whole viewport for its five columns (`full`).
 */
type ContentWidth = "default" | "full";

const WIDTH_CLASS: Record<ContentWidth, string> = {
  default: "max-w-[820px]",
  full: "max-w-none",
};

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
  width?: ContentWidth;
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
      <div className={`flex-1 px-4 sm:px-6 md:px-8 w-full mx-auto ${WIDTH_CLASS[width]}`}>
        {children}
      </div>
    </>
  );
}
