import {
  getServerViewMode,
  getViewMode,
  parseViewMode,
  resetViewModeForTests,
  setViewMode,
  subscribeViewMode,
} from "@/lib/store/view-mode";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  resetViewModeForTests();
});

describe("parseViewMode", () => {
  it("treats missing, garbage, and unknown values as list", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode(undefined)).toBe("list");
    expect(parseViewMode("nope")).toBe("list");
    expect(parseViewMode('{"/inbox":"board"}')).toBe("list");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("board")).toBe("board");
  });
});

describe("view mode store", () => {
  it("updates every subscriber from one write and keeps the server snapshot on list", () => {
    let first = 0;
    let second = 0;
    const unsubFirst = subscribeViewMode(() => {
      first += 1;
    });
    const unsubSecond = subscribeViewMode(() => {
      second += 1;
    });

    setViewMode("board");

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(getViewMode()).toBe("board");
    expect(getServerViewMode()).toBe("list");

    unsubFirst();
    unsubSecond();
  });
});
