// @vitest-environment jsdom
import { TaskView } from "@/components/tasks/task-view";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A new account must never flash "Inbox zero" before its starter tasks
 * arrive: an empty local cache waits for the first server pull.
 */

let serverReady = false;
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail: vi.fn(),
    openCapture: vi.fn(),
    openCommand: vi.fn(),
    syncError: false,
    get serverReady() {
      return serverReady;
    },
  }),
}));
vi.mock("@/components/app-shell/page-header", () => ({
  PageHeader: ({
    eyebrow,
    title,
    actions,
  }: { eyebrow?: string; title: string; actions?: ReactNode }) => (
    <header>
      {eyebrow ? <p>{eyebrow}</p> : null}
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

beforeEach(() => {
  serverReady = false;
  useStore.setState({ hydrated: true, tasks: [], labels: [] });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderInbox() {
  return render(<TaskView title="Inbox" selector={(tasks) => tasks} emptyTitle="Inbox zero." />);
}

describe("TaskView first load", () => {
  it("shows the skeleton, not the empty state, until the first pull settles", () => {
    const view = renderInbox();
    expect(screen.queryByText("Inbox zero.")).toBeNull();

    serverReady = true;
    view.rerender(<TaskView title="Inbox" selector={(tasks) => tasks} emptyTitle="Inbox zero." />);
    expect(screen.getByText("Inbox zero.")).toBeInTheDocument();
  });

  it("renders a non-empty local cache immediately", () => {
    useStore.setState({
      tasks: [
        {
          id: "cached",
          sourceText: "Cached task",
          sourceContext: null,
          title: "Cached task",
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
          siftId: null,
          siftStage: null,
          plan: null,
          recurrence: null,
          seriesId: null,
          siftedWithAssumptions: false,
          labelIds: [],
          subtasks: [],
          editedFields: [],
          createdAt: "2026-07-01T10:00:00.000Z",
          updatedAt: "2026-07-01T10:00:00.000Z",
          completedAt: null,
        },
      ],
    });
    renderInbox();
    expect(screen.getByText("Cached task")).toBeInTheDocument();
  });
});

describe("TaskView List / Board toggle", () => {
  it("swaps the route header for the board header and five columns, and back", async () => {
    serverReady = true;
    const user = userEvent.setup();
    renderInbox();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /List/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /Board/ }));
    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getByText("Board", { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: / column$/ })).toHaveLength(5);
    expect(localStorage.getItem("sifty.viewMode")).toBe(JSON.stringify("board"));

    await user.click(screen.getByRole("button", { name: /List/ }));
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.queryAllByRole("region", { name: / column$/ })).toHaveLength(0);
  });

  it("a stored Board preference applies on mount, so it carries across routes", () => {
    serverReady = true;
    localStorage.setItem("sifty.viewMode", JSON.stringify("board"));
    render(<TaskView title="Focus" selector={(tasks) => tasks} emptyTitle="Nothing in focus." />);
    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
  });

  it("shows skeleton columns in Board mode before the first pull", () => {
    localStorage.setItem("sifty.viewMode", JSON.stringify("board"));
    renderInbox();
    expect(screen.getByTestId("board-skeleton")).toBeInTheDocument();
  });
});
