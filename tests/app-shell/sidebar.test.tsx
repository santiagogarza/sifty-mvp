// @vitest-environment jsdom
import { Sidebar } from "@/components/app-shell/sidebar";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/focus" }));

const NOW = new Date();

function iso(daysFromNow: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds fixtures through the store's own `createTask` so the full `Task`
 * shape comes from production code; a hand-written literal would break
 * typecheck whenever a required field is added to `Task`.
 */
function seedTask(patch: Partial<Task>): string {
  const { createTask, updateTask } = useStore.getState();
  const task = createTask({ sourceText: "test" });
  updateTask(task.id, patch);
  return task.id;
}

function navRow(label: string): HTMLElement {
  const row = screen.getByText(label, { exact: true }).closest("a");
  if (!row) throw new Error(`No nav row for ${label}`);
  return row;
}

/** The count is the text after the label span; null when no badge renders. */
function badge(label: string): HTMLElement | null {
  const spans = navRow(label).querySelectorAll(":scope > span");
  return (spans[1] as HTMLElement | undefined) ?? null;
}

let filedId: string;
let somedayId: string;

beforeEach(() => {
  useStore.setState({ hydrated: true, tasks: [] });
  filedId = seedTask({ lifecycle: "inbox" });
  seedTask({ lifecycle: "inbox", due: iso(-1) }); // also Today
  seedTask({ lifecycle: "active", priorityBucket: "do_now" }); // also Today
  seedTask({ lifecycle: "waiting" });
  somedayId = seedTask({ lifecycle: "someday", due: iso(-1) }); // overdue, still not Today
  seedTask({ lifecycle: "done", due: iso(-1) });
  seedTask({ lifecycle: "dropped", priorityBucket: "do_now" });
});

describe("Sidebar count badges", () => {
  it("shows counts for the five views, excluding done and dropped", () => {
    render(<Sidebar />);
    expect(badge("Today")?.textContent).toBe("2");
    expect(badge("Inbox")?.textContent).toBe("2");
    expect(badge("Focus")?.textContent).toBe("1");
    expect(badge("Waiting on")?.textContent).toBe("1");
    expect(badge("Someday")?.textContent).toBe("1");
  });

  it("renders no badge for a zero count or for Done", () => {
    render(<Sidebar />);
    act(() => useStore.getState().deleteTask(somedayId));
    expect(badge("Someday")).toBeNull();
    expect(navRow("Someday").textContent).toBe("Someday");
    expect(badge("Done")).toBeNull();
  });

  it("uses the muted token with tabular numerals, even on the active row", () => {
    render(<Sidebar />);
    expect(navRow("Focus").className).toContain("bg-[var(--surface-muted)]");
    const count = badge("Focus")!;
    expect(count.className).toContain("text-[var(--fg-subtle)]");
    expect(count.className).toContain("text-[11.5px]");
    expect(count.className).toContain("tabular-nums");
    expect(count.className).not.toMatch(/accent|warn|red|bg-/);
  });

  it("moves a count from Inbox to Focus live when a task is filed", () => {
    render(<Sidebar />);
    act(() => useStore.getState().setLifecycle(filedId, "active"));
    expect(badge("Inbox")?.textContent).toBe("1");
    expect(badge("Focus")?.textContent).toBe("2");
  });

  it("updates live on capture and completion", () => {
    render(<Sidebar />);
    act(() => {
      useStore.getState().createTask({ sourceText: "Call the dentist", sourceContext: null });
    });
    expect(badge("Inbox")?.textContent).toBe("3");
    act(() => useStore.getState().setLifecycle(filedId, "done"));
    expect(badge("Inbox")?.textContent).toBe("2");
  });
});
