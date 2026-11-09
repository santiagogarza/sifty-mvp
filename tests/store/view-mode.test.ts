// @vitest-environment jsdom
import { VIEW_MODE_KEY, parseViewMode, setViewMode, useViewMode } from "@/lib/store/view-mode";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

describe("view mode preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("only ever reads back list or board, defaulting to list", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode("board")).toBe("board");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode('"board"')).toBe("list");
    expect(parseViewMode("kanban")).toBe("list");
  });

  it("persists the choice and updates every subscriber", () => {
    const a = renderHook(() => useViewMode());
    const b = renderHook(() => useViewMode());
    expect(a.result.current[0]).toBe("list");

    act(() => setViewMode("board"));
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("board");
    expect(a.result.current[0]).toBe("board");
    expect(b.result.current[0]).toBe("board");

    act(() => a.result.current[1]("list"));
    expect(b.result.current[0]).toBe("list");
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useViewMode());
    act(() => {
      window.localStorage.setItem(VIEW_MODE_KEY, "board");
      window.dispatchEvent(new StorageEvent("storage", { key: VIEW_MODE_KEY }));
    });
    expect(result.current[0]).toBe("board");
  });
});
