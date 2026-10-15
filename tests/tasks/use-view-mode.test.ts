// @vitest-environment jsdom
import {
  VIEW_MODE_KEY,
  parseViewMode,
  readViewMode,
  setViewMode,
  subscribeViewMode,
} from "@/components/tasks/use-view-mode";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("view mode preference", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("falls back to list for a missing key, bad JSON, or an unknown value", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode("{not json")).toBe("list");
    expect(parseViewMode(JSON.stringify("kanban"))).toBe("list");
    expect(parseViewMode(JSON.stringify({ mode: "board" }))).toBe("list");
    expect(parseViewMode(JSON.stringify("board"))).toBe("board");
  });

  it("reads list when nothing is stored, and board after it is chosen", () => {
    expect(readViewMode()).toBe("list");
    setViewMode("board");
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe('"board"');
    expect(readViewMode()).toBe("board");
  });

  it("keeps the preference out of the synced store blob", () => {
    setViewMode("board");
    expect(window.localStorage.getItem("sifty-store-v1") ?? "").not.toContain("board");
  });

  it("notifies every subscriber after one write", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeViewMode(a);
    const offB = subscribeViewMode(b);
    setViewMode("board");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
    setViewMode("list");
    expect(a).toHaveBeenCalledTimes(1);
  });
});
