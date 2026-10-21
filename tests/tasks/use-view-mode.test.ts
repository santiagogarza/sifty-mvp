// @vitest-environment jsdom
import {
  VIEW_MODE_KEY,
  parseViewMode,
  readViewMode,
  setViewMode,
  subscribeViewMode,
} from "@/components/tasks/use-view-mode";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.clear();
});

describe("parseViewMode", () => {
  it("falls back to List for a missing key, bad JSON, or an unknown value", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode("{not json")).toBe("list");
    expect(parseViewMode(JSON.stringify("kanban"))).toBe("list");
    expect(parseViewMode(JSON.stringify(1))).toBe("list");
    expect(parseViewMode(JSON.stringify("board"))).toBe("board");
    expect(parseViewMode(JSON.stringify("list"))).toBe("list");
  });
});

describe("view mode store", () => {
  it("reads the stored value and defaults to List", () => {
    expect(readViewMode()).toBe("list");
    localStorage.setItem(VIEW_MODE_KEY, "garbage");
    expect(readViewMode()).toBe("list");
    localStorage.setItem(VIEW_MODE_KEY, JSON.stringify("board"));
    expect(readViewMode()).toBe("board");
  });

  it("one write notifies every subscriber and persists", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeViewMode(a);
    const offB = subscribeViewMode(b);
    setViewMode("board");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(readViewMode()).toBe("board");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe(JSON.stringify("board"));
    offA();
    offB();
    setViewMode("list");
    expect(a).toHaveBeenCalledTimes(1);
  });
});
