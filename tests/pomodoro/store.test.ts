// @vitest-environment jsdom
import { BREAK_MS, FOCUS_MS, initialState } from "@/lib/pomodoro/machine";
import { usePomodoro } from "@/lib/pomodoro/store";
import { resetServerClock, serverNow, syncServerClock } from "@/lib/time/server-clock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 3_600_000;

beforeEach(() => {
  resetServerClock();
  usePomodoro.setState({ timer: initialState() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetServerClock();
});

async function pretendLocalClockIsAnHourBehind(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ now: Date.now() + HOUR, iso: "" })),
  );
  await syncServerClock();
}

describe("anchor timestamps", () => {
  it("are written in the server's clock domain, never the local one", async () => {
    // Regression: anchors written before the offset lands jump the moment it
    // is adopted, which can ring a block the instant it starts.
    await pretendLocalClockIsAnHourBehind();
    usePomodoro.getState().startFocus();

    const block = usePomodoro.getState().timer.block;
    expect(block).not.toBeNull();
    expect(block!.startedAt - Date.now()).toBeGreaterThan(HOUR - 5_000);
    expect(block!.endsAt - block!.startedAt).toBe(FOCUS_MS);
    // And the block reads as freshly started, not already elapsed.
    expect(block!.endsAt - serverNow()).toBeGreaterThan(FOCUS_MS - 5_000);
  });

  it("hold for breaks too", async () => {
    await pretendLocalClockIsAnHourBehind();
    usePomodoro.getState().startBreak();

    const rest = usePomodoro.getState().timer.rest;
    expect(rest!.startedAt - Date.now()).toBeGreaterThan(HOUR - 5_000);
    expect(rest!.endsAt - rest!.startedAt).toBe(BREAK_MS);
  });
});

describe("actions", () => {
  it("hands a focus block off to a break and logs it", () => {
    usePomodoro.getState().startFocus();
    usePomodoro.getState().startBreak();

    const { timer } = usePomodoro.getState();
    expect(timer.block).toBeNull();
    expect(timer.rest).not.toBeNull();
    // Nothing was closed in a block that lasted no time, so nothing is logged.
    expect(timer.history).toHaveLength(0);
  });

  it("clears history without touching the running block", () => {
    usePomodoro.getState().startFocus();
    usePomodoro.setState((s) => ({
      timer: { ...s.timer, history: [{ ...s.timer.block!, closedAt: Date.now() }] },
    }));

    usePomodoro.getState().clearHistory();
    expect(usePomodoro.getState().timer.history).toHaveLength(0);
    expect(usePomodoro.getState().timer.block).not.toBeNull();
  });
});
