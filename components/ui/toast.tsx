"use client";

import * as React from "react";
import { create } from "zustand";

const TOAST_MS = 6000;

interface ToastData {
  id: number;
  message: string;
  onUndo?: () => void;
}

interface ToastState {
  toast: ToastData | null;
  show: (toast: Omit<ToastData, "id">) => void;
  dismiss: () => void;
}

let seq = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toast: null,
  show: (toast) => {
    seq += 1;
    set({ toast: { ...toast, id: seq } });
  },
  dismiss: () => set({ toast: null }),
}));

export function showToast(toast: Omit<ToastData, "id">): void {
  useToastStore.getState().show(toast);
}

/** Single-slot toast; a new toast replaces the current one and restarts the timer. */
export function Toaster() {
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className="animate-rise flex items-center whitespace-nowrap gap-3 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur pl-3.5 pr-1.5 py-1 text-[12px] text-[var(--fg-muted)] shadow-sm"
    >
      <span>{toast.message}</span>
      {toast.onUndo ? (
        <button
          type="button"
          onClick={() => {
            toast.onUndo?.();
            dismiss();
          }}
          className="rounded-full px-2.5 py-1 text-[12px] font-medium text-[var(--fg)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}
