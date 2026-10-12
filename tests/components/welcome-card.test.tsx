// @vitest-environment jsdom
import { WelcomeCard, shouldShowWelcome } from "@/components/tasks/welcome-card";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** First-run welcome card: shows only over an examples-only workspace. */

const openCapture = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail: vi.fn(), openCapture, openCommand: vi.fn() }),
}));

const EXAMPLE: Label = { id: "label_ex", name: "Example", tone: "mist" };
const WORK: Label = { id: "label_work", name: "Work", tone: "neutral" };

function makeTask(id: string, labelIds: string[]): Task {
  return {
    id,
    sourceText: id,
    sourceContext: null,
    title: id,
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
    labelIds,
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
  };
}

const examples = [
  makeTask("ex_1", ["label_ex"]),
  makeTask("ex_2", ["label_ex", "label_work"]),
  makeTask("ex_3", ["label_ex"]),
];

beforeEach(() => {
  useStore.setState({
    hydrated: true,
    welcomeDismissed: false,
    tasks: examples,
    labels: [EXAMPLE, WORK],
  });
  openCapture.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("shouldShowWelcome", () => {
  const base = { hydrated: true, dismissed: false, labels: [EXAMPLE, WORK] };

  it("shows over an examples-only workspace", () => {
    expect(shouldShowWelcome({ ...base, tasks: examples })).toBe(true);
  });

  it("hides once the user has a task of their own, or no tasks at all", () => {
    expect(shouldShowWelcome({ ...base, tasks: [...examples, makeTask("mine", [])] })).toBe(false);
    expect(shouldShowWelcome({ ...base, tasks: [] })).toBe(false);
  });

  it("hides before hydration, after dismissal, and without an Example label", () => {
    expect(shouldShowWelcome({ ...base, hydrated: false, tasks: examples })).toBe(false);
    expect(shouldShowWelcome({ ...base, dismissed: true, tasks: examples })).toBe(false);
    expect(shouldShowWelcome({ ...base, labels: [WORK], tasks: examples })).toBe(false);
  });
});

describe("WelcomeCard", () => {
  it("states what sifting does and the free cap, and opens capture", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard />);
    const card = screen.getByTestId("welcome-card");
    expect(card).toHaveTextContent(/Sifty sifts it into a clear title/);
    expect(card).toHaveTextContent(/Free accounts get 5 sifts a day/);
    expect(card).toHaveTextContent(/first 30 days/);

    await user.click(screen.getByRole("button", { name: "Capture your first task" }));
    expect(openCapture).toHaveBeenCalledTimes(1);
  });

  it("Remove the examples deletes every example task and the card goes away", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard />);
    await user.click(screen.getByRole("button", { name: "Remove the examples" }));
    expect(useStore.getState().tasks).toHaveLength(0);
    expect(screen.queryByTestId("welcome-card")).toBeNull();
  });

  it("Dismiss hides it and persists the choice", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard />);
    await user.click(screen.getByRole("button", { name: "Dismiss welcome" }));
    expect(screen.queryByTestId("welcome-card")).toBeNull();
    expect(useStore.getState().welcomeDismissed).toBe(true);
    expect(useStore.getState().tasks).toHaveLength(3);
  });
});
