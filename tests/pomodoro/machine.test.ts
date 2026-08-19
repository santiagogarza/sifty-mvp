import {
  BREAK_MS,
  FOCUS_MS,
  type PomodoroState,
  elapsedFraction,
  focusedMs,
  formatCountdown,
  initialState,
  isPaused,
  phase,
  recordCompletion,
  remainingMs,
  startBreak,
  startFocus,
  stop,
  togglePause,
  undoCompletion,
} from "@/lib/pomodoro/machine";
import { describe, expect, it } from "vitest";

/**
 * The timer's contract: state is two absolute timestamps, and everything the
 * UI shows is derived from `now`. That is what makes a throttled tab, a
 * sleeping laptop, or a reload harmless — there is no counter to fall behind.
 */

const T0 = Date.UTC(2026, 6, 27, 9, 0, 0);

function min(n: number): number {
  return n * 60_000;
}

function focusing(now = T0): PomodoroState {
  return startFocus(initialState(), now, "pom_1");
}

describe("phases", () => {
  it("starts idle and runs a 25-minute focus block", () => {
    expect(phase(initialState(), T0)).toBe("idle");

    const state = focusing();
    expect(phase(state, T0)).toBe("focus");
    expect(remainingMs(state, T0)).toBe(FOCUS_MS);
    expect(phase(state, T0 + min(24))).toBe("focus");
    expect(remainingMs(state, T0 + min(24))).toBe(min(1));
  });

  it("waits in focus-done instead of auto-starting the break", () => {
    const state = focusing();
    expect(phase(state, T0 + FOCUS_MS)).toBe("focus-done");
    expect(remainingMs(state, T0 + FOCUS_MS)).toBe(0);
    // Still waiting an hour later — the break only starts when asked.
    expect(phase(state, T0 + min(85))).toBe("focus-done");
  });

  it("derives the same phase however long the process was asleep", () => {
    // A tick-counting timer would be two hours behind here.
    const state = focusing();
    expect(phase(state, T0 + min(120))).toBe("focus-done");
    expect(remainingMs(state, T0 + min(120))).toBe(0);
    expect(elapsedFraction(state, T0 + min(120))).toBe(1);
  });

  it("runs a 5-minute break and then waits in break-done", () => {
    const state = startBreak(focusing(), T0 + FOCUS_MS, "rest_1");
    expect(phase(state, T0 + FOCUS_MS)).toBe("break");
    expect(remainingMs(state, T0 + FOCUS_MS)).toBe(BREAK_MS);
    expect(phase(state, T0 + FOCUS_MS + BREAK_MS)).toBe("break-done");
  });

  it("reports progress as a fraction of whichever interval is running", () => {
    expect(elapsedFraction(focusing(), T0 + min(5))).toBeCloseTo(0.2, 5);
    const resting = startBreak(initialState(), T0, "rest_1");
    expect(elapsedFraction(resting, T0 + min(1))).toBeCloseTo(0.2, 5);
  });
});

describe("pause", () => {
  it("freezes the countdown and pushes the end out by the paused time", () => {
    let state = togglePause(focusing(), T0 + min(5));
    expect(isPaused(state)).toBe(true);
    expect(remainingMs(state, T0 + min(20))).toBe(min(20));
    // A paused block never rings, however long it sits.
    expect(phase(state, T0 + min(120))).toBe("focus");

    state = togglePause(state, T0 + min(65));
    expect(isPaused(state)).toBe(false);
    expect(remainingMs(state, T0 + min(65))).toBe(min(20));
    expect(phase(state, T0 + min(85))).toBe("focus-done");
  });

  it("is a no-op once the interval has already rung", () => {
    const rung = focusing();
    expect(togglePause(rung, T0 + FOCUS_MS)).toBe(rung);
    expect(togglePause(initialState(), T0)).toEqual(initialState());
  });
});

describe("completions", () => {
  const item = { id: "task_1", kind: "task" as const, title: "Ship it", at: T0 + min(3) };

  it("credits the open block, once per thing", () => {
    let state = recordCompletion(focusing(), item);
    state = recordCompletion(state, { ...item, title: "Ship it (again)" });
    expect(state.block?.completions).toHaveLength(1);
    expect(state.block?.completions[0]?.title).toBe("Ship it");
  });

  it("retracts credit when something is un-checked", () => {
    const state = undoCompletion(recordCompletion(focusing(), item), "task_1");
    expect(state.block?.completions).toHaveLength(0);
  });

  it("ignores completions while idle or on a break", () => {
    expect(recordCompletion(initialState(), item)).toEqual(initialState());
    const resting = startBreak(initialState(), T0, "rest_1");
    expect(recordCompletion(resting, item)).toBe(resting);
  });

  it("freezes the count when the block closes", () => {
    const state = startBreak(recordCompletion(focusing(), item), T0 + FOCUS_MS, "rest_1");
    expect(state.history[0]?.completions).toHaveLength(1);
    expect(recordCompletion(state, { ...item, id: "task_2" }).history[0]?.completions).toHaveLength(
      1,
    );
  });
});

describe("history", () => {
  const item = { id: "task_1", kind: "task" as const, title: "Ship it", at: T0 };

  it("logs a block when the break starts and when the timer is stopped", () => {
    expect(startBreak(focusing(), T0 + FOCUS_MS, "rest_1").history).toHaveLength(1);
    expect(stop(focusing(), T0 + FOCUS_MS).history).toHaveLength(1);
    expect(stop(focusing(), T0 + FOCUS_MS).block).toBeNull();
  });

  it("drops a block that was a misclick, but keeps a short productive one", () => {
    expect(stop(focusing(), T0 + 5_000).history).toHaveLength(0);
    expect(stop(recordCompletion(focusing(), item), T0 + 5_000).history).toHaveLength(1);
  });

  it("records focused time, excluding pauses and capping at one pomodoro", () => {
    const short = stop(focusing(), T0 + min(9)).history[0];
    expect(focusedMs(short!)).toBe(min(9));

    let paused = togglePause(focusing(), T0 + min(5));
    paused = togglePause(paused, T0 + min(35));
    expect(focusedMs(stop(paused, T0 + min(40)).history[0]!)).toBe(min(10));

    // Working past the bell doesn't earn a longer block.
    expect(focusedMs(stop(focusing(), T0 + min(90)).history[0]!)).toBe(FOCUS_MS);
  });

  it("keeps the newest blocks first and stays bounded", () => {
    let state = initialState();
    for (let i = 0; i < 65; i += 1) {
      state = startFocus(state, T0 + min(i * 30), `pom_${i}`);
      state = stop(state, T0 + min(i * 30) + FOCUS_MS);
    }
    expect(state.history).toHaveLength(60);
    expect(state.history[0]?.id).toBe("pom_64");
  });

  it("discards an unfinished break rather than logging it", () => {
    const resting = startBreak(initialState(), T0, "rest_1");
    expect(stop(resting, T0 + min(2)).history).toHaveLength(0);
  });
});

describe("formatCountdown", () => {
  it("zero-pads to a stable width and never goes negative", () => {
    expect(formatCountdown(FOCUS_MS)).toBe("25:00");
    expect(formatCountdown(BREAK_MS)).toBe("05:00");
    expect(formatCountdown(7_400)).toBe("00:08");
    expect(formatCountdown(-1)).toBe("00:00");
  });
});
