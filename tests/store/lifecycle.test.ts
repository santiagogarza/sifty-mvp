import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

const triage = {
  title: "Renamed by triage",
  description: null,
  nextAction: "Do the thing",
  urgency: 0.5,
  importance: 0.5,
  effort: "small" as const,
  due: null,
  delegationCandidate: "self" as const,
  labelIds: [] as string[],
  subtasks: [],
  rationale: null,
  confidence: 0.5,
  clarifyingQuestion: null,
};

describe("lifecycle writes", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  });

  it("starts a capture in Inbox unless a column says otherwise", () => {
    const inbox = useStore.getState().createTask({ sourceText: "capture this" });
    expect(inbox.lifecycle).toBe("inbox");

    const focus = useStore.getState().createTask({
      sourceText: "file into focus",
      lifecycle: "active",
    });
    expect(focus.lifecycle).toBe("active");

    useStore.getState().applyTriage(focus.id, triage);
    const after = useStore.getState().tasks.find((task) => task.id === focus.id);
    expect(after?.lifecycle).toBe("active");
    expect(after?.title).toBe("Renamed by triage");
  });

  it("sets completedAt on Done and clears it when leaving, including undo", () => {
    const task = useStore.getState().createTask({ sourceText: "finish me" });
    useStore.getState().updateTask(task.id, { lifecycle: "done" });
    const done = useStore.getState().tasks.find((item) => item.id === task.id);
    expect(done?.completedAt).toBeTruthy();

    useStore.getState().updateTask(task.id, { lifecycle: "waiting" });
    const left = useStore.getState().tasks.find((item) => item.id === task.id);
    expect(left?.lifecycle).toBe("waiting");
    expect(left?.completedAt).toBeNull();

    useStore.getState().updateTask(task.id, { lifecycle: "inbox" });
    const undone = useStore.getState().tasks.find((item) => item.id === task.id);
    expect(undone?.lifecycle).toBe("inbox");
    expect(undone?.completedAt).toBeNull();
  });
});
