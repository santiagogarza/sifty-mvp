"use client";

import { cn } from "@/lib/utils/cn";
import { id as makeId } from "@/lib/utils/ids";
import { X } from "lucide-react";
import * as React from "react";
import { create } from "zustand";

/**
 * Toasts — one calm line of feedback with an optional single action.
 *
 * Used for quick, reversible changes made away from the detail sheet (a
 * keyboard snooze, a bulk move) so the result is visible and undoable
 * without hunting for the task. Deliberately not a notification center:
 * at most a few at once, each gone in seconds.
 */

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: ToastItem) => void;
  dismiss: (id: string) => void;
}

const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 6000;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (toast) => set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_VISIBLE) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function toast(
  message: string,
  opts: { action?: ToastAction; durationMs?: number } = {},
): string {
  const item: ToastItem = { id: makeId("toast"), message, action: opts.action };
  useToastStore.getState().push(item);
  timers.set(
    item.id,
    setTimeout(() => {
      timers.delete(item.id);
      useToastStore.getState().dismiss(item.id);
    }, opts.durationMs ?? DEFAULT_DURATION_MS),
  );
  return item.id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  useToastStore.getState().dismiss(id);
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed z-40 flex flex-col items-center gap-2",
        // Clear of the bottom nav and of the sync notice's slot (it sits
        // 92px up and may wrap to two lines), so Undo is never painted over.
        "bottom-[172px] left-1/2 -translate-x-1/2",
        "md:bottom-4 md:left-auto md:right-4 md:translate-x-0 md:items-end",
      )}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          className={cn(
            "pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--border)]",
            "bg-[var(--bg-elevated)]/95 backdrop-blur pl-4 pr-1.5 py-1.5 shadow-sm",
            "text-[12.5px] text-[var(--fg)] animate-fade-in",
          )}
        >
          <span>{t.message}</span>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
              className="rounded-full px-2.5 py-1 text-[12.5px] font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="rounded-full p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
