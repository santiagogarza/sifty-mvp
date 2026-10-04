// @vitest-environment jsdom

import { ViewModeToggle } from "@/components/tasks/view-mode-toggle";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

beforeEach(() => {
  window.localStorage.clear();
  useStore.setState({ viewModes: { "/focus": "board" } });
});

describe("ViewModeToggle", () => {
  it("reflects the current route and writes only that route", async () => {
    const user = userEvent.setup();
    render(createElement(ViewModeToggle));

    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Board" }));

    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
    expect(useStore.getState().viewModes["/inbox"]).toBe("board");
    expect(useStore.getState().viewModes["/focus"]).toBe("board");
  });
});
