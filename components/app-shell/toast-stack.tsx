"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * The one bottom-center slot for transient status.
 *
 * The sync-error pill and the board's undo pill are both "a quiet thing
 * happened" messages that live at the bottom of the screen. Two
 * independent `fixed` elements would sit on top of each other the moment
 * both are true, so the frame owns a single stack and everything else
 * portals into it.
 */

const ToastStackContext = React.createContext<HTMLElement | null>(null);

export function ToastStackProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  return (
    <ToastStackContext.Provider value={node}>
      {children}
      <div
        ref={setNode}
        // High enough on desktop to clear the board's keyboard hint bar,
        // which sits on the last line of the page.
        className="fixed bottom-[92px] md:bottom-14 left-1/2 -translate-x-1/2 z-40
        flex flex-col items-center gap-2 pointer-events-none"
      />
    </ToastStackContext.Provider>
  );
}

/**
 * Renders into the shared stack. Falls back to rendering in place when
 * there is no stack — a board mounted outside the app frame (tests) still
 * shows its pill.
 */
export function Toast({ children }: { children: React.ReactNode }) {
  const stack = useToastStack();
  const content = <div className="pointer-events-auto">{children}</div>;
  if (!stack) return content;
  return createPortal(content, stack);
}

export function useToastStack(): HTMLElement | null {
  return React.useContext(ToastStackContext);
}
