// @vitest-environment jsdom
import { Toaster, dismissToast, toast, useToastStore } from "@/components/ui/toast";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Toast lifetime: auto-dismiss, manual dismiss, the action, and the cap. */

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("toast", () => {
  it("auto-dismisses after six seconds", () => {
    render(<Toaster />);
    act(() => {
      toast("Snoozed until Tue, Oct 13");
    });
    expect(screen.getByTestId("toast")).toHaveTextContent("Snoozed until Tue, Oct 13");

    act(() => {
      vi.advanceTimersByTime(5_900);
    });
    expect(screen.getByTestId("toast")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("runs the action once and closes; the close button dismisses without running it", () => {
    render(<Toaster />);
    const run = vi.fn();
    act(() => {
      toast("Moved 3 to Someday", { action: { label: "Undo", run } });
      toast("Second");
    });
    act(() => {
      screen.getByRole("button", { name: "Undo" }).click();
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("toast")).toHaveLength(1);

    act(() => {
      screen.getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByTestId("toast")).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps at most three, dropping the oldest", () => {
    render(<Toaster />);
    let ids: string[] = [];
    act(() => {
      ids = ["one", "two", "three", "four"].map((m) => toast(m));
    });
    const shown = screen.getAllByTestId("toast").map((el) => el.textContent);
    expect(shown).toHaveLength(3);
    expect(shown.join("|")).not.toContain("one");
    // Dismissing an already-dropped toast is a no-op, not an error.
    expect(() => dismissToast(ids[0]!)).not.toThrow();
  });
});
