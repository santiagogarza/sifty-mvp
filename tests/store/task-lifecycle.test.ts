// @vitest-environment jsdom
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The store writes the board relies on: a capture's starting status, and
 * `completedAt` following `lifecycle` into and out of done. Undo is just a
 * second lifecycle write, so it is covered by the same rule.
 */

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
});

describe("createTask lifecycle", () => {
  it("starts in inbox by default", () => {
    const task = useStore.getState().createTask({ sourceText: "Call the plumber" });
    expect(task.lifecycle).toBe("inbox");
  });

  it("starts in the requested status, and triage leaves it there", () => {
    const task = useStore.getState().createTask({ sourceText: "Follow up", lifecycle: "active" });
    expect(task.lifecycle).toBe("active");

    useStore.getState().applyTriage(task.id, {
      title: "Follow up with Priya",
      description: null,
      nextAction: "Send the summary",
      urgency: 0.7,
      importance: 0.6,
      effort: "quick",
      due: null,
      delegationCandidate: "self",
      labelIds: [],
      subtasks: [],
      rationale: null,
      confidence: 0.9,
      clarifyingQuestion: null,
    });
    const after = useStore.getState().tasks.find((t) => t.id === task.id)!;
    expect(after.title).toBe("Follow up with Priya");
    expect(after.lifecycle).toBe("active");
  });
});

describe("completedAt follows lifecycle", () => {
  it("is stamped on entering done and cleared on leaving", () => {
    const task = useStore.getState().createTask({ sourceText: "Ship it", lifecycle: "active" });
    const find = () => useStore.getState().tasks.find((t) => t.id === task.id)!;
    expect(find().completedAt).toBeNull();

    useStore.getState().setLifecycle(task.id, "done");
    expect(find().lifecycle).toBe("done");
    expect(find().completedAt).toBeTruthy();

    // Undo is this same write, back to the previous status.
    useStore.getState().updateTask(task.id, { lifecycle: "active" });
    expect(find().lifecycle).toBe("active");
    expect(find().completedAt).toBeNull();
  });

  it("is stamped at capture when the capture lands in done, and not restamped", () => {
    const task = useStore.getState().createTask({ sourceText: "Done twice", lifecycle: "done" });
    expect(task.completedAt).toBe(task.createdAt);
    useStore.getState().setLifecycle(task.id, "done");
    useStore.getState().updateTask(task.id, { title: "Still done" });
    expect(useStore.getState().tasks.find((t) => t.id === task.id)!.completedAt).toBe(
      task.createdAt,
    );
  });
});
