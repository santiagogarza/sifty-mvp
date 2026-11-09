// @vitest-environment jsdom
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

describe("createTask starting status", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [] });
  });

  it("starts in Inbox by default", () => {
    const task = useStore.getState().createTask({ sourceText: "Call the plumber" });
    expect(task.lifecycle).toBe("inbox");
    expect(task.completedAt).toBeNull();
  });

  it("starts in the requested column and keeps it through triage", () => {
    const store = useStore.getState();
    const task = store.createTask({ sourceText: "Chase the contract", lifecycle: "waiting" });
    expect(task.lifecycle).toBe("waiting");

    store.applyTriage(task.id, {
      title: "Chase the signed contract",
      description: null,
      nextAction: "Email legal",
      urgency: 0.7,
      importance: 0.6,
      effort: "quick",
      due: null,
      delegationCandidate: "person",
      labelIds: [],
      subtasks: [],
      rationale: null,
      confidence: 0.8,
      clarifyingQuestion: null,
    });
    const after = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(after?.title).toBe("Chase the signed contract");
    expect(after?.lifecycle).toBe("waiting");
  });

  it("stamps completedAt when created straight into Done", () => {
    const task = useStore
      .getState()
      .createTask({ sourceText: "Already did it", lifecycle: "done" });
    expect(task.completedAt).toBe(task.createdAt);
  });
});
