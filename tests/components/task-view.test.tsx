// @vitest-environment jsdom
import { TaskView } from "@/components/tasks/task-view";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
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
    get serverReady() {
      return serverReady;
    },
  }),
}));
vi.mock("@/components/app-shell/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/tasks/view-mode-toggle", () => ({ ViewModeToggle: () => null }));

beforeEach(() => {
  serverReady = false;
  useStore.setState({ hydrated: true, tasks: [], labels: [], viewMode: "list" });
});

afterEach(() => {
  cleanup();
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
