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
  width = "default",
  children,
}: {
  title?: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
  width?: "default" | "wide" | "full";
  children: React.ReactNode;
}) {
  const { openCapture, openCommand } = useFrame();
  const widthClass =
    width === "full" ? "max-w-none" : width === "wide" ? "max-w-[1400px]" : "max-w-[820px]";
  return (
    <>
      <TopBar
        title={title}
        subtitle={subtitle}
        rightSlot={rightSlot}
        onCapture={openCapture}
        onCommand={openCommand}
      />
      <div className={`flex-1 px-4 sm:px-6 md:px-8 ${widthClass} w-full mx-auto`}>{children}</div>
    </>
  );
}
