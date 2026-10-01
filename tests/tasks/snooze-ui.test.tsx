// @vitest-environment jsdom
import { SnoozePicker } from "@/components/tasks/snooze-picker";
import { TaskList } from "@/components/tasks/task-list";
import { Toaster, useToastStore } from "@/components/ui/toast";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterAll(() => {
  process.env.TZ = originalTz;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday Sep 30 2026, 2:30 PM local.
  vi.setSystemTime(new Date(2026, 8, 30, 14, 30));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useToastStore.setState({ toast: null });
});

function makeTask(id: string, title: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    sourceText: title,
    sourceContext: null,
    title,
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
    snoozedUntil: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function snoozedUntil(id: string): string | null {
  return useStore.getState().tasks.find((t) => t.id === id)!.snoozedUntil;
}

describe("row snooze sequences", () => {
  it("s t snoozes the highlighted row to tomorrow morning, with Undo", () => {
    const tasks = [makeTask("task_a", "Alpha"), makeTask("task_b", "Beta")];
    useStore.setState({ tasks, snoozeMorningHour: 9 });
    render(
      <>
        <TaskList tasks={tasks} onOpen={() => {}} autoFocus={false} />
        <Toaster />
      </>,
    );
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "s" });
    fireEvent.keyDown(list, { key: "t" });

    expect(snoozedUntil("task_a")).toBeNull();
    expect(snoozedUntil("task_b")).toBe(new Date(2026, 9, 1, 9).toISOString());
    expect(screen.getByRole("status")).toHaveTextContent("Snoozed until Thu 9:00 AM");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(snoozedUntil("task_b")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("s w uses next Monday and the settings morning hour", () => {
    const tasks = [makeTask("task_a", "Alpha")];
    useStore.setState({ tasks, snoozeMorningHour: 7 });
    render(<TaskList tasks={tasks} onOpen={() => {}} autoFocus={false} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "s" });
    fireEvent.keyDown(list, { key: "w" });
    expect(snoozedUntil("task_a")).toBe(new Date(2026, 9, 5, 7).toISOString());
  });

  it("a lone t or w on a row does nothing", () => {
    const tasks = [makeTask("task_a", "Alpha")];
    useStore.setState({ tasks, snoozeMorningHour: 9 });
    render(<TaskList tasks={tasks} onOpen={() => {}} autoFocus={false} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "t" });
    fireEvent.keyDown(list, { key: "w" });
    expect(snoozedUntil("task_a")).toBeNull();
  });
});

describe("SnoozePicker", () => {
  function openPicker(morningHour = 9) {
    const task = makeTask("task_p", "Picker");
    useStore.setState({ tasks: [task], snoozeMorningHour: morningHour });
    render(
      <SnoozePicker task={task}>
        <button type="button">Snooze</button>
      </SnoozePicker>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  }

  it("shows both quick actions above the date input with resolved labels", () => {
    openPicker();
    const tomorrow = screen.getByRole("button", { name: "Tomorrow - Thu 9:00 AM" });
    const nextWeek = screen.getByRole("button", { name: "Next week - Mon 9:00 AM" });
    const input = screen.getByLabelText("Snooze until date");
    expect(tomorrow.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nextWeek.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("labels follow the settings morning hour", () => {
    openPicker(8);
    expect(screen.getByRole("button", { name: "Tomorrow - Thu 8:00 AM" })).toBeInTheDocument();
  });

  it("w snoozes to next week and closes; Esc closes without snoozing", () => {
    openPicker();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Next week/ }), { key: "w" });
    expect(snoozedUntil("task_p")).toBe(new Date(2026, 9, 5, 9).toISOString());
    expect(screen.queryByLabelText("Snooze until date")).toBeNull();

    act(() => {
      useStore.getState().updateTask("task_p", { snoozedUntil: null });
    });
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.keyDown(screen.getByLabelText("Snooze until date"), { key: "Escape" });
    expect(screen.queryByLabelText("Snooze until date")).toBeNull();
    expect(snoozedUntil("task_p")).toBeNull();
  });
});
