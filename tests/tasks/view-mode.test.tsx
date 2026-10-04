// @vitest-environment jsdom
import {
  BOARD_ROUTES,
  VIEW_MODE_KEY,
  isBoardRoute,
  parseViewMode,
  setViewMode,
  useViewMode,
} from "@/components/tasks/use-view-mode";
import { STATUS_VIEWS } from "@/lib/domain/status";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
});

describe("parseViewMode", () => {
  it("is List for anything that is not exactly board", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode(undefined)).toBe("list");
    expect(parseViewMode("")).toBe("list");
    expect(parseViewMode("{not json")).toBe("list");
    expect(parseViewMode('{"/inbox":"board"}')).toBe("list");
    expect(parseViewMode("kanban")).toBe("list");
    expect(parseViewMode("list")).toBe("list");
    expect(parseViewMode("board")).toBe("board");
  });
});

function Mode({ name }: { name: string }) {
  const [mode] = useViewMode();
  return <output data-testid={name}>{mode}</output>;
}

describe("useViewMode", () => {
  it("defaults to List with no stored value and reads a stored board", () => {
    render(<Mode name="a" />);
    expect(screen.getByTestId("a")).toHaveTextContent("list");
    cleanup();

    window.localStorage.setItem(VIEW_MODE_KEY, "board");
    render(<Mode name="b" />);
    expect(screen.getByTestId("b")).toHaveTextContent("board");
  });

  it("is one global value: two subscribers both flip after one write", () => {
    render(
      <>
        <Mode name="task-view" />
        <Mode name="dropped-section" />
      </>,
    );
    act(() => setViewMode("board"));
    expect(screen.getByTestId("task-view")).toHaveTextContent("board");
    expect(screen.getByTestId("dropped-section")).toHaveTextContent("board");
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("board");

    act(() => setViewMode("list"));
    expect(screen.getByTestId("task-view")).toHaveTextContent("list");
    expect(screen.getByTestId("dropped-section")).toHaveTextContent("list");
  });
});

describe("isBoardRoute", () => {
  it("is Today plus every status view, and nothing else", () => {
    expect(BOARD_ROUTES).toEqual(["/today", ...STATUS_VIEWS.map((v) => v.href)]);
    for (const route of BOARD_ROUTES) expect(isBoardRoute(route)).toBe(true);
    expect(isBoardRoute("/memory")).toBe(false);
    expect(isBoardRoute("/settings")).toBe(false);
    expect(isBoardRoute(null)).toBe(false);
  });
});
