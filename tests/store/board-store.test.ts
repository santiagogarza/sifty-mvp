import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

const triage = {
  title: "Renamed by triage",
  description: null,
  nextAction: "Send the note",
  urgency: 0.8,
  importance: 0.7,
  effort: "small" as const,
  due: null,
  delegationCandidate: "self" as const,
  labelIds: [] as string[],
  subtasks: [],
  rationale: null,
  confidence: 0.6,
  clarifyingQuestion: null,
};

describe("board store writes", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [], hydrated: true });
  });

  it("creates inbox tasks by default and keeps a requested lifecycle through triage", () => {
    const inbox = useStore.getState().createTask({ sourceText: "Capture this" });
    expect(inbox.lifecycle).toBe("inbox");
    expect(inbox.editedFields).not.toContain("lifecycle");

    const focus = useStore.getState().createTask({
      sourceText: "Already filed",
      lifecycle: "active",
    });
    expect(focus.lifecycle).toBe("active");

    useStore.getState().applyTriage(focus.id, triage);
    const after = useStore.getState().tasks.find((task) => task.id === focus.id);
    expect(after?.lifecycle).toBe("active");
    expect(after?.title).toBe("Renamed by triage");
  });

  it("sets completedAt when a task is created already done", () => {
    const task = useStore.getState().createTask({
      sourceText: "Already finished",
      lifecycle: "done",
    });
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBeTruthy();
  });

  it("sets completedAt when entering Done and clears it when leaving", () => {
    const task = useStore.getState().createTask({ sourceText: "Finish" });
    useStore.getState().updateTask(task.id, { lifecycle: "done" });
    const done = useStore.getState().tasks.find((item) => item.id === task.id) as Task;
    expect(done.lifecycle).toBe("done");
    expect(done.completedAt).toBeTruthy();

    useStore.getState().updateTask(task.id, { lifecycle: "waiting" });
    const restored = useStore.getState().tasks.find((item) => item.id === task.id) as Task;
    expect(restored.lifecycle).toBe("waiting");
    expect(restored.completedAt).toBeNull();
  });
});
