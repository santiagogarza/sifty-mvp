import {
  getViewMode,
  parseViewMode,
  resetViewModeForTests,
  subscribeViewMode,
  writeViewMode,
} from "@/lib/ui/view-mode";
import { afterEach, describe, expect, it } from "vitest";

describe("parseViewMode", () => {
  it("treats a missing key, bad JSON, and unknown values as List", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode(undefined)).toBe("list");
    expect(parseViewMode("")).toBe("list");
    expect(parseViewMode("{")).toBe("list");
    expect(parseViewMode("kanban")).toBe("list");
    expect(parseViewMode('{"/inbox":"board"}')).toBe("list");
    expect(parseViewMode("board")).toBe("board");
    expect(parseViewMode('"list"')).toBe("list");
  });
});

describe("view mode store", () => {
  afterEach(() => {
    resetViewModeForTests();
  });

  it("updates every subscriber from one write", () => {
    const seen: string[][] = [[], []];
    const unsubA = subscribeViewMode(() => {
      const next = getViewMode();
      const bucket = seen[0];
      if (bucket) bucket.push(next);
    });
    const unsubB = subscribeViewMode(() => {
      const next = getViewMode();
      const bucket = seen[1];
      if (bucket) bucket.push(next);
    });

    writeViewMode("board");

    expect(seen[0]).toEqual(["board"]);
    expect(seen[1]).toEqual(["board"]);
    expect(getViewMode()).toBe("board");
    unsubA();
    unsubB();
  });
});
