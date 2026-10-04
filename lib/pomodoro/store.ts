"use client";

import { onCompletion } from "@/lib/store/completion-events";
import { serverNow } from "@/lib/time/server-clock";
import { id } from "@/lib/utils/ids";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type PomodoroState,
  initialState,
  recordCompletion,
  startBreak,
  startFocus,
  stop,
  togglePause,
  undoCompletion,
} from "./machine";

/**
 * The focus timer, persisted to this browser.
 *
 * Only the two anchor timestamps and the closed blocks are stored, so a
 * reload mid-pomodoro resumes exactly where the clock says it should be
 * rather than where a counter left off.
 */

interface PomodoroStore {
  timer: PomodoroState;
  soundEnabled: boolean;
  notifyEnabled: boolean;

  startFocus: () => void;
  startBreak: () => void;
  togglePause: () => void;
  stop: () => void;
  clearHistory: () => void;
  setSoundEnabled: (value: boolean) => void;
  setNotifyEnabled: (value: boolean) => void;
}

export const usePomodoro = create<PomodoroStore>()(
  persist(
    (set) => ({
      timer: initialState(),
      soundEnabled: true,
      notifyEnabled: false,

      startFocus: () => set((s) => ({ timer: startFocus(s.timer, serverNow(), id("pom")) })),
      startBreak: () => set((s) => ({ timer: startBreak(s.timer, serverNow(), id("rest")) })),
      togglePause: () => set((s) => ({ timer: togglePause(s.timer, serverNow()) })),
      stop: () => set((s) => ({ timer: stop(s.timer, serverNow()) })),
      clearHistory: () => set((s) => ({ timer: { ...s.timer, history: [] } })),
      setSoundEnabled: (value) => set({ soundEnabled: value }),
      setNotifyEnabled: (value) => set({ notifyEnabled: value }),
    }),
    {
      name: "sifty-pomodoro-v1",
      version: 1,
      partialize: (s) => ({
        timer: s.timer,
        soundEnabled: s.soundEnabled,
        notifyEnabled: s.notifyEnabled,
      }),
    },
  ),
);

/**
 * Counting happens here rather than in the UI so a task closed from the
 * command palette, a keyboard shortcut, or the detail sheet all count the
 * same. `recordCompletion` no-ops when no block is open.
 */
onCompletion((event) => {
  usePomodoro.setState((s) => ({
    timer: event.done
      ? recordCompletion(s.timer, {
          id: event.id,
          kind: event.kind,
          title: event.title,
          at: serverNow(),
        })
      : undoCompletion(s.timer, event.id),
  }));
});
