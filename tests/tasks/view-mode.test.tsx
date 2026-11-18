// @vitest-environment jsdom

import {
  VIEW_MODE_KEY,
  parseViewMode,
  setViewMode,
  useViewMode,
} from "@/components/tasks/use-view-mode";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

function Probe({ name }: { name: string }) {
  const mode = useViewMode();
  return <div data-testid={name}>{mode}</div>;
}

describe("parseViewMode", () => {
  it("treats a missing key, bad JSON, and unknown values as List", () => {
    expect(parseViewMode(null)).toBe("list");
    expect(parseViewMode("")).toBe("list");
    expect(parseViewMode('{"/inbox":"board"}')).toBe("list");
    expect(parseViewMode("grid")).toBe("list");
    expect(parseViewMode("board")).toBe("board");
    expect(parseViewMode("list")).toBe("list");
  });
});

describe("useViewMode", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewMode("list");
  });

  it("updates every subscriber from one write", () => {
    render(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("list");
    expect(screen.getByTestId("b")).toHaveTextContent("list");

    act(() => setViewMode("board"));

    expect(screen.getByTestId("a")).toHaveTextContent("board");
    expect(screen.getByTestId("b")).toHaveTextContent("board");
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("board");
  });
});
