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

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_sidebar_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    ...patch,
  };
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

const filed = makeTask({ lifecycle: "inbox" });

beforeEach(() => {
  useStore.setState({
    hydrated: true,
    tasks: [
      filed,
      makeTask({ lifecycle: "inbox", due: iso(-1) }), // also Today
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }), // also Today
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "done", due: iso(-1), completedAt: NOW.toISOString() }),
      makeTask({ lifecycle: "dropped", priorityBucket: "do_now" }),
    ],
  });
});

describe("Sidebar count badges", () => {
  it("shows counts for the five views, excluding done and dropped", () => {
    render(<Sidebar />);
    expect(badge("Today")?.textContent).toBe("2");
    expect(badge("Inbox")?.textContent).toBe("2");
    expect(badge("Focus")?.textContent).toBe("1");
    expect(badge("Waiting on")?.textContent).toBe("1");
  });

  it("renders no badge for a zero count or for Done", () => {
    render(<Sidebar />);
    expect(badge("Someday")).toBeNull();
    expect(badge("Done")).toBeNull();
    expect(navRow("Someday").textContent).toBe("Someday");
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
    act(() => useStore.getState().setLifecycle(filed.id, "active"));
    expect(badge("Inbox")?.textContent).toBe("1");
    expect(badge("Focus")?.textContent).toBe("2");
  });

  it("updates live on capture and completion", () => {
    render(<Sidebar />);
    act(() => {
      useStore.getState().createTask({ sourceText: "Call the dentist", sourceContext: null });
    });
    expect(badge("Inbox")?.textContent).toBe("3");
    act(() => useStore.getState().setLifecycle(filed.id, "done"));
    expect(badge("Inbox")?.textContent).toBe("2");
  });
});
