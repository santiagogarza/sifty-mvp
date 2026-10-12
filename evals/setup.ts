import { afterAll, beforeAll, vi } from "vitest";
import { loadGoldenSet } from "./golden/schema";

// The golden set's relative dates ("by Friday", "before the 15th") are
// written against `captures.json#today`. Pin `Date` so the offline
// heuristic, which reads the real clock, and the prompts' `Today is …`
// line agree with the expectations on every run, forever. Only `Date` is
// faked: timers stay real so network calls behave.
const { today } = loadGoldenSet();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${today}T09:00:00.000Z`) });
});

afterAll(() => {
  vi.useRealTimers();
});
